import { CONFIG } from './config.js';
import { daysBetweenDates, escapeHtml, formatEmailDate, parseBookRows } from './library-logic.mjs';

// ==========================================
// SUPABASE
// ==========================================

const supabaseClient = supabase.createClient(
    CONFIG.supabase.url,
    CONFIG.supabase.publishableKey
);

// ==========================================
// EMAILJS
// ==========================================

const EMAILJS_SERVICE_ID = CONFIG.emailjs.serviceId;
const EMAILJS_REMINDER_TEMPLATE_ID = CONFIG.emailjs.reminderTemplateId;
const EMAILJS_PUBLIC_KEY = CONFIG.emailjs.publicKey;
const EMAILJS_TRANSACTION_TEMPLATE_ID = CONFIG.emailjs.transactionTemplateId;

let allBooks = [];
let filteredBooks = [];
let currentBookPage = 1;
const BOOKS_PER_PAGE = 24;
let borrowedCounts = new Map();
let currentActiveBorrows = [];
let isAdmin = false;
let currentUser = null;
let passwordRecoveryPending = false;
let pendingBookImport = null;
let feedbackModalBusy = false;
let feedbackConfirmAction = null;
let feedbackReturnFocus = null;
let borrowSubmissionInProgress = false;
let returnSubmissionInProgress = false;

// ==========================================
// 1. NAČÍTANIE A ZOBRAZENIE KNÍH
// ==========================================
async function loadBooks() {
    console.log('--- Štart loadBooks ---');
    const container = document.getElementById('booksGrid') || document.getElementById('books-container') || document.getElementById('books-list');

    try {
        if (typeof supabaseClient === 'undefined' || !supabaseClient) {
            throw new Error('supabaseClient nie je vytvorený!');
        }

        const { data: availabilityData, error: availabilityError } = await supabaseClient
            .rpc('get_book_availability');

        if (availabilityError) {
            throw new Error(`Dostupnosť kníh: ${availabilityError.message}`);
        }

        borrowedCounts = new Map(
            (availabilityData || []).map(item => [
                String(item.kniha_id),
                Number(item.pocet_vypozicanych)
            ])
        );

        // 2. Načítanie všetkých kníh
        const { data: booksData, error: booksError } = await supabaseClient
            .from('knihy')
            .select('*')
            .order('nazov', { ascending: true });

        if (booksError) {
            console.error('Chyba Supabase (knihy):', booksError);
            throw new Error(`Tabuľka knihy: ${booksError.message}`);
        }

        allBooks = booksData || [];

        // Naplnenie kategórií do selektoru
        populateCategories(allBooks);

        // 3. Vykreslenie kníh do katalógu
        filterAndRenderBooks();

    } catch (err) {
        console.error('Kritická chyba v loadBooks:', err);
        if (container) {
            const message = document.createElement('p');
            message.style.cssText = 'color: var(--danger-text); padding: 20px; text-align: center; grid-column: 1/-1;';
            message.textContent = `Chyba pri načítaní katalógu: ${err.message || 'Neznáma chyba'}`;
            container.replaceChildren(message);
        }
    }
}

function populateCategories(books) {
    const categorySelect = document.getElementById('categorySelect') || document.querySelector('.category-select');
    if (!categorySelect) return;

    const categories = Array.from(new Set(books.map(b => b.kategoria || 'Všeobecné'))).sort();

    categorySelect.innerHTML = '<option value="">Všetky kategórie</option>';
    categories.forEach(cat => {
        const option = document.createElement('option');
        option.value = cat;
        option.textContent = cat;
        categorySelect.appendChild(option);
    });
}

function getAvailableCopyCount(book) {
    const borrowedCount = Number(borrowedCounts.get(String(book.id)) || 0);
    return Math.max(0, Number(book.pocet_celkovo ?? 0) - borrowedCount);
}

function filterAndRenderBooks() {
    const searchInput = document.getElementById('searchInput') || document.querySelector('.search-box');
    const categorySelect = document.getElementById('categorySelect') || document.querySelector('.category-select');

    const query = searchInput ? searchInput.value.toLowerCase().trim() : '';
    const selectedCategory = categorySelect ? categorySelect.value : '';
    const searchMode = document.getElementById('searchModeFilter')?.value || 'all';
    const selectedAvailability = document.getElementById('availabilityFilter')?.value || 'all';

    filteredBooks = allBooks.filter(book => {
        const title = String(book.nazov || '').trim().toLowerCase();
        const author = String(book.autor || '').trim().toLowerCase();
        let matchesQuery;

        if (searchMode === 'title-prefix') {
            matchesQuery = !query || title.startsWith(query);
        } else if (searchMode === 'author-prefix') {
            matchesQuery = !query || author.startsWith(query);
        } else {
            matchesQuery = title.includes(query) || author.includes(query);
        }

        const matchesCategory = selectedCategory === '' || (book.kategoria || 'Všeobecné') === selectedCategory;
        const availableCount = getAvailableCopyCount(book);
        const matchesAvailability = selectedAvailability === 'available'
            ? availableCount > 0
            : selectedAvailability === 'unavailable'
                ? availableCount === 0
                : true;

        return matchesQuery && matchesCategory && matchesAvailability;
    });

    currentBookPage = 1;
    updateCatalogFilterToggle();
    renderCurrentBookPage();
}

function updateCatalogFilterToggle() {
    const toggleButton = document.getElementById('catalogFilterToggle');
    if (!toggleButton) return;

    const searchMode = document.getElementById('searchModeFilter')?.value || 'all';
    const selectedCategory = document.getElementById('categoryFilter')?.value || '';
    const availability = document.getElementById('availabilityFilter')?.value || 'all';
    const activeCount = Number(searchMode !== 'all') +
        Number(Boolean(selectedCategory)) +
        Number(availability !== 'all');

    toggleButton.textContent = activeCount ? `Filtre (${activeCount})` : 'Filtre';
}

function toggleCatalogFilters() {
    const panel = document.getElementById('catalogFilters');
    const toggleButton = document.getElementById('catalogFilterToggle');
    if (!panel || !toggleButton) return;

    const isOpen = panel.classList.toggle('is-open');
    toggleButton.setAttribute('aria-expanded', String(isOpen));
}

function clearCatalogFilters() {
    const searchInput = document.getElementById('searchInput');
    const searchMode = document.getElementById('searchModeFilter');
    const category = document.getElementById('categoryFilter');
    const availability = document.getElementById('availabilityFilter');

    if (searchInput) searchInput.value = '';
    if (searchMode) searchMode.value = 'all';
    if (category) category.value = '';
    if (availability) availability.value = 'all';

    const panel = document.getElementById('catalogFilters');
    const toggleButton = document.getElementById('catalogFilterToggle');
    if (panel) panel.classList.remove('is-open');
    if (toggleButton) toggleButton.setAttribute('aria-expanded', 'false');

    filterAndRenderBooks();
}

