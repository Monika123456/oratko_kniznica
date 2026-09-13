const { createClient } = require('@supabase/supabase-js');

// Načítanie premenných z prostredia (GitHub Secrets)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const EMAILJS_SERVICE_ID = process.env.EMAILJS_SERVICE_ID;
const EMAILJS_TEMPLATE_ID = process.env.EMAILJS_TEMPLATE_ID;
const EMAILJS_PUBLIC_KEY = process.env.EMAILJS_PUBLIC_KEY;
const EMAILJS_PRIVATE_KEY = process.env.EMAILJS_PRIVATE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function runAutomaticReminders() {
    console.log('--- Štart automatických pripomienok ---');
    const dnes = new Date();
    const dnesStr = dnes.toISOString().split('T')[0];

    try {
        // 1. Načítanie nastavenia intervalu pre pripomienku
        const { data: setting, error: settingErr } = await supabase
            .from('nastavenia')
            .select('hodnota')
            .eq('kluc', 'pocet_dni_pripomienka')
            .single();

        if (settingErr || !setting) {
            console.error('Chyba pri načítaní nastavenia intervalu:', settingErr);
            return;
        }

        const intervalDni = parseInt(setting.hodnota, 10);
        console.log(`Nakonfigurovaný interval: ${intervalDni} dní.`);

        // 2. Načítanie nevrátených výpožičiek
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

        if (loansErr) {
            console.error('Chyba pri načítaní výpožičiek:', loansErr);
            return;
        }

        let sentCount = 0;

        for (const loan of loans) {
            if (!loan.email || !loan.datum_vypozicania) continue;

            // Ak už dnes pripomienka odišla, preskočíme
            if (loan.posledna_pripomienka === dnesStr) {
                console.log(`Preskakujem ${loan.email} ${loan.kniha_id} (dnes už odoslané).`);
                continue;
            }

            const datumBorrow = new Date(loan.datum_vypozicania);
            if (isNaN(datumBorrow.getTime())) continue;

            // Výpočet dní
            const dnesDni = new Date(dnes.getFullYear(), dnes.getMonth(), dnes.getDate()).getTime();
            const startDni = new Date(datumBorrow.getFullYear(), datumBorrow.getMonth(), datumBorrow.getDate()).getTime();
            const pocetDni = Math.floor((dnesDni - startDni) / (1000 * 60 * 60 * 24));

            // Podmienka pre odoslanie (30, 60, 90... dní)
            if (pocetDni > 0 && pocetDni % intervalDni === 0) {
                const den = String(datumBorrow.getDate()).padStart(2, '0');
                const mesiac = String(datumBorrow.getMonth() + 1).padStart(2, '0');
                const rok = datumBorrow.getFullYear();
                const formattedDate = `${den}.${mesiac}.${rok}`;

                // Volanie EmailJS cez REST API
                const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        service_id: EMAILJS_SERVICE_ID,
                        template_id: EMAILJS_TEMPLATE_ID,
                        user_id: EMAILJS_PUBLIC_KEY,
                        accessToken: EMAILJS_PRIVATE_KEY, // <-- Potrebné pre Strict Mode
                        template_params: {
                            email: loan.email,
                            meno: loan.meno || 'čitateľ',
                            nazov_knihy: loan.knihy?.nazov || 'Kniha',  // <-- Zmena: loan.knihy.nazov
                            autor: loan.knihy?.autor || '',             // <-- Zmena: loan.knihy.autor
                            datum_vypozicania: formattedDate,
                            pocet_dni: pocetDni
                        }
                    })
                });

                if (response.ok) {
                    // Zapíšeme dnešný dátum do posledna_pripomienka
                    await supabase
                        .from('vypozicky')
                        .update({ posledna_pripomienka: dnesStr })
                        .eq('id', loan.id);

                    console.log(`✅ Pripomienka odoslaná na ${loan.email} (${pocetDni} dní).`);
                    sentCount++;
                } else {
                    const errText = await response.text();
                    console.error(`❌ Chyba EmailJS pre ${loan.email}:`, errText);
                }
            }
        }

        console.log(`--- Dokončené. Celkovo odoslaných: ${sentCount} ---`);
    } catch (err) {
        console.error('Kritická chyba v spúšťacom skripte:', err);
    }
}

runAutomaticReminders();