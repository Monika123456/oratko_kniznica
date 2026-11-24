const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const EMAILJS_SERVICE_ID = process.env.EMAILJS_SERVICE_ID;
const EMAILJS_TEMPLATE_ID = process.env.EMAILJS_TEMPLATE_ID;
const EMAILJS_PUBLIC_KEY = process.env.EMAILJS_PUBLIC_KEY;
const EMAILJS_PRIVATE_KEY = process.env.EMAILJS_PRIVATE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const MS_PER_DAY = 86400000;

function getUtcDateParts(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
    if (!match) return null;

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

function dateDifferenceInDays(startValue, endValue) {
    const startParts = getUtcDateParts(startValue);
    const endParts = getUtcDateParts(endValue);
    if (!startParts || !endParts) return null;

    const start = Date.UTC(startParts[0], startParts[1] - 1, startParts[2]);
    const end = Date.UTC(endParts[0], endParts[1] - 1, endParts[2]);
    return Math.floor((end - start) / MS_PER_DAY);
}

function formatEmailDate(value) {
    const parts = getUtcDateParts(value);
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

function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[character]);
}

function buildReminderEmail(loan, isFirstReminder, daysBorrowed) {
    const bookData = Array.isArray(loan.knihy) ? loan.knihy[0] : loan.knihy;
    const meno = escapeHtml(loan.meno || 'čitateľ');
    const nazovKnihy = escapeHtml(bookData?.nazov || 'Kniha');
    const autor = escapeHtml(bookData?.autor || '');
    const datumVypozicania = escapeHtml(formatEmailDate(loan.datum_vypozicania));

    const intro = isFirstReminder
        ? `Veríme, že Ti kniha <strong>„${nazovKnihy}“</strong> od autora <strong>${autor}</strong> robí príjemnú spoločnosť.`
        : `Evidujeme, že kniha <strong>„${nazovKnihy}“</strong> od autora <strong>${autor}</strong> je stále požičaná. Požičal(a) si si ju dňa <strong>${datumVypozicania}</strong>, teda už <strong>${daysBorrowed} dní</strong>.`;
    const followUp = isFirstReminder
        ? 'Pokojne si ju dočítaj vlastným tempom. Chceli sme Ti len dať vedieť, ako letí čas, a pripomenúť, že keď budeš mať knihu dočítanú, v knižnici sa na ňu určite tešia aj ďalší čitatelia.'
        : 'Ak si knihu už vrátil(a), prosíme, daj nám vedieť, aby sme mohli opraviť evidenciu. Ak ju ešte máš, prosíme o jej vrátenie, keď to bude možné.';

    return {
        subject: isFirstReminder
            ? 'Pripomienka k požičanej knihe'
            : 'Opakovaná pripomienka k požičanej knihe',
        body_html: `
            <div style="font-family: system-ui, sans-serif, Arial; font-size: 16px;">
                <h2>Ahoj, ${meno}</h2>
                <p>${intro}</p>
                <div style="background-color: #f0f7ff; border: 1px solid #bae0ff; border-left: 4px solid #1890ff; border-radius: 6px; padding: 12px 16px; margin: 15px 0;">
                    <p style="margin: 0; font-size: 15px; line-height: 1.5;">📖 Knihu máš požičanú od <strong>${datumVypozicania}</strong>, t.j. <strong style="color: #092b00; font-size: 16px;">${daysBorrowed} dní</strong>.</p>
                </div>
                <p>${followUp}</p>
                <p>Želáme Ti krásne a nerušené čítanie!</p>
                <hr>
                <p>S pozdravom,<br><strong>Tvoja Oratkovská Knižnica</strong></p>
            </div>
        `
    };
}

async function runAutomaticReminders() {
    console.log('--- Štart automatických pripomienok ---');
    const dnesStr = new Date().toISOString().slice(0, 10);

    try {
        const { data: setting, error: settingErr } = await supabase
            .from('nastavenia')
            .select('hodnota')
            .eq('kluc', 'pocet_dni_pripomienka')
            .single();

        if (settingErr) throw new Error(`Chyba pri načítaní intervalu pripomienok: ${settingErr.message}`);
        if (!setting) throw new Error('Nastavenie intervalu pripomienok sa nenašlo.');

        const intervalDni = Number(setting.hodnota);
        if (!Number.isInteger(intervalDni) || intervalDni <= 0) {
            throw new Error(`Neplatný interval pripomienok: ${setting.hodnota}`);
        }

        console.log(`Nakonfigurovaný interval: ${intervalDni} dní.`);

        const { data: loans, error: loansErr } = await supabase
            .from('vypozicky')
            .select(`
                *,
                knihy (
                    nazov,
                    autor
                )
            `)
            .is('datum_vratenia', null);

        if (loansErr) throw new Error(`Chyba pri načítaní výpožičiek: ${loansErr.message}`);

        let sentCount = 0;

        for (const loan of loans || []) {
            if (!loan.email) {
                console.warn(`Výpožička ID ${loan.id} nemá e-mail; pripomienka sa preskakuje.`);
                continue;
            }

            const daysBorrowed = dateDifferenceInDays(loan.datum_vypozicania, dnesStr);
            if (daysBorrowed === null || daysBorrowed < 0) {
                console.warn(`Výpožička ID ${loan.id} má neplatný dátum požičania; pripomienka sa preskakuje.`);
                continue;
            }

            const isFirstReminder = !loan.posledna_pripomienka;
            const referenceDate = loan.posledna_pripomienka || loan.datum_vypozicania;
            const daysSinceReference = dateDifferenceInDays(referenceDate, dnesStr);

            if (daysSinceReference === null || daysSinceReference < intervalDni) continue;

            const reminder = buildReminderEmail(loan, isFirstReminder, daysBorrowed);

            try {
                const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        service_id: EMAILJS_SERVICE_ID,
                        template_id: EMAILJS_TEMPLATE_ID,
                        user_id: EMAILJS_PUBLIC_KEY,
                        accessToken: EMAILJS_PRIVATE_KEY,
                        template_params: {
                            email: loan.email,
                            subject: reminder.subject,
                            body_html: reminder.body_html
                        }
                    })
                });

                if (!response.ok) {
                    const errText = await response.text();
                    console.error(`Chyba EmailJS pre výpožičku ID ${loan.id}:`, errText);
                    continue;
                }

                const { error: updateError } = await supabase
                    .from('vypozicky')
                    .update({ posledna_pripomienka: dnesStr })
                    .eq('id', loan.id);

                if (updateError) {
                    console.error(`Pripomienka bola odoslaná pre výpožičku ID ${loan.id}, ale dátum sa neuložil:`, updateError);
                    continue;
                }

                console.log(`Pripomienka odoslaná na ${loan.email} (${daysBorrowed} dní).`);
                sentCount++;
            } catch (error) {
                console.error(`Chyba pri spracovaní pripomienky pre výpožičku ID ${loan.id}:`, error);
            }
        }

        console.log(`--- Dokončené. Celkovo odoslaných: ${sentCount} ---`);
    } catch (err) {
        console.error('Kritická chyba v spúšťacom skripte:', err);
        process.exitCode = 1;
    }
}

runAutomaticReminders();