function renderCurrentBookPage() {
    const totalPages = Math.ceil(filteredBooks.length / BOOKS_PER_PAGE);
    currentBookPage = Math.min(currentBookPage, Math.max(totalPages, 1));

    const startIndex = (currentBookPage - 1) * BOOKS_PER_PAGE;
    const pageBooks = filteredBooks.slice(startIndex, startIndex + BOOKS_PER_PAGE);
    renderBooks(pageBooks);
    renderBookPagination(totalPages, startIndex);
}

function renderBookPagination(totalPages, startIndex) {
    const pagination = document.getElementById('bookPagination');
    const status = document.getElementById('bookPaginationStatus');
    if (!pagination || !status) return;

    pagination.hidden = totalPages <= 1;
    const previousButton = pagination.querySelector('[data-action="previous-books-page"]');
    const nextButton = pagination.querySelector('[data-action="next-books-page"]');

    if (totalPages <= 1) {
        status.textContent = '';
        if (previousButton) previousButton.disabled = true;
        if (nextButton) nextButton.disabled = true;
        return;
    }

    if (previousButton) previousButton.disabled = currentBookPage === 1;
    if (nextButton) nextButton.disabled = currentBookPage === totalPages;

    const endIndex = Math.min(startIndex + BOOKS_PER_PAGE, filteredBooks.length);
    status.textContent = `Strana ${currentBookPage} z ${totalPages} · Zobrazené ${startIndex + 1}–${endIndex} z ${filteredBooks.length}`;
}

function changeBookPage(page) {
    const totalPages = Math.ceil(filteredBooks.length / BOOKS_PER_PAGE);
    if (page < 1 || page > totalPages || page === currentBookPage) return;

    currentBookPage = page;
    renderCurrentBookPage();
    document.getElementById('booksGrid')?.scrollIntoView({ block: 'start' });
}

function renderBooks(booksToRender) {
    const container = document.getElementById('booksGrid') || document.getElementById('books-container') || document.getElementById('books-list');

    if (!container) {
        console.error('Kritická chyba: Element pre zoznam kníh sa nenašiel v HTML!');
        return;
    }

    if (!booksToRender || booksToRender.length === 0) {
        container.innerHTML = '<p style="text-align: center; grid-column: 1/-1; color: var(--text-muted); padding: 20px;">Žiadne knihy neodpovedajú zadaným kritériám.</p>';
        return;
    }

    container.innerHTML = '';

    booksToRender.forEach(book => {
        const availableCount = getAvailableCopyCount(book);
        const isAvailable = availableCount > 0;

        const card = document.createElement('div');
        card.className = 'book-card';

        card.innerHTML = `
            <div>
                <div class="book-category">${escapeHtml(book.kategoria || 'Všeobecné')}</div>
                <div class="book-title">${escapeHtml(book.nazov)}</div>
                <div class="book-author">Autor: ${escapeHtml(book.autor || 'Neznámy autor')}</div>
            </div>

            <div class="book-footer">
                <span class="badge ${isAvailable ? 'badge-available' : 'badge-unavailable'}">
                    ${isAvailable ? `Dostupné: ${availableCount} ks` : 'Nedostupné'}
                </span>

                <button
                    class="btn-borrow"
                    data-action="borrow"
                    data-book-id="${book.id}"
                    ${!isAvailable ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : ''}>
                    ${isAvailable ? 'Vypožičať' : 'Obsadené'}
                </button>
            </div>
        `;

        container.appendChild(card);
    });
}

// ==========================================
// 2. MODÁLNE OKNO: POŽIČANIE KNIHY (ČITATEĽ)
// ==========================================
function openBorrowModal(bookId, bookTitle) {
    if (!currentUser) {
        openUserBorrowsModal();
        showAuthMessage('Na požičanie knihy sa najprv prihláste alebo vytvorte účet.', 'error');
        return;
    }

    const modal = document.getElementById('borrowModal');
    const bookIdInput = document.getElementById('borrowBookId');
    const bookTitleDiv = document.getElementById('borrowModalBookTitle');

    if (bookIdInput) bookIdInput.value = bookId;
    if (bookTitleDiv) bookTitleDiv.innerText = bookTitle;

    const borrowNameInput = document.getElementById('borrowName');
    const suggestedName = currentUser.user_metadata?.full_name || currentUser.user_metadata?.name || '';
    if (borrowNameInput) borrowNameInput.value = suggestedName;

    if (modal) {
        modal.style.display = 'flex';
    }
}

function closeBorrowModal() {
    const modal = document.getElementById('borrowModal');
    if (modal) {
        modal.style.display = 'none';
    }
    const form = document.getElementById('borrowForm');
    if (form) form.reset();
}

function showFeedbackModal({ title, message, type = 'info', busy = false, confirmLabel, onConfirm }) {
    const modal = document.getElementById('feedbackModal');
    const dialog = document.getElementById('feedbackDialog');
    const icon = document.getElementById('feedbackIcon');
    const titleElement = document.getElementById('feedbackTitle');
    const messageElement = document.getElementById('feedbackMessage');
    const confirmButton = document.getElementById('feedbackConfirmButton');
    const closeButton = document.getElementById('feedbackCloseButton');
    if (!modal || !dialog || !icon || !titleElement || !messageElement || !confirmButton || !closeButton) {
        console.error('Modálne okno upozornenia nebolo v HTML nájdené.');
        return;
    }

    if (modal.style.display !== 'flex') feedbackReturnFocus = document.activeElement;

    const icons = {
        success: '✓',
        warning: '!',
        error: '×',
        info: 'i',
        confirm: '?',
        loading: ''
    };

    dialog.className = `modal-content feedback-modal-content feedback-modal--${type}`;
    dialog.setAttribute('aria-busy', String(busy));
    icon.textContent = icons[type] || icons.info;
    titleElement.textContent = title;
    messageElement.textContent = message;
    feedbackModalBusy = busy;
    feedbackConfirmAction = onConfirm || null;

    confirmButton.textContent = confirmLabel || '';
    confirmButton.hidden = !confirmLabel || busy;
    closeButton.hidden = busy;
    modal.style.display = 'flex';

    (busy ? dialog : confirmLabel ? confirmButton : closeButton).focus();
}

function closeFeedbackModal() {
    if (feedbackModalBusy) return;

    const modal = document.getElementById('feedbackModal');
    if (modal) modal.style.display = 'none';
    feedbackConfirmAction = null;

    const returnFocus = feedbackReturnFocus;
    feedbackReturnFocus = null;
    if (returnFocus instanceof HTMLElement && returnFocus.isConnected && returnFocus.getClientRects().length > 0) {
        returnFocus.focus();
    }
}

function confirmFeedbackModal() {
    if (feedbackModalBusy || !feedbackConfirmAction) return;

    const action = feedbackConfirmAction;
    feedbackConfirmAction = null;
    action();
}

