
const express = require('express');
const { 
    saveUserDailyChoice, 
    getUserChoicesForWeek,
    getArchivedMenuForWeek, 
    getMenuTemplate,        
    DAY_DISPLAY_NAMES       
} = require('../database'); 
const { isAuthenticated } = require('../middleware/authMiddleware');
const { 
    getWeekStartDate, 
    formatDateToYYYYMMDD, 
    getWorkWeekDaysForDate,
    formatDateToDDMMYYYY 
} = require('../utils/dateUtils'); 

const router = express.Router();

// GET /dashboard - Prikazuje jelovnik i korisničke odabire za odabrani/tekući tjedan
router.get('/dashboard', isAuthenticated, async (req, res) => {
    console.log('[GET /dashboard] Ulaz u rutu. Query:', req.query);
    try {
        const userId = req.session.user.id;
        const weekQuery = req.query.week; 
        let targetReferenceDate;

        if (weekQuery && /^\d{4}-\d{2}-\d{2}$/.test(weekQuery)) {
            // Ako korisnik EKSPLICITNO traži tjedan (npr. klikom na "Prethodni"), koristi taj tjedan.
            try {
                targetReferenceDate = new Date(weekQuery + "T00:00:00Z");
                if (isNaN(targetReferenceDate.getTime())) {
                    // Ako je datum neispravan, preusmjeri na default (idući tjedan)
                    const today = new Date();
                    const nextWeek = new Date(today.setDate(today.getDate() + 7));
                    return res.redirect(`/dashboard?week=${formatDateToYYYYMMDD(getWeekStartDate(nextWeek))}`);
                }
            } catch (e) {
                 const today = new Date();
                 const nextWeek = new Date(today.setDate(today.getDate() + 7));
                 return res.redirect(`/dashboard?week=${formatDateToYYYYMMDD(getWeekStartDate(nextWeek))}`);
            }
        } else {
            // *** GLAVNA PROMJENA OVDJE ***
            // Ako korisnik NIJE specificirao tjedan (npr. nakon prijave), zadani tjedan je SLJEDEĆI.
            const today = new Date();
            const nextWeek = new Date(today.setDate(today.getDate() + 7));
            targetReferenceDate = nextWeek; // Postavi referentni datum na tjedan dana od danas

            if (weekQuery) {
                 console.warn(`[GET /dashboard] Neispravan format 'week' (${weekQuery}), koristim IDUĆI tjedan kao zadani.`);
            }
        }

        const targetWeekStartDate = getWeekStartDate(targetReferenceDate);
        const targetWeekStartDateString = formatDateToYYYYMMDD(targetWeekStartDate);
        
        const workWeekDaysForTarget = getWorkWeekDaysForDate(targetWeekStartDate);
        
        
        let displayedMenu = await getArchivedMenuForWeek(targetWeekStartDateString);
        let isTargetMenuPublished = true;
        if (!displayedMenu) {
            console.log(`[GET /dashboard] Nema arhiviranog menija za tjedan ${targetWeekStartDateString}, prikazujem template.`);
            displayedMenu = await getMenuTemplate(); 
            isTargetMenuPublished = false;
        }
        
        const userChoices = await getUserChoicesForWeek(userId, targetWeekStartDateString);
        
        const today = new Date();
        const startOfTodayWeek = getWeekStartDate(today);
        
        const endDateOfTargetWeek = new Date(targetWeekStartDate);
        endDateOfTargetWeek.setDate(targetWeekStartDate.getDate() + 4); 
        const targetWeekDisplay = `${formatDateToDDMMYYYY(targetWeekStartDate)} - ${formatDateToDDMMYYYY(endDateOfTargetWeek)}`;

        const prevWeekStartObj = new Date(targetWeekStartDate);
        prevWeekStartObj.setDate(targetWeekStartDate.getDate() - 7);
        const prevWeekLink = `/dashboard?week=${formatDateToYYYYMMDD(prevWeekStartObj)}`;

        const nextWeekStartObj = new Date(targetWeekStartDate);
        nextWeekStartObj.setDate(nextWeekStartObj.getDate() + 7);
        const nextWeekLink = `/dashboard?week=${formatDateToYYYYMMDD(nextWeekStartObj)}`;
        
        const isCurrentWeek = (targetWeekStartDate.getTime() === startOfTodayWeek.getTime());
        const isFutureWeek = targetWeekStartDate > startOfTodayWeek;

        console.log(`[GET /dashboard] Prikazujem za tjedan: ${targetWeekDisplay}, Korisnik ID: ${userId}, Tekući: ${isCurrentWeek}, Budući: ${isFutureWeek}, Objavljen: ${isTargetMenuPublished}`);
        
        res.render('dashboard', {
            userChoices,                 
            workWeekDays: workWeekDaysForTarget, 
            currentWeekDisplay: targetWeekDisplay, 
            prevWeekLink,
            nextWeekLink,
            isCurrentWeek: isCurrentWeek, 
            isFutureWeek: isFutureWeek, 
            displayedMenu: displayedMenu,       
            isMenuPublished: isTargetMenuPublished, 
            DAY_DISPLAY_NAMES: DAY_DISPLAY_NAMES, 
            message: req.query.message,
            error: req.query.error,
            formatDateToDDMMYYYY: formatDateToDDMMYYYY, 
            daysOrder: res.locals.daysOrder, 
            
            
        });
    } catch (error) {
        console.error("[GET /dashboard] Greška u ruti:", error.stack); 
        res.status(500).render('partials/error_page', {
            statusCode: 500,
            message: 'Greška pri učitavanju vašeg plana obroka. Molimo pokušajte kasnije.',
            title: 'Greška Servera'
        });
    }
});

