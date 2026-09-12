// js/components/BorrowingsAdminModal.js

export function renderBorrowingsAdminModal(containerElement, borrowingsData) {
    // Vytvorenie HTML štruktúry modálneho okna s 1 filtračným boxom
    containerElement.innerHTML = `
        <div id="borrowingsModal" class="modal-backdrop hidden">
            <div class="modal-content">
                
                <!-- Hlavička -->
                <div class="modal-header">
                    <h2>Prehľad výpožičiek (Admin)</h2>
                    <button id="closeModalBtn" class="close-btn">&times;</button>
                </div>

                <!-- JEDINÝ FILTRAČNÝ BOX -->
                <div class="filter-bar">
                    <label for="mainFilterSelect">Zobraziť výpožičky:</label>
                    <select id="mainFilterSelect" class="filter-select">
                        <option value="all_newest">Všetky (Od najnovších)</option>
                        <option value="pending">Čakajúce na schválenie</option>
                        <option value="active">Aktívne (Prebiehajúce)</option>
                        <option value="overdue">Po termíne</option>
                        <option value="completed">Ukončené (Vrátené)</option>
                        <option value="oldest">Všetky (Od najstarších)</option>
                    </select>
                </div>

                <!-- Telo s tabuľkou -->
                <div class="modal-body">
                    <table class="borrowing-table">
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>Používateľ</th>
                                <th>Položka</th>
                                <th>Dátum</th>
                                <th>Stav</th>
                            </tr>
                        </thead>
                        <tbody id="borrowingsTableBody">
                            <!-- Riadky sa vygenerujú cez JS -->
                        </tbody>
                    </table>
                </div>

            </div>
        </div>
    `;

    // Načítanie prvkov z modálu
    const modal = document.getElementById('borrowingsModal');
    const closeModalBtn = document.getElementById('closeModalBtn');
    const mainFilterSelect = document.getElementById('mainFilterSelect');
    const tableBody = document.getElementById('borrowingsTableBody');

    // Funkcia na zavretie
    const closeModal = () => modal.classList.add('hidden');
    
    closeModalBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    // Funkcia na filtrovanie a vykreslenie tabuľky
    function updateTable() {
        const selectedOption = mainFilterSelect.value;
        let filteredData = [...borrowingsData];

        switch (selectedOption) {
            case 'pending':
                filteredData = filteredData.filter(b => b.status === 'PENDING');
                break;
            case 'active':
                filteredData = filteredData.filter(b => b.status === 'ACTIVE');
                break;
            case 'overdue':
                filteredData = filteredData.filter(b => b.status === 'OVERDUE');
                break;
            case 'completed':
                filteredData = filteredData.filter(b => b.status === 'RETURNED');
                break;
            case 'oldest':
                filteredData.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
                break;
            case 'all_newest':
            default:
                filteredData.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
                break;
        }

        tableBody.innerHTML = '';

        if (filteredData.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center; color: var(--text-muted); padding: 20px;">Žiadne výpožičky nezodpovedajú tomuto filtru.</td></tr>`;
            return;
        }

        filteredData.forEach(item => {
            const tr = document.createElement('tr');
            let badgeClass = 'badge-pending';
            if (item.status === 'ACTIVE') badgeClass = 'badge-active';
            if (item.status === 'OVERDUE') badgeClass = 'badge-overdue';
            if (item.status === 'RETURNED') badgeClass = 'badge-returned';

            tr.innerHTML = `
                <td>#${item.id}</td>
                <td><strong>${item.userName}</strong></td>
                <td>${item.itemName}</td>
                <td>${item.formattedDate}</td>
                <td><span class="badge ${badgeClass}">${item.status}</span></td>
            `;
            tableBody.appendChild(tr);
        });
    }

    // Reakcia na zmenu vo filtri
    mainFilterSelect.addEventListener('change', updateTable);

    // Vykresliť tabuľku prvýkrát
    updateTable();

    // Vrátime funkciu na otvorenie modálu
    return function openModal() {
        modal.classList.remove('hidden');
    };
}