async function submitBorrowForm(event) {
    if (event) event.preventDefault();
    if (borrowSubmissionInProgress) return;

    const bookId = document.getElementById('borrowBookId')?.value;
    const nameInput = document.getElementById('borrowName')?.value.trim();

    if (!currentUser) {
        showAuthMessage('Na požičanie knihy sa najprv prihláste.', 'error');
        closeBorrowModal();
        return;
    }

    if (!bookId || !nameInput) {
        showFeedbackModal({
            title: 'Skontrolujte údaje',
            message: 'Zadajte svoje meno a priezvisko.',
            type: 'error'
        });
        return;
    }

    const book = allBooks.find(item => String(item.id) === String(bookId));
    if (!book) {
        showFeedbackModal({
            title: 'Kniha sa nenašla',
            message: 'Obnovte katalóg a skúste to znova.',
            type: 'error'
        });
        return;
    }

    borrowSubmissionInProgress = true;
    const submitButton = document.querySelector('#borrowForm button[type="submit"]');
    if (submitButton) submitButton.disabled = true;
    showFeedbackModal({
        title: 'Spracúvam výpožičku',
        message: 'Čakajte, prosím. Výpožičku teraz potvrdzujeme.',
        type: 'loading',
        busy: true
    });

    try {
        const { error } = await supabaseClient.rpc('create_borrow', {
            p_kniha_id: Number.parseInt(bookId, 10),
            p_meno: nameInput
        });

        if (error) {
            throw error;
        }

        showFeedbackModal({
            title: 'Výpožička je zaevidovaná',
            message: 'Ešte odosielame potvrdenie na váš e-mail.',
            type: 'loading',
            busy: true
        });

        let confirmationSent = false;
        try {
            confirmationSent = await sendBorrowConfirmation(
                currentUser.email,
                nameInput,
                book.nazov,
                book.autor,
                new Date()
            );
        } catch (emailError) {
            console.error('Výpožička bola uložená, ale potvrdenie sa nepodarilo odoslať:', emailError);
        }

        closeBorrowModal();
        showFeedbackModal({
            title: 'Výpožička potvrdená',
            message: confirmationSent
                ? `Kniha „${book.nazov}“ je vypožičaná. Potvrdenie sme odoslali na ${currentUser.email}.`
                : `Kniha „${book.nazov}“ je vypožičaná, ale potvrdzujúci e-mail sa nepodarilo odoslať.`,
            type: confirmationSent ? 'success' : 'warning'
        });
        await loadBooks();
        if (document.getElementById('userBorrowsModal')?.style.display === 'flex') {
            await loadUserBorrows();
        }
    } catch (err) {
        console.error('Chyba pri vytváraní výpožičky:', err);
        showFeedbackModal({
            title: 'Výpožičku sa nepodarilo vytvoriť',
            message: err.message || 'Skúste to, prosím, znova.',
            type: 'error'
        });
    } finally {
        borrowSubmissionInProgress = false;
        if (submitButton) submitButton.disabled = false;
    }
}

// ==========================================
// 3. MODÁLNE OKNO: MOJE VÝPOŽIČKY (ČITATEĽ)
// ==========================================
function openUserBorrowsModal() {
    const modal = document.getElementById('userBorrowsModal');
    if (modal) {
        modal.style.display = 'flex';
        loadUserBorrows();
    } else {
        alert('Modálne okno pre výpožičky nebolo v HTML nájdené.');
    }
}