// POST /dashboard - Sprema odabire korisnika.
router.post('/dashboard', isAuthenticated, async (req, res) => {
    console.log('[POST /dashboard] Ulaz u rutu.');
    const userId = req.session.user.id;
    const choicesFromForm = req.body.choices || {}; 
    
    const formDates = Object.keys(choicesFromForm);
    let weekOfChoicesString;

    if (formDates.length > 0) {
        weekOfChoicesString = formatDateToYYYYMMDD(getWeekStartDate(new Date(formDates[0] + "T00:00:00Z")));
    } else {
        // Ako forma dođe prazna, moramo znati na koji tjedan se odnosi.
        // U EJS formi ćemo dodati hidden input s podatkom o tjednu.
        // Za sada, fallback:
        weekOfChoicesString = req.body.week_of_choices || formatDateToYYYYMMDD(getWeekStartDate(new Date()));
    }

    // --- AŽURIRANA LOGIKA VALIDACIJE ---
    const today = new Date();
    const startOfCurrentWeekObj = getWeekStartDate(today);
    const startOfCurrentWeekString = formatDateToYYYYMMDD(startOfCurrentWeekObj);
    
    const startOfNextWeekObj = new Date(startOfCurrentWeekObj);
    startOfNextWeekObj.setDate(startOfCurrentWeekObj.getDate() + 7);
    const startOfNextWeekString = formatDateToYYYYMMDD(startOfNextWeekObj);

    // Dopusti spremanje samo ako je tjedan iz forme TEKUĆI ili SLJEDEĆI
    if (weekOfChoicesString !== startOfCurrentWeekString && weekOfChoicesString !== startOfNextWeekString) {
        console.warn(`[POST /dashboard] Pokušaj spremanja odabira za nedozvoljeni tjedan (${weekOfChoicesString}). Akcija nije dozvoljena.`);
        return res.redirect(`/dashboard?week=${weekOfChoicesString}&error=` + encodeURIComponent('Odabiri se mogu spremiti samo za tekući i sljedeći tjedan.'));
    }

    console.log('[POST /dashboard] Spremanje odabira za tjedan:', weekOfChoicesString, 'Podaci forme:', choicesFromForm);
    
    try {
        const workDaysRelevantForForm = getWorkWeekDaysForDate(new Date(weekOfChoicesString + "T00:00:00Z"));

        for (const dayInfo of workDaysRelevantForForm) {
            const dateString = dayInfo.dateString; 
            const chosenOptionForDay = choicesFromForm[dateString]; 
            await saveUserDailyChoice(userId, dateString, chosenOptionForDay);
        }
        
        res.redirect(`/dashboard?week=${weekOfChoicesString}&message=` + encodeURIComponent('Odabiri uspješno spremljeni!'));
    } catch (error) {
        console.error("[POST /dashboard] Error saving meal preferences:", error.stack);
        
        // Fallback u slučaju greške ostaje uglavnom isti
        return res.redirect(`/dashboard?week=${weekOfChoicesString}&error=` + encodeURIComponent('Greška pri spremanju odabira. Molimo pokušajte ponovno.'));
    }
});

module.exports = router;