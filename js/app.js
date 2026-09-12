// ==========================================
// KONFIGURÁCIA EMAILJS A GLOBÁLNE PREMENNÉ
// ==========================================
// Sem neskôr vložíte vaše kľúče z EmailJS.com
const EMAILJS_SERVICE_ID = 'service_asu2c7y';
const EMAILJS_TEMPLATE_ID = 'template_k6evr7k';

let currentActiveBorrows = [];

// ==========================================
// 1. NAČÍTANIE A ZOBRAZENIE KNÍH
// ==========================================

async function loadBooks() {
  const container = document.getElementById('booksGrid');
  if (!container) return;

  container.innerHTML = '<p style="text-align:center; grid-column: 1/-1;">Načítavam knihy...</p>';

  try {
    const { data: books, error } = await supabaseClient
      .from('knihy')
      .select('*')
      .order('nazov', { ascending: true });

    if (error) throw error;

    renderBooks(books || []);
  } catch (err) {
    console.error('Chyba pri načítaní kníh:', err);
    container.innerHTML = `<p style="color:red; grid-column: 1/-1;">Chyba pri načítaní kníh: ${err.message}</p>`;
  }
}

function renderBooks(books) {
  const container = document.getElementById('booksGrid');
  if (!container) return;

  if (books.length === 0) {
    container.innerHTML = '<p style="text-align:center; grid-column: 1/-1;">Žiadne knihy sa nenašli.</p>';
    return;
  }

  let html = '';
  books.forEach(book => {
    const isAvailable = book.dostupna !== false;
    const badgeClass = isAvailable ? 'badge-available' : 'badge-unavailable';
    const badgeText = isAvailable ? 'Dostupná' : 'Vypožičaná';

    html += `
      <div class="book-card">
        <div>
          <div class="book-category">${book.kategoria || 'Všeobecné'}</div>
          <div class="book-title">${book.nazov || 'Bez názvu'}</div>
          <div class="book-author">${book.autor || 'Neznámy autor'}</div>
        </div>
        <div class="book-footer">
          <span class="badge ${badgeClass}">${badgeText}</span>
          ${isAvailable ? `<button class="btn-borrow" onclick="openBorrowModal(${book.id}, '${escapeQuotes(book.nazov)}')">Vypožičať</button>` : ''}
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

// ==========================================
// 2. MODAL 1: VYPOŽIČANIE KNIHY POUŽÍVATEĽOM
// ==========================================

let selectedBookId = null;

function openBorrowModal(bookId, bookTitle) {
  selectedBookId = bookId;
  const modal = document.getElementById('borrowModal');
  const titleEl = document.getElementById('modalBookTitle');
  
  if (titleEl) titleEl.innerText = bookTitle;
  if (modal) modal.style.display = 'flex';
}

function closeBorrowModal() {
  const modal = document.getElementById('borrowModal');
  if (modal) modal.style.display = 'none';
  selectedBookId = null;
}

async function handleBorrowSubmit(event) {
  event.preventDefault();

  const meno = document.getElementById('borrowerName')?.value.trim();
  const email = document.getElementById('borrowerEmail')?.value.trim();

  if (!meno || !email || !selectedBookId) {
    alert('Prosím vyplňte všetky údaje.');
    return;
  }

  try {
    // 1. Záznam do tabuľky vypozicky
    const { error: borrowErr } = await supabaseClient
      .from('vypozicky')
      .insert([
        {
          kniha_id: selectedBookId,
          meno: meno,
          email: email,
          datum_vypozicania: new Date().toISOString()
        }
      ]);

    if (borrowErr) throw borrowErr;

    // 2. Aktualizácia stavu knihy na nedostupnú
    const { error: bookErr } = await supabaseClient
      .from('knihy')
      .update({ dostupna: false })
      .eq('id', selectedBookId);

    if (bookErr) throw bookErr;

    alert('Kniha bola úspešne vypožičaná!');
    closeBorrowModal();
    loadBooks();
  } catch (err) {
    console.error('Chyba pri vypožičaní:', err);
    alert(`Chyba: ${err.message}`);
  }
}

// ==========================================
// 3. ADMIN PRIHLÁSENIE A PRÁVA
// ==========================================

function toggleAdminView(isAdmin) {
  const adminElements = document.querySelectorAll('.admin-only');
  adminElements.forEach(el => {
    el.style.display = isAdmin ? 'block' : 'none';
  });
}

function checkAdminAuth() {
  const pass = prompt('Zadajte heslo pre admina:');
  if (pass === 'admin123') { // Upravte svoje heslo podľa potreby
    alert('Prihlásenie úspešné!');
    toggleAdminView(true);
  } else {
    alert('Nesprávne heslo!');
  }
}

// ==========================================
// 4. MODAL 2: SPRÁVA VÝPOŽIČIEK PRE ADMINA
// ==========================================

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
    container.innerHTML = `<p style="color: red;">Chyba: ${error.message}</p>`;
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

  // 1. POHĽAD: Zoznam výpožičiek
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
              <th>Akcie</th>
            </tr>
          </thead>
          <tbody>
    `;

    sorted.forEach(v => {
      const { nazov, autor } = getBookInfo(v);
      const datum = new Date(v.datum_vypozicania).toLocaleString('sk-SK', {
        day: '2-digit', month: '2-digit', year: 'numeric'
      });

      html += `
        <tr>
          <td><strong>${nazov}</strong></td>
          <td>${autor}</td>
          <td>${v.meno || '-'}</td>
          <td><a href="mailto:${v.email}" style="color: var(--primary);">${v.email}</a></td>
          <td>${datum}</td>
          <td style="display: flex; gap: 6px;">
            <button 
              type="button" 
              class="btn-return"
              onclick="adminReturnBook(${v.id}, ${v.kniha_id})">
              Vrátiť
            </button>
            <button 
              type="button" 
              style="padding: 6px 10px; font-size: 12px; background: #eab308; color: white; border: none; border-radius: 6px; cursor: pointer;" 
              onclick="sendManualReminder('${escapeQuotes(v.email)}', '${escapeQuotes(v.meno)}', '${escapeQuotes(nazov)}', '${escapeQuotes(autor)}', '${datum}')">
              ✉️ Pripomienka
            </button>
          </td>
        </tr>
      `;
    });

    html += '</tbody></table></div>';
    container.innerHTML = html;
  } 
  // 2. POHĽAD: Agregovaný po používateľoch
  else if (filterValue.startsWith('user-')) {
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
      topUsers.sort((a, b) => b.count - a.count);
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
          <td><strong>${u.meno}</strong></td>
          <td><a href="mailto:${u.email}" style="color: var(--primary);">${u.email}</a></td>
          <td><span class="badge badge-available">${u.count} ks</span></td>
          <td><span style="color: #c2410c; font-weight: 600;">${oldestFormatted}</span></td>
          <td style="font-size: 13px; color: var(--text-muted);">${u.books.join(', ')}</td>
        </tr>
      `;
    });

    html += '</tbody></table></div>';
    container.innerHTML = html;
  }
}

// Funkcia na vrátenie knihy adminom
async function adminReturnBook(vypozickaId, knihaId) {
  if (!confirm('Naozaj chcete označiť túto knihu ako vrátenú?')) return;

  try {
    // 1. Záznam dátumu vrátenia
    const { error: borrowErr } = await supabaseClient
      .from('vypozicky')
      .update({ datum_vratenia: new Date().toISOString() })
      .eq('id', vypozickaId);

    if (borrowErr) throw borrowErr;

    // 2. Nastavenie knihy ako dostupnej
    const { error: bookErr } = await supabaseClient
      .from('knihy')
      .update({ dostupna: true })
      .eq('id', knihaId);

    if (bookErr) throw bookErr;

    alert('Kniha bola označená ako vrátená!');
    loadAdminBorrows();
    loadBooks();
  } catch (err) {
    console.error('Chyba pri vrátení knihy:', err);
    alert(`Chyba: ${err.message}`);
  }
}

// Funkcia pre ručné odoslanie pripomienky cez EmailJS
async function sendManualReminder(email, meno, nazovKnihy, autor, datumVypozicania) {
  if (!email) {
    alert('Čitateľ nemá zadaný e-mail!');
    return;
  }

  if (!confirm(`Poslať pripomienkový e-mail používateľovi ${email}?`)) {
    return;
  }

  try {
    if (typeof emailjs === 'undefined') {
      alert('EmailJS nie je načítaný! Skontrolujte skript v index.html');
      return;
    }

    await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
      email: email,
      meno: meno || 'čitateľ',
      nazov_knihy: nazovKnihy,
      autor: autor || '',
      datum_vypozicania: datumVypozicania
    });

    alert(`Pripomienka bola úspešne odoslaná na: ${email}`);
  } catch (err) {
    console.error('Chyba pri odosielaní e-mailu:', err);
    alert('Nepodarilo sa odoslať e-mail. Skontrolujte nastavenia EmailJS.');
  }
}

// Pomocná funkcia pre ošetrenie úvodzoviek v HTML atribútoch
function escapeQuotes(str) {
  return (str || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

// ==========================================
// 5. INICIALIZÁCIA PO NAČÍTANÍ STRÁNKY
// ==========================================

document.addEventListener('DOMContentLoaded', () => {
  loadBooks();
});