function closeUserBorrowsModal() {
    const modal = document.getElementById('userBorrowsModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

async function loadUserBorrows() {
    const container = document.getElementById('userBorrowsList');

    if (!container) return;
    if (!currentUser) {
        container.innerHTML = '<p style="text-align: center; color: var(--text-muted); padding: 10px;">Ak chcete zobraziť svoje výpožičky, prihláste sa vo formulári na stránke.</p>';
        return;
    }

    container.innerHTML = '<p style="text-align: center; color: var(--text-muted); padding: 10px;">Načítavam vaše výpožičky...</p>';

    try {
        const { data: userBorrows, error } = await supabaseClient
            .from('vypozicky')
            .select(`
                id,
                datum_vypozicania,
                knihy (
                    nazov,
                    autor
                )
            `)
                .eq('user_id', currentUser.id)
            .is('datum_vratenia', null)
            .order('datum_vypozicania', { ascending: false });

        if (error) {
            console.error('Chyba pri načítaní výpožičiek používateľa:', error);
            throw new Error(error.message);
        }

        if (!userBorrows || userBorrows.length === 0) {
            container.innerHTML = '<p style="text-align: center; color: var(--text-muted); padding: 15px;">Nemáte žiadne aktívne výpožičky.</p>';
            return;
        }

        let html = `
            <table>
                <thead>
                    <tr>
                        <th>Kniha</th>
                        <th>Autor</th>
                        <th>Dátum výpožičky</th>
                        <th style="text-align: right;">Akcia</th>
                    </tr>
                </thead>
                <tbody>
        `;

        userBorrows.forEach(item => {
            const knihaNazov = item.knihy ? item.knihy.nazov : 'Neznáma kniha';
            const knihaAutor = item.knihy ? item.knihy.autor : 'Neznámy autor';
            const datum = item.datum_vypozicania
                ? new Date(item.datum_vypozicania).toLocaleDateString('sk-SK')
                : 'Neznámy';

            html += `
                <tr>
                    <td><strong>${escapeHtml(knihaNazov)}</strong></td>
                    <td>${escapeHtml(knihaAutor)}</td>
                    <td>${datum}</td>
                    <td style="text-align: right;">
                        <button class="btn-return" data-action="return-book" data-borrow-id="${item.id}" data-book-title="${escapeHtml(knihaNazov)}">Vrátiť</button>
                    </td>
                </tr>
            `;
        });

        html += '</tbody></table>';
        container.innerHTML = html;

    } catch (err) {
        console.error('Chyba v loadUserBorrows:', err);
        container.textContent = `Chyba pri načítaní výpožičiek: ${err.message || 'Neznáma chyba'}`;
    }
}

function returnBook(borrowId, bookTitle) {
    showFeedbackModal({
        title: bookTitle ? `Vrátiť knihu „${bookTitle}“?` : 'Vrátiť knihu?',
        message: 'Potvrďte, že ste knihu odovzdali späť do knižnice.',
        type: 'confirm',
        confirmLabel: 'Potvrdiť vrátenie',
        onConfirm: () => processBookReturn(borrowId, bookTitle)
    });
}

async function processBookReturn(borrowId, bookTitle) {
    if (returnSubmissionInProgress) return;

    returnSubmissionInProgress = true;
    showFeedbackModal({
        title: 'Spracúvam vrátenie',
        message: 'Čakajte, prosím. Vrátenie knihy teraz zaznamenávame.',
        type: 'loading',
        busy: true
    });

    try {
        const { error } = await supabaseClient.rpc('return_borrow', {
            p_vypozicka_id: Number.parseInt(borrowId, 10)
        });

        if (error) {
            throw error;
        }

        showFeedbackModal({
            title: bookTitle ? `Vrátenie knihy „${bookTitle}“ je zaevidované` : 'Vrátenie je zaevidované',
            message: 'Ešte odosielame potvrdenie na váš e-mail.',
            type: 'loading',
            busy: true
        });

        let confirmationSent = false;
        try {
            const { data: loan, error: loanError } = await supabaseClient
                .from('vypozicky')
                .select(`
                    meno,
                    email,
                    datum_vratenia,
                    knihy ( nazov, autor )
                `)
                .eq('id', Number.parseInt(borrowId, 10))
                .maybeSingle();

            if (loanError) throw loanError;
            if (!loan) throw new Error('Údaje o vrátenej výpožičke sa nenašli.');

            const bookData = Array.isArray(loan.knihy) ? loan.knihy[0] : loan.knihy;
            confirmationSent = await sendReturnConfirmation({
                email: loan.email || currentUser?.email,
                meno: loan.meno || currentUser?.user_metadata?.full_name || 'čitateľ',
                nazovKnihy: bookData?.nazov || 'Kniha',
                autor: bookData?.autor || '',
                datumVratena: loan.datum_vratenia
            });
        } catch (emailError) {
            console.error('Kniha bola vrátená, ale údaje pre potvrdenie sa nepodarilo načítať:', emailError);
        }

        showFeedbackModal({
            title: bookTitle ? `Kniha „${bookTitle}“ bola vrátená` : 'Kniha bola vrátená',
            message: confirmationSent
                ? 'Vrátenie sme zaznamenali a potvrdenie odoslali e-mailom.'
                : 'Vrátenie sme zaznamenali, ale potvrdzujúci e-mail sa nepodarilo odoslať.',
            type: confirmationSent ? 'success' : 'warning'
        });

        if (document.getElementById('userBorrowsModal')?.style.display === 'flex') {
            await loadUserBorrows();
        }
        if (isAdmin) await loadAdminBorrows();
        await loadBooks();

    } catch (err) {
        console.error('Chyba pri vrátení knihy:', err);
        showFeedbackModal({
            title: 'Knihu sa nepodarilo vrátiť',
            message: err.message || 'Skúste to, prosím, znova.',
            type: 'error'
        });
    } finally {
        returnSubmissionInProgress = false;
    }
}

async function sendEmailJsTemplate(templateId, email, subject, bodyHtml) {
    if (!email || typeof emailjs === 'undefined') {
        console.error('EmailJS nie je dostupný alebo chýba e-mail príjemcu.');
        return false;
    }

    try {
        await emailjs.send(EMAILJS_SERVICE_ID, templateId, {
            email,
            subject,
            body_html: bodyHtml
        });
        return true;
    } catch (err) {
        console.error('Chyba pri odosielaní e-mailu cez EmailJS:', err);
        return false;
    }
}

function buildBorrowConfirmationHtml(meno, nazovKnihy, autor, datumVypozicania) {
    return `
        <div style="font-family: system-ui, sans-serif, Arial; font-size: 16px;">
            <h2>Ahoj, ${escapeHtml(meno)} 👋</h2>
            <p style="margin: 0; font-size: 15px; line-height: 1.5;">potvrdzujeme, že si si dňa <strong>${escapeHtml(formatEmailDate(datumVypozicania))}</strong> úspešne požičal(a) knihu:</p>
            <div style="background-color: #f0f7ff; border: 1px solid #bae0ff; border-left: 4px solid #1890ff; border-radius: 6px; padding: 12px 16px; margin: 15px 0;">
                <p style="margin: 0; font-size: 15px; line-height: 1.5;">Kniha: <strong>${escapeHtml(nazovKnihy || 'Kniha')}</strong><br>Autor: <strong>${escapeHtml(autor || '')}</strong></p>
            </div>
            <p style="margin: 0; font-size: 15px; line-height: 1.5;">Prajeme príjemné čítanie!</p>
            <p style="padding-top: 16px; border-top: 1px solid #eaeaea;"><strong>Tvoja Oratkovská Knižnica Saleziáni Bardejov</strong></p>
        </div>
    `;
}

function buildReturnConfirmationHtml(meno, nazovKnihy, autor, datumVratena) {
    return `
        <div style="font-family: system-ui, sans-serif, Arial; font-size: 16px;">
            <h2>Ahoj, ${escapeHtml(meno)} 👋</h2>
            <p style="margin: 0; font-size: 15px; line-height: 1.5;">potvrdzujeme, že si dňa <strong>${escapeHtml(formatEmailDate(datumVratena))}</strong> úspešne vrátil(a) knihu:</p>
            <div style="background-color: #f0f7ff; border: 1px solid #bae0ff; border-left: 4px solid #1890ff; border-radius: 6px; padding: 12px 16px; margin: 15px 0;">
                <p style="margin: 0; font-size: 15px; line-height: 1.5;">Kniha: <strong>${escapeHtml(nazovKnihy || 'Kniha')}</strong><br>Autor: <strong>${escapeHtml(autor || '')}</strong></p>
            </div>
            <p style="margin: 0; font-size: 15px; line-height: 1.5;">Ďakujeme za vrátenie a tešíme sa na Tvoju ďalšiu návštevu!</p>
            <p style="padding-top: 16px; border-top: 1px solid #eaeaea;"><strong>Tvoja Oratkovská Knižnica Saleziáni Bardejov</strong></p>
        </div>
    `;
}

async function sendBorrowConfirmation(email, meno, nazovKnihy, autor, datumVypozicania) {
    return sendEmailJsTemplate(
        EMAILJS_TRANSACTION_TEMPLATE_ID,
        email,
        'Potvrdenie požičania knihy',
        buildBorrowConfirmationHtml(meno || 'čitateľ', nazovKnihy, autor, datumVypozicania)
    );
}

async function sendReturnConfirmation({ email, meno, nazovKnihy, autor, datumVratena }) {
    return sendEmailJsTemplate(
        EMAILJS_TRANSACTION_TEMPLATE_ID,
        email,
        'Potvrdenie vrátenia knihy',
        buildReturnConfirmationHtml(meno || 'čitateľ', nazovKnihy, autor, datumVratena)
    );
}

function buildReminderEmail(isFirstReminder, loan) {
    const bookData = Array.isArray(loan.knihy) ? loan.knihy[0] : loan.knihy;
    const meno = escapeHtml(loan.meno || 'čitateľ');
    const nazovKnihy = escapeHtml(bookData?.nazov || 'Kniha');
    const autor = escapeHtml(bookData?.autor || '');
    const datumVypozicania = escapeHtml(formatEmailDate(loan.datum_vypozicania));
    const dnes = new Date().toISOString().slice(0, 10);
    const pocetDni = daysBetweenDates(loan.datum_vypozicania, dnes);

    const intro = isFirstReminder
        ? `Veríme, že Ti kniha <strong>„${nazovKnihy}“</strong> od autora <strong>${autor}</strong> robí príjemnú spoločnosť.`
        : `Evidujeme, že kniha <strong>„${nazovKnihy}“</strong> od autora <strong>${autor}</strong> je stále požičaná. Požičal(a) si si ju dňa <strong>${datumVypozicania}</strong>, teda už <strong>${pocetDni} dní</strong>.`;
    const followUp = isFirstReminder
        ? 'Pokojne si ju dočítaj vlastným tempom. Chceli sme Ti len dať vedieť, ako letí čas, a pripomenúť, že keď budeš mať knihu dočítanú, v knižnici sa na ňu určite tešia aj ďalší čitatelia.'
        : 'Ak si knihu už vrátil(a), prosíme, daj nám vedieť, aby sme mohli opraviť evidenciu. Ak ju ešte máš, prosíme o jej vrátenie, keď to bude možné.';

    return {
        subject: isFirstReminder
            ? 'Pripomienka k požičanej knihe'
            : 'Opakovaná pripomienka k požičanej knihe',
        bodyHtml: `
            <div style="font-family: system-ui, sans-serif, Arial; font-size: 16px;">
                <h2>Ahoj, ${meno} 👋</h2>
                <p>${intro}</p>
                <div style="background-color: #f0f7ff; border: 1px solid #bae0ff; border-left: 4px solid #1890ff; border-radius: 6px; padding: 12px 16px; margin: 15px 0;">
                    <p style="margin: 0; font-size: 15px; line-height: 1.5;">📖 Knihu máš požičanú od <strong>${datumVypozicania}</strong>, t. j. <strong style="color: #092b00; font-size: 16px;">${pocetDni} dní</strong>.</p>
                </div>
                <p>${followUp}</p>
                <p>Želáme Ti krásne a nerušené čítanie!</p>
                <hr>
                <p>S pozdravom,<br><strong>Tvoja Oratkovská Knižnica Saleziáni Bardejov</strong></p>
            </div>
        `
    };
}

// ==========================================
// 4. AUTENTIFIKÁCIA A ADMINISTRÁCIA
// ==========================================
function showAuthMessage(message, type = 'info') {
    const messageElement = document.getElementById('authMessage');
    if (!messageElement) return;
    messageElement.textContent = message;
    messageElement.dataset.type = type;
}

function updateAuthUi() {
    const authForm = document.getElementById('authForm');
    const resetPasswordForm = document.getElementById('resetPasswordForm');
    const currentUserEmail = document.getElementById('currentUserEmail');
    const adminStatus = document.getElementById('adminStatus');
    const signOutButton = document.getElementById('signOutButton');
    const adminControls = document.getElementById('adminControls');

    if (authForm) authForm.hidden = Boolean(currentUser) || passwordRecoveryPending;
    if (resetPasswordForm) resetPasswordForm.hidden = !passwordRecoveryPending;
    if (currentUserEmail) currentUserEmail.textContent = currentUser?.email || 'Neprihlásený';

    if (adminStatus) {
        adminStatus.textContent = !currentUser ? '' : (isAdmin ? 'Administrátor' : 'Čitateľ');
        adminStatus.style.color = isAdmin ? 'var(--success-text)' : 'var(--text-muted)';
        adminStatus.hidden = !currentUser;
    }

    if (signOutButton) signOutButton.hidden = !currentUser || passwordRecoveryPending;
    if (adminControls) adminControls.style.display = isAdmin ? 'block' : 'none';
}

async function refreshAuthState(session) {
    currentUser = session?.user || null;
    isAdmin = false;

    if (currentUser) {
        const { data, error } = await supabaseClient.rpc('is_library_admin');
        if (error) {
            console.error('Nepodarilo sa overiť administrátorskú rolu:', error);
            showAuthMessage('Prihlásenie prebehlo, ale rolu účtu sa nepodarilo overiť.', 'error');
        } else {
            isAdmin = data === true;
        }
    }

    updateAuthUi();
    if (!isAdmin) {
        closeAdminBorrowsModal();
        currentActiveBorrows = [];
        const adminList = document.getElementById('adminBorrowsList');
        if (adminList) adminList.replaceChildren();
    }
    if (!currentUser) closeBorrowModal();
    await loadBooks();

    if (document.getElementById('userBorrowsModal')?.style.display === 'flex') {
        await loadUserBorrows();
    }
    if (isAdmin && document.getElementById('adminBorrowsModal')?.style.display === 'flex') {
        await loadAdminBorrows();
    }
}

async function signIn(event) {
    event.preventDefault();
    const email = document.getElementById('authEmail')?.value.trim().toLowerCase();
    const password = document.getElementById('authPassword')?.value;

    if (!email || !password) {
        showAuthMessage('Zadajte e-mail a heslo.', 'error');
        return;
    }

    try {
        const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) throw error;

        document.getElementById('authPassword').value = '';
        showAuthMessage('', 'info');
    } catch (error) {
        showAuthMessage(`Prihlásenie sa nepodarilo: ${error.message || 'Chyba spojenia.'}`, 'error');
    }
}

async function signUp() {
    const form = document.getElementById('authForm');
    if (form && !form.reportValidity()) return;

    const email = document.getElementById('authEmail')?.value.trim().toLowerCase();
    const password = document.getElementById('authPassword')?.value;

    if (!email || !password) {
        showAuthMessage('Na vytvorenie účtu zadajte e-mail a heslo.', 'error');
        return;
    }

    try {
        const { data, error } = await supabaseClient.auth.signUp({
            email,
            password,
            options: { emailRedirectTo: window.location.href.split('#')[0] }
        });

        if (error) throw error;

        document.getElementById('authPassword').value = '';
        if (data.session) {
            showAuthMessage('Účet bol vytvorený a prihlásenie prebehlo úspešne.', 'success');
        } else {
            showAuthMessage('Účet bol vytvorený. Potvrďte ho cez odkaz, ktorý sme poslali e-mailom.', 'success');
        }
    } catch (error) {
        showAuthMessage(`Účet sa nepodarilo vytvoriť: ${error.message || 'Chyba spojenia.'}`, 'error');
    }
}

async function requestPasswordReset() {
    const emailInput = document.getElementById('authEmail');
    if (!emailInput?.reportValidity()) return;

    const email = emailInput.value.trim().toLowerCase();
    if (!email) {
        showAuthMessage('Najprv zadajte e-mailovú adresu.', 'error');
        return;
    }

    try {
        const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
            redirectTo: window.location.href.split('#')[0]
        });

        if (error) throw error;
        showAuthMessage('Ak účet existuje, bol naň odoslaný odkaz na obnovu hesla.', 'success');
    } catch (error) {
        showAuthMessage(`Odkaz na obnovu hesla sa nepodarilo odoslať: ${error.message || 'Chyba spojenia.'}`, 'error');
    }
}

