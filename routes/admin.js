const express = require('express');
const router = express.Router();
const { isAdmin } = require('../middleware/authMiddleware');
const {
    getAllUsers,
    deleteUserById,
    findUserById,
    getTotalUsersCount,
    resetAllVotes,
    getTotalOverallChoicesCount,
    getVoteCountsByDayAndOption,
    getUsersWhoChoseOptionOnDay,
    getUserDailyChoices,
    getSingleDayMenuFromDB,
    upsertDailyMenu,
    clearWeeklyMenu,
    DAY_DISPLAY_NAMES 
} = require('../database');
const { DAYS_OF_WEEK_ORDER } = require('../config/menu'); 

router.use(isAdmin); 

// GLAVNA ADMIN DASHBOARD RUTA
router.get('/', async (req, res) => {
    try {
        const totalUsers = await getTotalUsersCount();
        const totalOverallChoices = await getTotalOverallChoicesCount();
        const allUsers = await getAllUsers();
        const detailedVoteCounts = await getVoteCountsByDayAndOption();

        
        res.render('admin/dashboard', {
            title: 'Admin Dashboard',
            totalUsers,
            totalOverallChoices,
            allUsers, 
            detailedVoteCounts,
            daysOrder: res.locals.daysOrder, 
            message: req.query.message,
            error: req.query.error
        });
    } catch (error) {
        console.error("[GET /admin/] Greška prilikom učitavanja admin dashboarda:", error);
        res.status(500).render('partials/error_page', {
             statusCode: 500,
             message: 'Greška prilikom učitavanja admin dashboarda.',
             title: 'Greška Servera'
        });
    }
});

// RUTA ZA PRIKAZ SVIH REGISTRIRANIH KORISNIKA
router.get('/all-users', async (req, res) => {
    try {
        const allUsers = await getAllUsers();
        res.render('admin/all_users_list', {
            title: 'Popis Svih Registriranih Korisnika',
            allUsersList: allUsers, 
            message: req.query.message,
            error: req.query.error
        });
    } catch (error) {
        console.error("[GET /admin/all-users] Greška prilikom dohvaćanja svih korisnika:", error);
        res.status(500).render('partials/error_page', {
             statusCode: 500,
             message: 'Greška prilikom dohvaćanja popisa korisnika.',
             title: 'Greška Servera'
        });
    }
});

// RUTA ZA BRISANJE KORISNIKA
router.post('/users/delete/:userId', async (req, res) => {
    const userIdToDelete = parseInt(req.params.userId);
    const currentAdminId = req.session.user.id;

    if (userIdToDelete === currentAdminId) {
        return res.redirect('/admin/all-users?error=' + encodeURIComponent('Ne možete obrisati sami sebe.'));
    }
    try {
        const result = await deleteUserById(userIdToDelete);
        if (result.changes > 0) {
            res.redirect('/admin/all-users?message=' + encodeURIComponent('Korisnik uspješno obrisan.'));
        } else {
            res.redirect('/admin/all-users?error=' + encodeURIComponent('Korisnik nije pronađen ili nije mogao biti obrisan.'));
        }
    } catch (error) {
        console.error(`[POST /admin/users/delete/${req.params.userId}] Greška:`, error);
        res.redirect('/admin/all-users?error=' + encodeURIComponent('Greška prilikom brisanja korisnika.'));
    }
});

// RUTA ZA PRIKAZ ODABIRA POJEDINOG KORISNIKA
router.get('/users/:userId/votes', async (req, res) => {
    try {
        const userId = parseInt(req.params.userId);
        const user = await findUserById(userId);
        if (!user) {
            return res.status(404).render('partials/error_page', { statusCode: 404, message: 'Korisnik nije pronađen.', title: 'Nije pronađeno'});
        }
        
        const userChoices = await getUserDailyChoices(userId);
        const weeklyMenu = res.locals.weeklyMenu;

        const choicesDetails = DAYS_OF_WEEK_ORDER.map(dayKey => {
            const dayMenu = weeklyMenu[dayKey] || {};
            const chosenOption = userChoices[dayKey];
            let chosenMealDescription = "Ništa nije odabrano";

            if (chosenOption === 1) {
                chosenMealDescription = `Jelo 1: ${dayMenu.meal_1 || 'N/A'}`;
            } else if (chosenOption === 2 && dayMenu.has_two_options) {
                chosenMealDescription = `Jelo 2: ${dayMenu.meal_2 || 'N/A'}`;
            }
            
            let dayDisplayName = dayKey.toUpperCase(); 
            if(dayMenu && dayMenu.name) {
                dayDisplayName = dayMenu.name;
            } else if (typeof DAY_DISPLAY_NAMES !== 'undefined' && DAY_DISPLAY_NAMES[dayKey]) {
                dayDisplayName = DAY_DISPLAY_NAMES[dayKey];
            }

            return {
                dayName: dayDisplayName,
                chosenMealDescription: chosenMealDescription
            };
        });

        res.render('admin/user_votes', {
            title: `Odabiri za korisnika ${user.username}`,
            userName: user.username,
            choices: choicesDetails,
        });
    } catch (error) {
        console.error(`[GET /admin/users/${req.params.userId}/votes] Greška:`, error);
        res.status(500).render('partials/error_page', { statusCode: 500, message: 'Greška prilikom dohvaćanja glasova korisnika.', title: 'Greška Servera'});
    }
});

// RUTA ZA RESETIRANJE SVIH GLASOVA
router.post('/reset-votes', async (req, res) => {
    try {
        await resetAllVotes();
        res.redirect('/admin?message=' + encodeURIComponent('Svi glasovi su uspješno resetirani.'));
    } catch (error) {
        console.error("[POST /admin/reset-votes] Greška:", error);
        res.redirect('/admin?error=' + encodeURIComponent('Greška prilikom resetiranja glasova.'));
    }
});


