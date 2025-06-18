
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
            try {
                targetReferenceDate = new Date(weekQuery + "T00:00:00Z");
                if (isNaN(targetReferenceDate.getTime())) {
                    console.warn(`[GET /dashboard] Neispravan 'week' query parametar (invalid date: ${weekQuery}), koristim tekući datum.`);
                    targetReferenceDate = new Date();
                }
            } catch (e) {
                console.warn(`[GET /dashboard] Greška pri parsiranju 'week' query parametra (${weekQuery}), koristim tekući datum:`, e);
                targetReferenceDate = new Date();
            }
        } else {
            targetReferenceDate = new Date();
            if (weekQuery) {
                 console.warn(`[GET /dashboard] Neispravan format 'week' query parametra (${weekQuery}), koristim tekući datum.`);
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
        
        let userChoices = {};
        const today = new Date();
        const startOfTodayWeek = getWeekStartDate(today);
        
        
        if (targetWeekStartDate <= startOfTodayWeek) {
            userChoices = await getUserChoicesForWeek(userId, targetWeekStartDateString);
        }
        
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
    
    let weekOfChoicesString = null;
    const formDates = Object.keys(choicesFromForm);

    if (formDates.length > 0) {
        
        weekOfChoicesString = formatDateToYYYYMMDD(getWeekStartDate(new Date(formDates[0] + "T00:00:00Z")));
    } else {
        
        weekOfChoicesString = formatDateToYYYYMMDD(getWeekStartDate(new Date()));
    }

    const today = new Date();
    const startOfCurrentWeekString = formatDateToYYYYMMDD(getWeekStartDate(today));
    if (weekOfChoicesString !== startOfCurrentWeekString) {
        console.warn(`[POST /dashboard] Pokušaj spremanja odabira za tjedan (${weekOfChoicesString}) koji nije tekući. Akcija nije dozvoljena.`);
        return res.redirect(`/dashboard?week=${weekOfChoicesString}&error=` + encodeURIComponent('Odabiri se mogu spremiti samo za tekući tjedan.'));
    }

    console.log('[POST /dashboard] Spremanje odabira za tekući tjedan:', weekOfChoicesString, 'Podaci forme:', choicesFromForm);
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
        
        const userChoices = await getUserChoicesForWeek(userId, weekOfChoicesString);
        const workWeekDaysForDisplay = getWorkWeekDaysForDate(new Date(weekOfChoicesString + "T00:00:00Z"));
        const displayWeekStart = new Date(weekOfChoicesString + "T00:00:00Z");
        const displayWeekEnd = new Date(displayWeekStart);
        displayWeekEnd.setDate(displayWeekStart.getDate() + 4);
        
        const prevWeekStartObjOnError = new Date(displayWeekStart);
        prevWeekStartObjOnError.setDate(prevWeekStartObjOnError.getDate() - 7);
        const nextWeekStartObjOnError = new Date(displayWeekStart);
        nextWeekStartObjOnError.setDate(nextWeekStartObjOnError.getDate() + 7);

        res.render('dashboard', {
            userChoices,
            workWeekDays: workWeekDaysForDisplay,
            message: 'Greška pri spremanju odabira. Molimo pokušajte ponovno.',
            error: true,
            currentWeekDisplay: `${weekOfChoicesString} - ${formatDateToYYYYMMDD(displayWeekEnd)}`,
            isCurrentWeek: true, 
            isFutureWeek: false,
            prevWeekLink: `/dashboard?week=${formatDateToYYYYMMDD(prevWeekStartObjOnError)}`,
            nextWeekLink: `/dashboard?week=${formatDateToYYYYMMDD(nextWeekStartObjOnError)}`,
            DAY_DISPLAY_NAMES: DAY_DISPLAY_NAMES,
            daysOrder: res.locals.daysOrder,
            displayedMenu: res.locals.weeklyMenu, 
            isMenuPublished: false 
        });
    }
});

module.exports = router;