async function updatePassword(event) {
    event.preventDefault();
    const password = document.getElementById('newPassword')?.value;
    const confirmation = document.getElementById('confirmNewPassword')?.value;

    if (!password || password.length < 8) {
        showAuthMessage('Nové heslo musí mať aspoň 8 znakov.', 'error');
        return;
    }

    if (password !== confirmation) {
        showAuthMessage('Heslá sa nezhodujú.', 'error');
        return;
    }

    try {
        const { error } = await supabaseClient.auth.updateUser({ password });
        if (error) throw error;

        passwordRecoveryPending = false;
        document.getElementById('resetPasswordForm')?.reset();
        updateAuthUi();
        showAuthMessage('Heslo bolo zmenené.', 'success');
    } catch (error) {
        showAuthMessage(`Heslo sa nepodarilo zmeniť: ${error.message || 'Chyba spojenia.'}`, 'error');
    }
}

async function signOut() {
    try {
        const { error } = await supabaseClient.auth.signOut();
        if (error) throw error;
        showAuthMessage('Boli ste odhlásený/-á.', 'success');
    } catch (error) {
        showAuthMessage(`Odhlásenie sa nepodarilo: ${error.message || 'Chyba spojenia.'}`, 'error');
    }
}

function initializeAuth() {
    supabaseClient.auth.onAuthStateChange((event, session) => {
        if (event === 'PASSWORD_RECOVERY') passwordRecoveryPending = true;
        if (event === 'SIGNED_OUT') passwordRecoveryPending = false;
        window.setTimeout(() => {
            refreshAuthState(session).catch(error => {
                console.error('Chyba pri obnove stavu prihlásenia:', error);
                showAuthMessage('Nepodarilo sa načítať stav prihlásenia.', 'error');
            });
        }, 0);
    });
}