// --- RUTE ZA UPRAVLJANJE JELOVNIKOM ---
router.get('/menu', async (req, res) => {
    try {
        res.render('admin/menu_management', {
            title: 'Upravljanje Tjednim Jelovnikom',
            message: req.query.message,
            error: req.query.error
        });
    } catch (error) {
        console.error("[GET /admin/menu] Error loading menu management page:", error);
        res.redirect('/admin?error=' + encodeURIComponent('Greška pri učitavanju stranice za jelovnik.'));
    }
});

router.get('/menu/edit/:dayKey', async (req, res) => {
    try {
        const { dayKey } = req.params;
        if (!DAYS_OF_WEEK_ORDER.includes(dayKey)) {
            return res.status(404).render('partials/error_page', { statusCode: 404, message: 'Nepostojeći dan.', title: 'Nije pronađeno'});
        }
        const dayMenuData = await getSingleDayMenuFromDB(dayKey);
        
        let dayNameForTitle = dayKey.charAt(0).toUpperCase() + dayKey.slice(1); 
        if (dayMenuData && dayMenuData.day_name_display) {
            dayNameForTitle = dayMenuData.day_name_display;
        } else if (typeof DAY_DISPLAY_NAMES !== 'undefined' && DAY_DISPLAY_NAMES[dayKey]) {
            dayNameForTitle = DAY_DISPLAY_NAMES[dayKey];
        }

        res.render('admin/edit_menu_item', {
            title: `Uredi Jelovnik za ${dayNameForTitle}`,
            dayMenu: dayMenuData,
            dayKey
        });
    } catch (error) {
        console.error(`[GET /admin/menu/edit/${req.params.dayKey}] Error loading edit page:`, error);
        res.redirect('/admin/menu?error=' + encodeURIComponent('Greška pri učitavanju forme za uređivanje.'));
    }
});

router.post('/menu/edit/:dayKey', async (req, res) => {
    try {
        const { dayKey } = req.params;
        const {
            day_name_display,
            meal_1_description,
            has_two_options,
            meal_2_description,
            option_2_prompt
        } = req.body;

        const hasTwoOptionsBool = !!has_two_options;

        await upsertDailyMenu(
            dayKey,
            day_name_display.trim(),
            meal_1_description.trim(),
            hasTwoOptionsBool ? (meal_2_description || "").trim() : null,
            hasTwoOptionsBool,
            hasTwoOptionsBool ? (option_2_prompt || "").trim() : null
        );
        res.redirect('/admin/menu?message=' + encodeURIComponent(`Jelovnik za ${day_name_display} uspješno ažuriran.`));
    } catch (error) {
        console.error(`[POST /admin/menu/edit/${req.params.dayKey}] Error saving menu:`, error);
        res.redirect(`/admin/menu/edit/${req.params.dayKey}?error=` + encodeURIComponent('Greška pri spremanju jelovnika.'));
    }
});

router.post('/menu/reset-week', async (req, res) => {
    try {
        await clearWeeklyMenu();
        res.redirect('/admin/menu?message=' + encodeURIComponent('Cijeli tjedni jelovnik je uspješno resetiran na prazno.'));
    } catch (error) {
        console.error("[POST /admin/menu/reset-week] Greška prilikom resetiranja tjednog jelovnika:", error);
        res.redirect('/admin/menu?error=' + encodeURIComponent('Dogodila se greška prilikom resetiranja tjednog jelovnika.'));
    }
});

// RUTA ZA PRIKAZ KORISNIKA KOJI SU ODABRALI SPECIFIČNO JELO ODREĐENOG DANA
router.get('/voters/:dayKey/:optionNumber', async (req, res) => {
    const { dayKey, optionNumber } = req.params;
    const optionNumInt = parseInt(optionNumber);

    let dayNameDisplay = dayKey.charAt(0).toUpperCase() + dayKey.slice(1); 
    if (res.locals.weeklyMenu && res.locals.weeklyMenu[dayKey] && res.locals.weeklyMenu[dayKey].name) {
        dayNameDisplay = res.locals.weeklyMenu[dayKey].name;
    } else if (typeof DAY_DISPLAY_NAMES !== 'undefined' && DAY_DISPLAY_NAMES[dayKey]) {
        dayNameDisplay = DAY_DISPLAY_NAMES[dayKey];
    }

    try {
        if (!DAYS_OF_WEEK_ORDER.includes(dayKey) || (optionNumInt !== 1 && optionNumInt !== 2)) {
            return res.status(400).render('partials/error_page', { statusCode: 400, message: 'Neispravan dan ili opcija jela.', title: 'Neispravan zahtjev'});
        }
        const voters = await getUsersWhoChoseOptionOnDay(dayKey, optionNumInt);
        res.render('admin/voters_for_day', {
            title: `Korisnici koji su odabrali Jelo ${optionNumInt} za ${dayNameDisplay}`,
            dayName: dayNameDisplay,
            optionNumber: optionNumInt,
            dayKey: dayKey,
            voters: voters
        });
    } catch (error) {
        console.error(`[GET /admin/voters/${dayKey}/${optionNumber}] Greška:`, error);
        res.status(500).render('partials/error_page', { 
            statusCode: 500, 
            message: `Greška prilikom dohvaćanja glasača za ${dayNameDisplay}, Jelo ${optionNumber}.`, 
            title: 'Greška Servera'
        });
    }
});

module.exports = router;