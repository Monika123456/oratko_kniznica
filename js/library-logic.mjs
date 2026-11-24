const HTML_ESCAPE_CHARACTERS = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
};

function getDateParts(value) {
    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) return null;
        return [value.getFullYear(), value.getMonth() + 1, value.getDate()];
    }

    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
    if (match) {
        const parts = [Number(match[1]), Number(match[2]), Number(match[3])];
        const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
        if (
            date.getUTCFullYear() !== parts[0]
            || date.getUTCMonth() !== parts[1] - 1
            || date.getUTCDate() !== parts[2]
        ) {
            return null;
        }
        return parts;
    }

    const parsedDate = new Date(value);
    if (Number.isNaN(parsedDate.getTime())) return null;
    return [parsedDate.getFullYear(), parsedDate.getMonth() + 1, parsedDate.getDate()];
}

export function escapeHtml(text) {
    if (!text) return '';
    return String(text).replace(/[&<>"']/g, character => HTML_ESCAPE_CHARACTERS[character]);
}

export function formatEmailDate(value) {
    const parts = getDateParts(value);
    if (!parts) return 'neznámy';

    return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]))
        .toLocaleDateString('sk-SK', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            timeZone: 'UTC'
        })
        .replaceAll(' ', '');
}

export function daysBetweenDates(startDate, endDate = new Date()) {
    const startParts = getDateParts(startDate);
    const endParts = getDateParts(endDate);
    if (!startParts || !endParts) return 0;

    const start = Date.UTC(startParts[0], startParts[1] - 1, startParts[2]);
    const end = Date.UTC(endParts[0], endParts[1] - 1, endParts[2]);
    return Math.max(0, Math.floor((end - start) / 86400000));
}

export function parseBookRows(jsonData) {
    const headers = jsonData.flatMap(row => Object.keys(row || {}));
    const idHeader = headers.find(header => ['id', 'id knihy', 'kniha_id'].includes(
        String(header).trim().toLowerCase()
    ));
    const findCell = (row, names) => {
        const key = Object.keys(row).find(header => names.includes(String(header).trim().toLowerCase()));
        return key ? row[key] : '';
    };
    const normalizeIdentityPart = value => String(value ?? '')
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase();
    const makeBookKey = (title, author) =>
        `${normalizeIdentityPart(title)}|${normalizeIdentityPart(author)}`;
    const issues = [];
    const books = [];
    const seenBookKeys = new Map();
    const seenSourceIds = new Map();
    let lastCategory = '';

    jsonData.forEach((row, index) => {
        if (!Object.values(row).some(value => String(value ?? '').trim() !== '')) {
            return;
        }

        const rowNumber = index + 2;
        const title = String(findCell(row, ['názov knihy', 'nazov knihy']) || '').trim();
        const author = String(findCell(row, ['autor']) || 'Neznámy autor').trim() || 'Neznámy autor';
        let category = String(findCell(row, ['kategória', 'kategoria']) || '').trim();
        const rawCount = findCell(row, ['počet kusov', 'pocet kusov']);
        const count = rawCount === '' || rawCount === null || rawCount === undefined
            ? 1
            : Number(rawCount);
        const rawSourceId = idHeader ? row[idHeader] : '';
        const sourceIdText = String(rawSourceId ?? '').trim();
        const sourceId = sourceIdText ? Number(sourceIdText) : null;

        if (!title) {
            issues.push({ row: rowNumber, message: 'Chýba názov knihy.' });
            return;
        }

        if (!Number.isSafeInteger(count) || count < 1 || count > 2147483647) {
            issues.push({ row: rowNumber, message: 'Počet kusov musí byť kladné celé číslo.' });
            return;
        }

        if (sourceIdText && (!Number.isSafeInteger(sourceId) || sourceId < 1)) {
            issues.push({ row: rowNumber, message: 'ID musí byť kladné celé číslo.' });
            return;
        }

        if (category) {
            lastCategory = category;
        } else {
            category = lastCategory;
        }

        const bookKey = makeBookKey(title, author);
        if (seenBookKeys.has(bookKey)) {
            issues.push({
                row: rowNumber,
                message: `Duplicitná kniha v súbore (rovnaký názov a autor ako v riadku ${seenBookKeys.get(bookKey)}).`
            });
        } else {
            seenBookKeys.set(bookKey, rowNumber);
        }

        if (sourceId !== null) {
            if (seenSourceIds.has(sourceId)) {
                issues.push({
                    row: rowNumber,
                    message: `Duplicitné ID ${sourceId} v súbore (prvýkrát je v riadku ${seenSourceIds.get(sourceId)}).`
                });
            } else {
                seenSourceIds.set(sourceId, rowNumber);
            }
        }

        books.push({
            nazov: title,
            autor: author,
            kategoria: category,
            pocet_celkovo: count,
            source_id: sourceId,
            row_number: rowNumber
        });
    });

    if (!books.length && !issues.length) {
        issues.push({ row: null, message: 'Súbor neobsahuje žiadne riadky s knihami.' });
    }

    return { books, issues };
}