function toggleImportBox() {
    const importBox = document.getElementById('importBox');
    if (importBox) {
        importBox.style.display = importBox.style.display === 'none' ? 'block' : 'none';
    }
}

function openAdminBorrowsModal() {
    if (!isAdmin) {
        showAuthMessage('Táto funkcia je dostupná iba administrátorovi.', 'error');
        return;
    }

    const modal = document.getElementById('adminBorrowsModal');
    if (modal) {
        modal.style.display = 'flex';
    }

    const filterSelect = document.getElementById('adminFilterSelect');
    if (filterSelect) {
        filterSelect.value = 'list-date-desc';
    }

    loadAdminBorrows();
}

function closeAdminBorrowsModal() {
    const modal = document.getElementById('adminBorrowsModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

async function loadAdminBorrows() {
    const container = document.getElementById('adminBorrowsList');
    if (!container) return;
    if (!isAdmin) {
        container.textContent = 'Na zobrazenie prehľadu sa prihláste ako administrátor.';
        return;
    }

    container.innerHTML = '<p style="text-align: center; color: var(--text-muted);">Načítavam výpožičky...</p>';

    try {
        const { data: vypozicky, error } = await supabaseClient
            .from('vypozicky')
            .select(`
                id,
                meno,
                email,
                datum_vypozicania,
                posledna_pripomienka,
                kniha_id,
                knihy ( nazov, autor )
            `)
            .is('datum_vratenia', null);

        if (error) throw error;

        currentActiveBorrows = vypozicky || [];
        renderAdminBorrows();
    } catch (error) {
        console.error('Chyba pri načítaní administrátorského prehľadu:', error);
        container.textContent = `Prehľad výpožičiek sa nepodarilo načítať: ${error.message || 'Neznáma chyba'}`;
    }
}

function renderAdminBorrows() {
    const container = document.getElementById('adminBorrowsList');
    if (!container) return;

    const filterSelect = document.getElementById('adminFilterSelect');
    const filterValue = filterSelect ? filterSelect.value : 'list-date-desc';

    if (!currentActiveBorrows || currentActiveBorrows.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--text-muted); padding: 20px;">Žiadne aktívne výpožičky sa nenašli.</p>';
        return;
    }

    const getBookInfo = (v) => {
        const bookData = Array.isArray(v.knihy) ? v.knihy[0] : v.knihy;
        return {
            nazov: bookData?.nazov || 'Neznáma kniha',
            autor: bookData?.autor || 'Neznámy autor'
        };
    };

    if (filterValue.startsWith('list-')) {
        let sorted = [...currentActiveBorrows];

        if (filterValue === 'list-date-desc') {
            sorted.sort((a, b) => new Date(b.datum_vypozicania) - new Date(a.datum_vypozicania));
        } else if (filterValue === 'list-date-asc') {
            sorted.sort((a, b) => new Date(a.datum_vypozicania) - new Date(b.datum_vypozicania));
        } else if (filterValue === 'list-email-asc') {
            sorted.sort((a, b) => (a.email || '').localeCompare(b.email || ''));
        } else if (filterValue === 'list-email-desc') {
            sorted.sort((a, b) => (b.email || '').localeCompare(a.email || ''));
        }

        let html = `
            <div style="overflow-x: auto;">
                <table>
                    <thead>
                        <tr>
                            <th>Kniha</th>
                            <th>Autor</th>
                            <th>Čitateľ</th>
                            <th>E-mail</th>
                            <th>Dátum výpožičky</th>
                            <th style="text-align: center;">Akcie</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        sorted.forEach(v => {
            const { nazov, autor } = getBookInfo(v);
            const datum = new Date(v.datum_vypozicania).toLocaleString('sk-SK', {
                day: '2-digit', month: '2-digit', year: 'numeric'
            }).replaceAll(' ', '');

            html += `
                <tr>
                    <td><strong>${escapeHtml(nazov)}</strong></td>
                    <td>${escapeHtml(autor)}</td>
                    <td>${escapeHtml(v.meno || '-')}</td>
                    <td><a href="mailto:${escapeHtml(v.email)}" style="color: var(--primary);">${escapeHtml(v.email)}</a></td>
                    <td>${datum}</td>
                    <td style="text-align: center;">
                        <button
                            type="button"
                            style="padding: 6px 12px; font-size: 12px; background: #eab308; color: white; border: none; border-radius: 6px; cursor: pointer;"
                            data-action="send-reminder"
                            data-loan-id="${v.id}">
                            ✉️ Pripomienka
                        </button>
                    </td>
                </tr>
            `;
        });

        html += '</tbody></table></div>';
        container.innerHTML = html;
    } else if (filterValue.startsWith('user-')) {
        let userMap = {};

        currentActiveBorrows.forEach(v => {
            const emailKey = (v.email || 'Neznámy e-mail').toLowerCase();
            if (!userMap[emailKey]) {
                userMap[emailKey] = {
                    meno: v.meno || 'Neznáme meno',
                    email: v.email,
                    count: 0,
                    oldestDate: new Date(v.datum_vypozicania),
                    books: []
                };
            }
            userMap[emailKey].count++;

            const { nazov } = getBookInfo(v);
            userMap[emailKey].books.push(nazov);

            const d = new Date(v.datum_vypozicania);
            if (d < userMap[emailKey].oldestDate) {
                userMap[emailKey].oldestDate = d;
            }
        });

        let topUsers = Object.values(userMap);

        if (filterValue === 'user-count-desc') {
            topUsers.sort((a, b) => b.count - a.count || a.oldestDate - b.oldestDate);
        } else if (filterValue === 'user-oldest-asc') {
            topUsers.sort((a, b) => a.oldestDate - b.oldestDate);
        } else if (filterValue === 'user-email-asc') {
            topUsers.sort((a, b) => (a.email || '').localeCompare(b.email || ''));
        }

        let html = `
            <div style="overflow-x: auto;">
                <table>
                    <thead>
                        <tr>
                            <th>Čitateľ</th>
                            <th>E-mail</th>
                            <th>Počet kníh</th>
                            <th>Najstaršia výpožička</th>
                            <th>Zoznam kníh</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        topUsers.forEach(u => {
            const oldestFormatted = u.oldestDate.toLocaleString('sk-SK', { day: '2-digit', month: '2-digit', year: 'numeric' });
            html += `
                <tr>
                    <td><strong>${escapeHtml(u.meno)}</strong></td>
                    <td><a href="mailto:${escapeHtml(u.email)}" style="color: var(--primary);">${escapeHtml(u.email)}</a></td>
                    <td><span class="badge badge-available">${u.count} ks</span></td>
                    <td><span style="color: #c2410c; font-weight: 600;">${oldestFormatted}</span></td>
                    <td style="font-size: 13px; color: var(--text-muted);">${escapeHtml(u.books.join(', '))}</td>
                </tr>
            `;
        });

        html += '</tbody></table></div>';
        container.innerHTML = html;
    }
}

// ==========================================
// ODOSLANIE MANUÁLNEJ PRIPOMIENKY CEZ EMAILJS
// ==========================================
async function sendManualReminder(loan) {
    if (!isAdmin) {
        showAuthMessage('Pripomienky môže odosielať iba administrátor.', 'error');
        return;
    }

    if (!loan.email) {
        alert('Čitateľ nemá zadaný e-mail!');
        return;
    }

    const isFirstReminder = !loan.posledna_pripomienka;
    const reminder = buildReminderEmail(isFirstReminder, loan);

    if (!confirm(`Poslať ${isFirstReminder ? 'prvú' : 'ďalšiu'} pripomienku používateľovi ${loan.email}?`)) {
        return;
    }

    try {
        const sent = await sendEmailJsTemplate(
            EMAILJS_REMINDER_TEMPLATE_ID,
            loan.email,
            reminder.subject,
            reminder.bodyHtml
        );
        if (!sent) {
            alert('Pripomienku sa nepodarilo odoslať cez EmailJS.');
            return;
        }

        const { error: updateError } = await supabaseClient
            .from('vypozicky')
            .update({ posledna_pripomienka: new Date().toISOString().slice(0, 10) })
            .eq('id', loan.id);

        if (updateError) {
            throw new Error(`E-mail bol odoslaný, ale dátum pripomienky sa nepodarilo uložiť: ${updateError.message}`);
        }

        alert(`Pripomienka bola úspešne odoslaná na: ${loan.email}`);

        await loadAdminBorrows();

    } catch (err) {
        console.error('Chyba pri odosielaní e-mailu:', err);
        alert(err.message || 'Nepodarilo sa odoslať e-mail. Skontrolujte nastavenia EmailJS.');
    }
}

// ==========================================
// IMPORT NOVÝCH KNÍH Z EXCELU
// ==========================================
async function importBooksFromExcel() {
    if (!isAdmin) {
        showAuthMessage('Import kníh môže spustiť iba administrátor.', 'error');
        return;
    }

    const fileInput = document.getElementById('excelFileInput');
    const progressDiv = document.getElementById('importProgress');
    const previewDiv = document.getElementById('importPreview');
    const confirmButton = document.getElementById('confirmBookImportButton');

    if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
        if (progressDiv) progressDiv.innerText = 'Najprv vyberte Excel súbor.';
        return;
    }

    const file = fileInput.files[0];
    pendingBookImport = null;
    if (confirmButton) confirmButton.style.display = 'none';
    if (previewDiv) {
        previewDiv.replaceChildren();
        previewDiv.style.display = 'none';
    }

    if (progressDiv) {
        progressDiv.innerText = 'Kontrolujem Excel súbor. Zatiaľ sa nič nemení v databáze...';
    }

    const reader = new FileReader();

    reader.onload = async function(e) {
        try {
            if (typeof XLSX === 'undefined') {
                throw new Error('Knižnica XLSX nie je načítaná v index.html.');
            }

            const workbook = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            if (!worksheet) {
                throw new Error('Excel súbor neobsahuje čitateľný hárok.');
            }

            const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: '', blankrows: true });

            if (!jsonData || jsonData.length === 0) {
                throw new Error('Vybraný súbor je prázdny.');
            }

            const { books, issues } = parseBookRows(jsonData);

            if (!issues.length) {
                if (progressDiv) progressDiv.innerText = 'Porovnávam knihy s databázou...';

                const existingBooks = [];
                const pageSize = 1000;
                for (let offset = 0; ; offset += pageSize) {
                    const { data, error: fetchError } = await supabaseClient
                        .from('knihy')
                        .select('id, nazov, autor')
                        .order('id', { ascending: true })
                        .range(offset, offset + pageSize - 1);

                    if (fetchError) {
                        throw new Error(`Nepodarilo sa overiť existujúce knihy: ${fetchError.message}`);
                    }

                    existingBooks.push(...(data || []));
                    if (!data || data.length < pageSize) break;
                }

                const existingBookKeys = new Set(existingBooks.map(book =>
                    makeBookKey(book.nazov, book.autor || 'Neznámy autor')
                ));
                const existingIds = new Set(existingBooks.map(book => String(book.id)));

                books.forEach(book => {
                    if (existingBookKeys.has(makeBookKey(book.nazov, book.autor))) {
                        issues.push({
                            row: book.row_number,
                            message: 'Kniha s rovnakým názvom a autorom už v databáze existuje.'
                        });
                    }
                    if (book.source_id !== null && existingIds.has(String(book.source_id))) {
                        issues.push({
                            row: book.row_number,
                            message: `ID ${book.source_id} už používa kniha v databáze.`
                        });
                    }
                });
            }

            if (issues.length) {
                renderBookImportPreview(books, issues);
                if (progressDiv) {
                    progressDiv.innerText = `Import zablokovaný: nájdených ${issues.length} problémov. Databáza nebola zmenená.`;
                }
                return;
            }

            pendingBookImport = books;
            renderBookImportPreview(books, []);
            if (progressDiv) progressDiv.innerText = 'Kontrola je úspešná. Import zatiaľ nebol spustený.';
            if (confirmButton) confirmButton.style.display = 'block';
        } catch (err) {
            console.error('Chyba pri kontrole importu kníh:', err);
            if (progressDiv) progressDiv.innerText = `Kontrola zlyhala: ${err.message || 'Neznáma chyba'}`;
        }
    };

    reader.onerror = function() {
        if (progressDiv) progressDiv.innerText = 'Excel súbor sa nepodarilo načítať.';
    };

    reader.readAsArrayBuffer(file);
}

