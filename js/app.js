// ==========================================
// SUPABASE KONFIGURÁCIA
// ==========================================
const SUPABASE_URL = 'https://hgocqneltjwtbudchwue.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_YfzIcERfJJ8jOaNxTPtztQ_mWIxP9w2';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ==========================================
// EMAILJS KONFIGURÁCIA A GLOBÁLNE PREMENNÉ
// ==========================================
const EMAILJS_SERVICE_ID = 'service_asu2c7y';
const EMAILJS_TEMPLATE_ID = 'template_k6evr7k';
const EMAILJS_PUBLIC_KEY = 'nZ22RG4hDzt5rj5d-';

let allBooks = [];
let activeBorrows = [];
let currentActiveBorrows = [];
let isAdmin = false;

// ==========================================
// POMOCNÉ FUNKCIE (HELPERS)
// ==========================================
function escapeHtml(text) {
    if (!text) return '';
    return String(text).replace(/[&<>"']/g, m => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[m]);
}

function escapeQuotes(str) {
    return (str || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

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

        // 1. Načítanie aktívnych výpožičiek (kde nie je dátum vrátenia)
        const { data: borrowsData, error: borrowsError } = await supabaseClient
            .from('vypozicky')
            .select('*')
            .is('datum_vratenia', null);

        if (borrowsError) {
            console.error('Chyba Supabase (vypozicky):', borrowsError);
            throw new Error(`Tabuľka vypozicky: ${borrowsError.message}`);
        }
        activeBorrows = borrowsData || [];

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
            container.innerHTML = `<p style="color: var(--danger-text); padding: 20px; text-align: center; grid-column: 1/-1;"><strong>Chyba:</strong> ${err.message}</p>`;
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

function filterAndRenderBooks() {
    const searchInput = document.getElementById('searchInput') || document.querySelector('.search-box');
    const categorySelect = document.getElementById('categorySelect') || document.querySelector('.category-select');

    const query = searchInput ? searchInput.value.toLowerCase().trim() : '';
    const selectedCategory = categorySelect ? categorySelect.value : '';

    const filtered = allBooks.filter(book => {
        const matchesQuery = (book.nazov || '').toLowerCase().includes(query) || 
                             (book.autor || '').toLowerCase().includes(query);
        const matchesCategory = selectedCategory === '' || (book.kategoria || 'Všeobecné') === selectedCategory;

        return matchesQuery && matchesCategory;
    });

    renderBooks(filtered);
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
        const currentlyBorrowedCount = activeBorrows.filter(b => b.kniha_id === book.id).length;
        const availableCount = Math.max(0, (book.pocet_celkovo || 1) - currentlyBorrowedCount);
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
                    onclick="${isAvailable ? `openBorrowModal(${book.id}, '${escapeQuotes(book.nazov)}')` : ''}"
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
    const modal = document.getElementById('borrowModal');
    const bookIdInput = document.getElementById('borrowBookId');
    const bookTitleDiv = document.getElementById('borrowModalBookTitle');

    if (bookIdInput) bookIdInput.value = bookId;
    if (bookTitleDiv) bookTitleDiv.innerText = bookTitle;

    const currentUserEmailSpan = document.getElementById('currentUserEmail');
    const borrowEmailInput = document.getElementById('borrowEmail');
    if (currentUserEmailSpan && borrowEmailInput && currentUserEmailSpan.innerText !== 'Neprihlásený') {
        borrowEmailInput.value = currentUserEmailSpan.innerText;
    }

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

async function submitBorrowForm(event) {
    if (event) event.preventDefault();

    const bookId = document.getElementById('borrowBookId')?.value;
    const nameInput = document.getElementById('borrowName')?.value.trim();
    const emailInput = document.getElementById('borrowEmail')?.value.trim().toLowerCase();

    if (!bookId || !nameInput || !emailInput) {
        alert('Prosím, vyplňte všetky požadované údaje.');
        return;
    }

    try {
        const { error } = await supabaseClient
            .from('vypozicky')
            .insert([
                {
                    kniha_id: parseInt(bookId),
                    meno: nameInput,
                    email: emailInput,
                    datum_vypozicania: new Date().toISOString(),
                    stav: 'Požičaná'
                }
            ]);

        if (error) {
            console.error('Chyba pri zápise výpožičky do Supabase:', error);
            alert('Chyba pri vytváraní výpožičky: ' + error.message);
            return;
        }

        const currentUserEmailSpan = document.getElementById('currentUserEmail');
        if (currentUserEmailSpan) {
            currentUserEmailSpan.innerText = emailInput;
        }

        alert('Kniha bola úspešne vypožičaná!');
        closeBorrowModal();
        await loadBooks();

    } catch (err) {
        console.error('Kritická chyba v submitBorrowForm:', err);
        alert('Pri spracovaní výpožičky nastala chyba.');
    }
}

// ==========================================
// 3. MODÁLNE OKNO: MOJE VÝPOŽIČKY (ČITATEĽ)
// ==========================================
function openUserBorrowsModal() {
    const modal = document.getElementById('userBorrowsModal');
    if (modal) {
        modal.style.display = 'flex';
        
        const emailInput = document.getElementById('userModalEmail');
        const currentUserEmailSpan = document.getElementById('currentUserEmail');
        
        if (emailInput && currentUserEmailSpan && currentUserEmailSpan.innerText !== 'Neprihlásený') {
            emailInput.value = currentUserEmailSpan.innerText;
            loadUserBorrows();
        }
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
    const emailInput = document.getElementById('userModalEmail');
    const container = document.getElementById('userBorrowsList');

    if (!emailInput || !container) return;

    const email = emailInput.value.trim().toLowerCase();

    if (!email) {
        container.innerHTML = '<p style="text-align: center; color: var(--danger-text); padding: 10px;">Zadajte prosím váš e-mail.</p>';
        return;
    }

    const currentUserEmailSpan = document.getElementById('currentUserEmail');
    if (currentUserEmailSpan) {
        currentUserEmailSpan.innerText = email;
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
            .eq('email', email)
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
                        <button class="btn-return" onclick="returnBook(${item.id})">Vrátiť</button>
                    </td>
                </tr>
            `;
        });

        html += '</tbody></table>';
        container.innerHTML = html;

    } catch (err) {
        console.error('Chyba v loadUserBorrows:', err);
        container.innerHTML = `<p style="text-align: center; color: var(--danger-text); padding: 10px;">Chyba pri načítaní: ${err.message}</p>`;
    }
}

async function returnBook(borrowId) {
    if (!confirm('Naozaj chcete vrátiť túto knihu?')) return;

    try {
        const { error } = await supabaseClient
            .from('vypozicky')
            .update({ 
                stav: 'Vrátená',
                datum_vratenia: new Date().toISOString() 
            })
            .eq('id', borrowId);

        if (error) {
            console.error('Chyba Supabase pri vrátení knihy:', error);
            alert('Chyba pri vrátení knihy: ' + error.message);
            return;
        }

        alert('Kniha bola úspešne vrátená!');
        
        await loadUserBorrows();
        if (isAdmin) await loadAdminBorrows();
        await loadBooks();

    } catch (err) {
        console.error('Kritická chyba pri vrátení knihy:', err);
        alert('Kritická chyba pri spracovaní vrátenia.');
    }
}

// ==========================================
// 4. ADMIN SEKCIA A PRIHLÁSENIE
// ==========================================
async function checkAdmin() {
    const emailInput = document.getElementById('adminEmail');
    const passwordInput = document.getElementById('adminPassword');
    const statusSpan = document.getElementById('adminStatus');
    const adminControls = document.getElementById('adminControls');

    if (!emailInput || !passwordInput) return;

    const email = emailInput.value.trim().toLowerCase();
    const password = passwordInput.value.trim();

    if (!email || !password) {
        alert('Zadajte e-mail aj heslo administrátora.');
        return;
    }

    try {
        const { data: adminData, error } = await supabaseClient
            .from('admini')
            .select('*')
            .eq('email', email)
            .eq('heslo', password)
            .maybeSingle();

        if (error) {
            console.error('Chyba pri overovaní admina:', error);
            alert('Chyba pri overovaní v databáze: ' + error.message);
            return;
        }

        if (adminData) {
            isAdmin = true;
            
            if (statusSpan) {
                statusSpan.innerText = `Status: Prihlásený (${adminData.email})`;
                statusSpan.style.color = 'var(--success-text)';
            }
            
            if (adminControls) {
                adminControls.style.display = 'block';
            }

            const adminOnlyElements = document.querySelectorAll('.admin-only');
            adminOnlyElements.forEach(el => el.style.display = 'block');
            
            emailInput.value = '';
            passwordInput.value = '';
            
            alert('Úspešne prihlásený ako Administrátor.');
        } else {
            alert('Nesprávny e-mail alebo heslo administrátora!');
            if (statusSpan) {
                statusSpan.innerText = 'Status: Bežný používateľ';
                statusSpan.style.color = 'var(--text-muted)';
            }
        }
    } catch (err) {
        console.error('Kritická chyba pri overení admina:', err);
        alert('Pri overovaní administratora nastala chyba.');
    }
}

function toggleImportBox() {
    const importBox = document.getElementById('importBox');
    if (importBox) {
        importBox.style.display = importBox.style.display === 'none' ? 'block' : 'none';
    }
}

function openAdminBorrowsModal() {
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

    container.innerHTML = '<p style="text-align: center; color: var(--text-muted);">Načítavam výpožičky...</p>';

    const { data: vypozicky, error } = await supabaseClient
        .from('vypozicky')
        .select(`
            id,
            meno,
            email,
            datum_vypozicania,
            kniha_id,
            knihy ( nazov, autor )
        `)
        .is('datum_vratenia', null);

    if (error) {
        container.innerHTML = `<p style="color: var(--danger-text);">Chyba: ${error.message}</p>`;
        return;
    }

    currentActiveBorrows = vypozicky || [];
    renderAdminBorrows();
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
                    <td><a href="mailto:${v.email}" style="color: var(--primary);">${escapeHtml(v.email)}</a></td>
                    <td>${datum}</td>
                    <td style="text-align: center;">
                        <button 
                            type="button" 
                            style="padding: 6px 12px; font-size: 12px; background: #eab308; color: white; border: none; border-radius: 6px; cursor: pointer;" 
                            onclick="sendManualReminder('${v.id}', '${escapeQuotes(v.email)}', '${escapeQuotes(v.meno)}', '${escapeQuotes(nazov)}', '${escapeQuotes(autor)}', '${v.datum_vypozicania}')">
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
                    <td><a href="mailto:${u.email}" style="color: var(--primary);">${escapeHtml(u.email)}</a></td>
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
async function sendManualReminder(vypozickaId, email, meno, nazovKnihy, autor, datumVypozicania) {
    if (!email) {
        alert('Čitateľ nemá zadaný e-mail!');
        return;
    }

    if (!confirm(`Poslať pripomienkový e-mail používateľovi ${email}?`)) {
        return;
    }

    try {
        if (typeof emailjs === 'undefined') {
            alert('EmailJS nie je načítaný! Skontrolujte, či je v index.html pridaný <script> pre EmailJS.');
            return;
        }

        let pocetDni = 0;
        let formattedDate = '';

        if (datumVypozicania) {
            const datumBorrow = new Date(datumVypozicania);

            // Kontrola, či je dátum platný
            if (!isNaN(datumBorrow.getTime())) {
                const dnes = new Date();
                
                // Vynulovanie časov pre presný výpočet celých dní
                dnes.setHours(0, 0, 0, 0);
                datumBorrow.setHours(0, 0, 0, 0);

                const rozdielCasu = dnes - datumBorrow;
                pocetDni = Math.floor(rozdielCasu / (1000 * 60 * 60 * 24));
                if (pocetDni < 0) pocetDni = 0;

                // Vyformátovanie dátumu na slovenský tvar bez medzier (napr. 13.09.2026)
                formattedDate = datumBorrow.toLocaleDateString('sk-SK', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric'
                }).replaceAll(' ', '');
            } else {
                console.warn('Neplatný formát dátumu výpožičky:', datumVypozicania);
            }
        }

        await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
            email: email,
            meno: meno || 'čitateľ',
            nazov_knihy: nazovKnihy || 'Kniha',
            autor: autor || '',
            datum_vypozicania: formattedDate, 
            pocet_dni: pocetDni
        });

        console.log(`datum: ${formattedDate}, pocet dni: ${pocetDni}`);

        // 2. Aktualizácia atribútu posledna_pripomienka v Supabase
        const dnesDna = new Date().toISOString().split('T')[0]; // Dátum vo formáte YYYY-MM-DD
        
        const { error: updateError } = await supabaseClient
            .from('vypozicky')
            .update({ posledna_pripomienka: dnesDna })
            .eq('id', vypozickaId);

        if (updateError) {
            console.error('Chyba pri aktualizácii poslednej pripomienky v DB:', updateError);
        } else {
            console.log(`Dátum poslednej pripomienky bol úspešne aktualizovaný pre výpožičku ID ${vypozickaId}.`);
        }

        alert(`Pripomienka bola úspešne odoslaná na: ${email} (požičané dňa ${formattedDate} - ${pocetDni} dní)`);

        // Ak máte v aplikácii funkciu na znovunačítanie zoznamu výpožičiek, zavolajte ju tu (napr. loadLoans()):
        if (typeof renderAdminLoans === 'function') {
            renderAdminLoans();
        }

    } catch (err) {
        console.error('Chyba pri odosielaní e-mailu:', err);
        alert('Nepodarilo sa odoslať e-mail. Skontrolujte nastavenia EmailJS.');
    }
}

// ==========================================
// IMPORT KNÍH Z EXCELU DO SUPABASE (PÁROVANIE: NÁZOV + AUTOR)
// ==========================================
async function importBooksFromExcel() {
    const fileInput = document.getElementById('excelFileInput');
    const progressDiv = document.getElementById('importProgress');

    if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
        alert('Prosím, vyberte Excel súbor pre import.');
        return;
    }

    const file = fileInput.files[0];

    if (progressDiv) {
        progressDiv.innerText = 'Spracovávam Excel súbor...';
    }

    const reader = new FileReader();

    reader.onload = async function(e) {
        try {
            const excelBuffer = new Uint8Array(e.target.result);
            
            if (typeof XLSX === 'undefined') {
                alert('Knižnica XLSX nie je načítaná v index.html!');
                if (progressDiv) progressDiv.innerText = '';
                return;
            }

            const workbook = XLSX.read(excelBuffer, { type: 'array' });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            
            const jsonData = XLSX.utils.sheet_to_json(worksheet);

            if (!jsonData || jsonData.length === 0) {
                alert('Vybraný súbor je prázdny.');
                if (progressDiv) progressDiv.innerText = '';
                return;
            }

            if (progressDiv) {
                progressDiv.innerText = 'Načítavam existujúce knihy z databázy...';
            }

            // 1. Načítanie existujúcich kníh zo Supabase
            const { data: existingBooks, error: fetchError } = await supabaseClient
                .from('knihy')
                .select('id, nazov, autor, kategoria, pocet_celkovo, pocet_dostupnych');

            if (fetchError) {
                console.error('Chyba pri načítaní existujúcich kníh:', fetchError);
                alert('Chyba pri načítaní dát zo Supabase: ' + fetchError.message);
                if (progressDiv) progressDiv.innerText = 'Import zlyhal.';
                return;
            }

            // Mapa existujúcich kníh podľa dvojice "nazov|autor" (malými písmenami)
            const existingMap = new Map();
            (existingBooks || []).forEach(b => {
                if (b.nazov) {
                    const nazovClean = b.nazov.trim().toLowerCase();
                    const autorClean = (b.autor || 'Neznámy autor').trim().toLowerCase();
                    const compoundKey = `${nazovClean}|${autorClean}`;
                    existingMap.set(compoundKey, b);
                }
            });

            const toInsert = [];
            let updatedCount = 0;
            let skippedCount = 0;
            let lastCategory = ''; // Dedenie kategórie z predošlého riadku

            if (progressDiv) {
                progressDiv.innerText = 'Porovnávam dáta z Excelu...';
            }

            // 2. Prechádzanie riadkov z Excelu
            for (const row of jsonData) {
                const rawNazov = (row['Názov knihy'] || row['Nazov knihy'] || '').toString().trim();
                const rawAutor = (row['Autor'] || 'Neznámy autor').toString().trim();
                let rawKategoria = (row['Kategória'] || row['Kategoria'] || '').toString().trim();
                const rawPocet = parseInt(row['Počet kusov'] || row['Pocet kusov'] || 1, 10) || 1;

                if (!rawNazov) continue; // Preskočiť prázdne riadky

                // Dedenie kategórie ak je bunka prázdna
                if (rawKategoria) {
                    lastCategory = rawKategoria;
                } else {
                    rawKategoria = lastCategory;
                }

                // Zloženie unikátneho kľúča: nazov + autor
                const compoundKey = `${rawNazov.toLowerCase()}|${rawAutor.toLowerCase()}`;
                const existing = existingMap.get(compoundKey);

                if (existing) {
                    // Kniha s rovnakým NÁZVOM aj AUTOROM existuje -> kontrola Kategórie a Počtu kusov
                    const sameKategoria = (existing.kategoria || '').trim() === rawKategoria;
                    const samePocetCelkovo = parseInt(existing.pocet_celkovo, 10) === rawPocet;

                    if (sameKategoria && samePocetCelkovo) {
                        // Všetko je rovnaké -> NEROBIŤ NIČ
                        skippedCount++;
                    } else {
                        // Zmenila sa kategória alebo počet kusov -> UPDATE
                        const staryCelkovo = parseInt(existing.pocet_celkovo, 10) || 0;
                        const staryDostupnych = parseInt(existing.pocet_dostupnych, 10) || 0;
                        const vypocitane = staryCelkovo - staryDostupnych;
                        
                        let novyDostupnych = rawPocet - vypocitane;
                        if (novyDostupnych < 0) novyDostupnych = 0;

                        const { error: updateError } = await supabaseClient
                            .from('knihy')
                            .update({
                                autor: rawAutor,
                                kategoria: rawKategoria,
                                pocet_celkovo: rawPocet,
                                pocet_dostupnych: novyDostupnych
                            })
                            .eq('id', existing.id);

                        if (updateError) {
                            console.error(`Chyba pri aktualizácii knihy ID ${existing.id}:`, updateError);
                        } else {
                            updatedCount++;
                        }
                    }
                } else {
                    // Dvojica Názov + Autor v databáze neexistuje -> INSERT novej knihy
                    toInsert.push({
                        nazov: rawNazov,
                        autor: rawAutor,
                        kategoria: rawKategoria,
                        pocet_celkovo: rawPocet,
                        pocet_dostupnych: rawPocet
                    });
                }
            }

            // 3. Vloženie nových kníh do Supabase
            let insertedCount = 0;
            if (toInsert.length > 0) {
                const { error: insertError } = await supabaseClient
                    .from('knihy')
                    .insert(toInsert);

                if (insertError) {
                    console.error('Chyba pri vkladaní nových kníh:', insertError);
                    alert('Chyba pri pridávaní nových kníh: ' + insertError.message);
                } else {
                    insertedCount = toInsert.length;
                }
            }

            const resultMsg = `Import dokončený!\n- Nové knihy: ${insertedCount}\n- Aktualizované: ${updatedCount}\n- Bez zmeny (preskočené): ${skippedCount}`;
            
            if (progressDiv) {
                progressDiv.innerText = `✅ Nové: ${insertedCount} | Aktualizované: ${updatedCount} | Preskočené: ${skippedCount}`;
            }

            alert(resultMsg);
            
            fileInput.value = '';
            if (typeof loadBooks === 'function') {
                loadBooks();
            }

        } catch (err) {
            console.error('Chyba spracovania:', err);
            alert('Pri spracovaní súboru nastala chyba.');
            if (progressDiv) progressDiv.innerText = 'Chyba spracovania.';
        }
    };

    reader.readAsArrayBuffer(file);
}

// ==========================================
// FILTROVANIE A VYHĽADÁVANIE KNÍH
// ==========================================
function filterBooks() {
    const searchInput = document.getElementById('searchInput');
    const categorySelect = document.getElementById('categoryFilter');
    
    const query = searchInput ? searchInput.value.toLowerCase().trim() : '';
    const selectedCategory = categorySelect ? categorySelect.value : 'all';

    // Ak existuje pole allBooks (globálne pole načítaných kníh zo Supabase)
    if (typeof allBooks !== 'undefined' && Array.isArray(allBooks)) {
        const filtered = allBooks.filter(book => {
            const matchesSearch = (book.nazov || '').toLowerCase().includes(query) || 
                                  (book.autor || '').toLowerCase().includes(query);
            const matchesCategory = (selectedCategory === 'all' || selectedCategory === '' || book.kategoria === selectedCategory);
            
            return matchesSearch && matchesCategory;
        });

        // Ak máte funkciu na vykreslenie kníh (napr. renderBooks), zavoláme ju s vyfiltrovaným zoznamom
        if (typeof renderBooks === 'function') {
            renderBooks(filtered);
        } else if (typeof displayBooks === 'function') {
            displayBooks(filtered);
        }
    }
}

// ==========================================
// 5. INICIALIZÁCIA PO NAČÍTANÍ STRÁNKY
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM načítaný, inicializujem aplikáciu...');

    if (typeof emailjs !== 'undefined' && typeof EMAILJS_PUBLIC_KEY !== 'undefined' && EMAILJS_PUBLIC_KEY !== '') {
        try {
            emailjs.init(EMAILJS_PUBLIC_KEY);
            console.log('EmailJS bol úspešne inicializovaný.');
        } catch (e) {
            console.error('Chyba pri inicializácii EmailJS:', e);
        }
    }

    // Poslucháče udalostí pre dynamické vyhľadávanie a filtrovanie kníh
    const searchInput = document.getElementById('searchInput') || document.querySelector('.search-box');
    const categorySelect = document.getElementById('categorySelect') || document.querySelector('.category-select');

    if (searchInput) {
        searchInput.addEventListener('input', filterAndRenderBooks);
    }
    if (categorySelect) {
        categorySelect.addEventListener('change', filterAndRenderBooks);
    }

    loadBooks();
});