function renderBookImportPreview(books, issues) {
    const previewDiv = document.getElementById('importPreview');
    if (!previewDiv) return;

    previewDiv.replaceChildren();
    previewDiv.style.display = 'block';

    const summary = document.createElement('p');
    summary.textContent = issues.length
        ? `Nájdených kandidátov: ${books.length}. Pri problémoch sa nezapíše žiadna kniha.`
        : `Na import: ${books.length} nových kníh. ID pridelí databáza; zadané ID v Exceli slúžia len na kontrolu kolízií.`;
    previewDiv.appendChild(summary);

    if (issues.length) {
        const issueList = document.createElement('ul');
        issues.forEach(issue => {
            const item = document.createElement('li');
            item.textContent = issue.row ? `Riadok ${issue.row}: ${issue.message}` : issue.message;
            issueList.appendChild(item);
        });
        previewDiv.appendChild(issueList);
        return;
    }

    const bookList = document.createElement('ul');
    books.forEach(book => {
        const item = document.createElement('li');
        item.textContent = `${book.nazov} — ${book.autor}; kategória: ${book.kategoria || 'neuvedená'}; kusov: ${book.pocet_celkovo}`;
        bookList.appendChild(item);
    });
    previewDiv.appendChild(bookList);
}

async function confirmBookImport() {
    if (!isAdmin) {
        showAuthMessage('Import kníh môže spustiť iba administrátor.', 'error');
        return;
    }
    if (!pendingBookImport || pendingBookImport.length === 0) {
        showAuthMessage('Najprv skontrolujte Excel súbor.', 'error');
        return;
    }

    const confirmButton = document.getElementById('confirmBookImportButton');
    const progressDiv = document.getElementById('importProgress');
    if (confirmButton) confirmButton.disabled = true;
    if (progressDiv) progressDiv.innerText = 'Vkladám knihy v jednej databázovej transakcii...';

    try {
        const { data: insertedCount, error } = await supabaseClient.rpc('import_new_books', {
            p_books: pendingBookImport.map(({ nazov, autor, kategoria, pocet_celkovo, source_id }) => ({
                nazov,
                autor,
                kategoria,
                pocet_celkovo,
                source_id
            }))
        });

        if (error) {
            throw new Error(error.message);
        }

        if (progressDiv) progressDiv.innerText = `Import dokončený: vložených ${insertedCount} nových kníh.`;
        pendingBookImport = null;
        if (confirmButton) confirmButton.style.display = 'none';
        const fileInput = document.getElementById('excelFileInput');
        if (fileInput) fileInput.value = '';
        await loadBooks();
    } catch (err) {
        console.error('Transakčný import kníh zlyhal:', err);
        pendingBookImport = null;
        if (confirmButton) confirmButton.style.display = 'none';
        if (progressDiv) {
            progressDiv.innerText = `Import sa nepodarilo potvrdiť: ${err.message || 'Neznáma chyba'}. Pred opakovaním obnovte katalóg a skontrolujte, či sa knihy vložili.`;
        }
    } finally {
        if (confirmButton) confirmButton.disabled = false;
    }
}

// ==========================================
// INICIALIZÁCIA A OBSLUHA UDALOSTÍ
// ==========================================
function getBookInfo(borrow) {
    const bookData = Array.isArray(borrow.knihy) ? borrow.knihy[0] : borrow.knihy;
    return {
        nazov: bookData?.nazov || 'Neznáma kniha',
        autor: bookData?.autor || 'Neznámy autor'
    };
}

document.addEventListener('DOMContentLoaded', () => {
    if (typeof emailjs !== 'undefined' && EMAILJS_PUBLIC_KEY) {
        try {
            emailjs.init(EMAILJS_PUBLIC_KEY);
        } catch (error) {
            console.error('EmailJS sa nepodarilo inicializovať:', error);
        }
    }

    document.getElementById('authForm')?.addEventListener('submit', signIn);
    document.getElementById('borrowForm')?.addEventListener('submit', submitBorrowForm);
    document.getElementById('resetPasswordForm')?.addEventListener('submit', updatePassword);
    document.getElementById('adminFilterSelect')?.addEventListener('change', renderAdminBorrows);
    document.getElementById('searchInput')?.addEventListener('input', filterAndRenderBooks);
    document.getElementById('searchModeFilter')?.addEventListener('change', filterAndRenderBooks);
    document.getElementById('categoryFilter')?.addEventListener('change', filterAndRenderBooks);
    document.getElementById('availabilityFilter')?.addEventListener('change', filterAndRenderBooks);
    const feedbackModal = document.getElementById('feedbackModal');
    feedbackModal?.addEventListener('click', event => {
        if (event.target === feedbackModal) closeFeedbackModal();
    });
    document.addEventListener('keydown', event => {
        if (!feedbackModal || feedbackModal.style.display !== 'flex') return;

        if (event.key === 'Escape') {
            event.preventDefault();
            closeFeedbackModal();
            return;
        }

        if (event.key !== 'Tab') return;
        const focusableButtons = Array.from(feedbackModal.querySelectorAll('button:not([hidden]):not(:disabled)'));
        if (focusableButtons.length === 0) {
            event.preventDefault();
            document.getElementById('feedbackDialog')?.focus();
            return;
        }

        const firstButton = focusableButtons[0];
        const lastButton = focusableButtons[focusableButtons.length - 1];
        if (event.shiftKey && document.activeElement === firstButton) {
            event.preventDefault();
            lastButton.focus();
        } else if (!event.shiftKey && document.activeElement === lastButton) {
            event.preventDefault();
            firstButton.focus();
        }
    });
    document.getElementById('excelFileInput')?.addEventListener('change', () => {
        pendingBookImport = null;
        const previewDiv = document.getElementById('importPreview');
        const confirmButton = document.getElementById('confirmBookImportButton');
        const progressDiv = document.getElementById('importProgress');
        if (previewDiv) {
            previewDiv.replaceChildren();
            previewDiv.style.display = 'none';
        }
        if (confirmButton) confirmButton.style.display = 'none';
        if (progressDiv) progressDiv.innerText = '';
    });

    document.addEventListener('click', event => {
        if (!(event.target instanceof Element)) return;
        const button = event.target.closest('[data-action]');
        if (!button) return;

        switch (button.dataset.action) {
            case 'close-feedback':
                closeFeedbackModal();
                break;
            case 'confirm-feedback':
                confirmFeedbackModal();
                break;
            case 'open-user-borrows':
                openUserBorrowsModal();
                break;
            case 'close-user-borrows':
                closeUserBorrowsModal();
                break;
            case 'open-admin-borrows':
                openAdminBorrowsModal();
                break;
            case 'close-admin-borrows':
                closeAdminBorrowsModal();
                break;
            case 'close-borrow':
                closeBorrowModal();
                break;
            case 'borrow': {
                const book = allBooks.find(item => String(item.id) === button.dataset.bookId);
                if (book) openBorrowModal(book.id, book.nazov);
                break;
            }
            case 'return-book':
                returnBook(button.dataset.borrowId, button.dataset.bookTitle);
                break;
            case 'send-reminder': {
                if (!isAdmin) {
                    showAuthMessage('Táto funkcia je dostupná iba administrátorovi.', 'error');
                    break;
                }
                const loan = currentActiveBorrows.find(item => String(item.id) === button.dataset.loanId);
                if (!loan) {
                    alert('Výpožička sa už nenašla. Obnovte prehľad a skúste to znova.');
                    break;
                }
                sendManualReminder(loan);
                break;
            }
            case 'toggle-import':
                toggleImportBox();
                break;
            case 'import-books':
                importBooksFromExcel();
                break;
            case 'confirm-book-import':
                confirmBookImport();
                break;
            case 'previous-books-page':
                changeBookPage(currentBookPage - 1);
                break;
            case 'next-books-page':
                changeBookPage(currentBookPage + 1);
                break;
            case 'toggle-catalog-filters':
                toggleCatalogFilters();
                break;
            case 'clear-catalog-filters':
                clearCatalogFilters();
                break;
            case 'sign-up':
                signUp();
                break;
            case 'request-password-reset':
                requestPasswordReset();
                break;
            case 'sign-out':
                signOut();
                break;
        }
    });

    initializeAuth();
});
