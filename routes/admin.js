
const express = require('express');
const router = express.Router();
const excel = require('exceljs');
const { isAdmin } = require('../middleware/authMiddleware');
const {
    getAllUsers,
    deleteUserById,
    findUserById,
    getTotalUsersCount,
    // resetAllVotesForWeek, // Zakomentirano/uklonjeno jer ne želimo brisati glasove aktivno
    getTotalOverallChoicesCountForWeek,
    getVoteCountsByDayAndOptionForWeek,
    getUsersWhoChoseOptionOnDate,
    getUserChoicesForWeek,
    getMealPopularityStats,
    getAvailableWeeksForChoices,
    getSingleDayMenuTemplate, 
    upsertDailyMenuTemplate,  
    clearWeeklyMenuTemplate,  
    publishMenuForWeek,
    getDetailedChoicesForWeekExport, 
    getArchivedMenuForWeek,
    DAY_DISPLAY_NAMES,
     getMenuTemplate
} = require('../database');
const { DAYS_OF_WEEK_ORDER } = require('../config/menu');
const { getWeekStartDate, formatDateToYYYYMMDD, formatDateToDDMMYYYY } = require('../utils/dateUtils');

router.use(isAdmin);

// GLAVNA ADMIN DASHBOARD RUTA
router.get('/', async (req, res) => {
    console.log('[GET /admin/] Ulaz u glavnu admin dashboard rutu.');
    try {
        const availableWeeksRaw = await getAvailableWeeksForChoices();
        let selectedWeekStartDateString = req.query.week; 

        if (!selectedWeekStartDateString || !/^\d{4}-\d{2}-\d{2}$/.test(selectedWeekStartDateString) || (availableWeeksRaw.length > 0 && !availableWeeksRaw.includes(selectedWeekStartDateString))) {
            if (availableWeeksRaw.length > 0) {
                selectedWeekStartDateString = availableWeeksRaw[0];
            } else {
                selectedWeekStartDateString = formatDateToYYYYMMDD(getWeekStartDate(new Date()));
            }
        }
        
        const selectedWeekStartObj = new Date(selectedWeekStartDateString + "T00:00:00Z");
        const selectedWeekEndObj = new Date(selectedWeekStartObj);
        selectedWeekEndObj.setDate(selectedWeekStartObj.getDate() + 4);
        const selectedWeekDisplay = `${formatDateToDDMMYYYY(selectedWeekStartObj)} - ${formatDateToDDMMYYYY(selectedWeekEndObj)}`;

        const availableWeeksForDropdown = availableWeeksRaw.map(weekStartStr => {
            const startDate = new Date(weekStartStr + "T00:00:00Z");
            const endDate = new Date(startDate);
            endDate.setDate(startDate.getDate() + 4);
            return { 
                value: weekStartStr,
                display: `${formatDateToDDMMYYYY(startDate)} - ${formatDateToDDMMYYYY(endDate)}`
            };
        });
        
        if (availableWeeksRaw.length === 0 && selectedWeekStartDateString) {
             if (!availableWeeksForDropdown.find(w => w.value === selectedWeekStartDateString)) {
                availableWeeksForDropdown.push({
                    value: selectedWeekStartDateString,
                    display: `${selectedWeekDisplay} (Nema zabilježenih glasova)`
                });
             }
        }

        const totalUsers = await getTotalUsersCount();
        const totalOverallChoicesForSelectedWeek = await getTotalOverallChoicesCountForWeek(selectedWeekStartDateString);
        const allUsers = await getAllUsers();
        const detailedVoteCountsForSelectedWeek = await getVoteCountsByDayAndOptionForWeek(selectedWeekStartDateString);
        const mealPopularityForSelectedWeek = await getMealPopularityStats(selectedWeekStartDateString);
        const overallMealPopularity = await getMealPopularityStats(); 

        console.log(`[GET /admin/] Prikazujem statistiku za tjedan (početak): ${selectedWeekStartDateString}`);
        
        res.render('admin/dashboard', {
            title: 'Admin Dashboard',
            totalUsers, totalOverallChoices: totalOverallChoicesForSelectedWeek, allUsers,
            detailedVoteCounts: detailedVoteCountsForSelectedWeek, 
            mealPopularityForWeek: mealPopularityForSelectedWeek,
            overallMealPopularity,
            availableWeeksForDropdown, 
            selectedWeek: selectedWeekStartDateString, 
            currentWeekDisplay: selectedWeekDisplay,
            currentWeekStartDateForLinks: selectedWeekStartDateString,
            daysOrder: res.locals.daysOrder, 
            // formatDateToDDMMYYYY: formatDateToDDMMYYYY, // Proslijedi ako nije globalno
            message: req.query.message, error: req.query.error
        });
    } catch (error) {
        console.error("[GET /admin/] Greška prilikom učitavanja admin dashboarda:", error.stack);
        res.status(500).render('partials/error_page', {
             statusCode: 500, message: 'Greška prilikom učitavanja admin dashboarda.', title: 'Greška Servera'
        });
    }
});

// RUTA ZA PRIKAZ SVIH REGISTRIRANIH KORISNIKA
router.get('/all-users', async (req, res) => {
    const searchTerm = req.query.search || ''; 
    console.log(`[GET /admin/all-users] Prikaz korisnika. Pretraga: "${searchTerm}"`);
    try {
        const allUsers = await getAllUsers(searchTerm); 
        const today = new Date(); 
        const currentWeekStartDateString = formatDateToYYYYMMDD(getWeekStartDate(today));

        res.render('admin/all_users_list', {
            title: searchTerm ? `Rezultati pretrage korisnika: "${searchTerm}"` : 'Popis Svih Registriranih Korisnika',
            allUsersList: allUsers,
            currentWeekStartDateString: currentWeekStartDateString,
            searchTerm: searchTerm, 
            message: req.query.message,
            error: req.query.error
        });
    } catch (error) {
        console.error("[GET /admin/all-users] Greška:", error.stack);
        res.status(500).render('partials/error_page', {
             statusCode: 500, message: 'Greška prilikom dohvaćanja popisa korisnika.', title: 'Greška Servera'
        });
    }
});

// ---RUTA ZA PRIKAZ DETALJNE STATISTIKE ---
router.get('/statistics', async (req, res) => {
    console.log('[GET /admin/statistics] Prikaz stranice s detaljnom statistikom. Query:', req.query);
    try {
        const availableWeeksRaw = await getAvailableWeeksForChoices();
        let selectedWeekStartDateString = req.query.week;

        if (!selectedWeekStartDateString || !/^\d{4}-\d{2}-\d{2}$/.test(selectedWeekStartDateString) || (availableWeeksRaw.length > 0 && !availableWeeksRaw.includes(selectedWeekStartDateString))) {
            if (availableWeeksRaw.length > 0) {
                selectedWeekStartDateString = availableWeeksRaw[0];
            } else {
                selectedWeekStartDateString = formatDateToYYYYMMDD(getWeekStartDate(new Date()));
            }
        }
        
        const selectedWeekStartObj = new Date(selectedWeekStartDateString + "T00:00:00Z");
        const selectedWeekEndObj = new Date(selectedWeekStartObj);
        selectedWeekEndObj.setDate(selectedWeekStartObj.getDate() + 4);
        const selectedWeekDisplay = `${formatDateToDDMMYYYY(selectedWeekStartObj)} - ${formatDateToDDMMYYYY(selectedWeekEndObj)}`;

        const availableWeeksForDropdown = availableWeeksRaw.map(weekStartStr => {
            const startDate = new Date(weekStartStr + "T00:00:00Z");
            const endDate = new Date(startDate);
            endDate.setDate(startDate.getDate() + 4);
            return { value: weekStartStr, display: `${formatDateToDDMMYYYY(startDate)} - ${formatDateToDDMMYYYY(endDate)}` };
        });
        
        if (availableWeeksRaw.length === 0 && selectedWeekStartDateString) {
             if (!availableWeeksForDropdown.find(w => w.value === selectedWeekStartDateString)) {
                availableWeeksForDropdown.push({
                    value: selectedWeekStartDateString,
                    display: `${selectedWeekDisplay} (Nema zabilježenih glasova)`
                });
             }
        }

        const detailedVoteCountsForSelectedWeek = await getVoteCountsByDayAndOptionForWeek(selectedWeekStartDateString);
        const mealPopularityForSelectedWeek = await getMealPopularityStats(selectedWeekStartDateString);
        const overallMealPopularity = await getMealPopularityStats(); 

        console.log(`[GET /admin/statistics] Prikazujem statistiku za tjedan: ${selectedWeekStartDateString}`);
        
        res.render('admin/statistics_page', { 
            title: `Detaljna Statistika (${selectedWeekDisplay})`,
            detailedVoteCounts: detailedVoteCountsForSelectedWeek,
            mealPopularityForWeek: mealPopularityForSelectedWeek,
            overallMealPopularity,
            availableWeeksForDropdown, 
            selectedWeek: selectedWeekStartDateString,
            currentWeekDisplay: selectedWeekDisplay,    
            currentWeekStartDateForLinks: selectedWeekStartDateString, 
            daysOrder: res.locals.daysOrder, 
            // weeklyMenu: res.locals.weeklyMenu, // Dostupno preko res.locals
            message: req.query.message, 
            error: req.query.error
        });

    } catch (error) {
        console.error("[GET /admin/statistics] Greška prilikom učitavanja stranice sa statistikom:", error.stack);
        res.status(500).render('partials/error_page', {
             statusCode: 500,
             message: 'Greška prilikom učitavanja stranice sa statistikom.',
             title: 'Greška Servera'
        });
    }
});

// --- RUTA ZA EXPORT ODABIRA U EXCEL ---
router.get('/export-choices/excel', async (req, res) => {
    const weekQuery = req.query.week;

    if (!weekQuery || !/^\d{4}-\d{2}-\d{2}$/.test(weekQuery)) {
        return res.status(400).send("Nedostaje ispravan 'week' query parametar (YYYY-MM-DD).");
    }
    
    const weekStartDateString = weekQuery;
    const weekStartDateObj = new Date(weekStartDateString + "T00:00:00Z");
    const weekEndDateObj = new Date(weekStartDateObj);
    weekEndDateObj.setDate(weekStartDateObj.getDate() + 4);
    const weekDisplay = `${formatDateToDDMMYYYY(weekStartDateObj)} - ${formatDateToDDMMYYYY(weekEndDateObj)}`;
    const dateForFilename = formatDateToDDMMYYYY(weekStartDateObj).replace(/\.$/, '');

    console.log(`[GET /admin/export-choices/excel] Exportiranje odabira za tjedan: ${weekDisplay}`);

    try {
        const allChoicesForWeek = await getDetailedChoicesForWeekExport(weekStartDateString);
        const menuForWeek = await getArchivedMenuForWeek(weekStartDateString);
        
        if (!menuForWeek) {
            console.error(`[EXPORT] Kritična greška: Nije pronađen arhivirani jelovnik za tjedan ${weekStartDateString}. Export prekinut.`);
            return res.status(404).send(`Jelovnik za tjedan ${weekStartDateString} nije pronađen u arhivi.`);
        }

        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet(`Odabiri ${weekStartDateString}`);

        worksheet.getColumn('A').width = 50;
        worksheet.getColumn('B').width = 50;

        worksheet.addRow([`Popis Odabira Jela za Tjedan: ${weekDisplay}`]);
        const titleCell = worksheet.getCell('A1');
        titleCell.font = { bold: true, size: 16, name: 'Calibri' };
        titleCell.alignment = { horizontal: 'center' };
        worksheet.mergeCells('A1:B1');
        
        worksheet.addRow([]);

        const choicesGrouped = {};
        DAYS_OF_WEEK_ORDER.forEach((dayKey, index) => {
            const dayNumeric = index + 1;
            const dayMenuData = menuForWeek[dayKey]; 
            
            choicesGrouped[dayNumeric] = {
                dayName: (dayMenuData && dayMenuData.name) || DAY_DISPLAY_NAMES[dayKey] || dayKey.toUpperCase(),
                meal1Users: [],
                meal2Users: [],
                meal1Description: dayMenuData ? dayMenuData.meal_1 : "Nije objavljeno",
                meal2Description: (dayMenuData && dayMenuData.has_two_options) ? dayMenuData.meal_2 : null
            };
        });

        allChoicesForWeek.forEach(choice => {
            if (choicesGrouped[choice.dayNumeric]) {
                if (choice.chosenOption === 1) choicesGrouped[choice.dayNumeric].meal1Users.push(choice.username);
                else if (choice.chosenOption === 2) choicesGrouped[choice.dayNumeric].meal2Users.push(choice.username);
            }
        });

        for (const dayNumeric of Object.keys(choicesGrouped).sort((a,b) => parseInt(a) - parseInt(b))) {
            const dayData = choicesGrouped[dayNumeric];
            worksheet.addRow([]); 
            const dayHeaderRow = worksheet.addRow([dayData.dayName]);
            worksheet.mergeCells(dayHeaderRow.number, 1, dayHeaderRow.number, 2);
            dayHeaderRow.getCell(1).font = { bold: true, size: 14, name: 'Calibri', color: { argb: 'FF0070C0' } }; 
            dayHeaderRow.getCell(1).fill = { type: 'pattern', pattern:'solid', fgColor:{argb:'FFDAEEF3'} }; 
            dayHeaderRow.getCell(1).alignment = { horizontal: 'center' };
            const meal1Count = dayData.meal1Users.length;
            const meal2Count = dayData.meal2Users.length;
            const meal1HeaderText = `[${meal1Count}] Jelo 1: ${dayData.meal1Description || 'N/A'}`;
            let meal2HeaderText = "";
            if (dayData.meal2Description !== null) { meal2HeaderText = `[${meal2Count}] Jelo 2: ${dayData.meal2Description || 'N/A'}`; }
            const mealHeaderRow = worksheet.addRow([meal1HeaderText, meal2HeaderText]);
            const headerCellStyle = { font: { bold: true, size: 13, name: 'Calibri' }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFD966' } }, alignment: { horizontal: 'center', vertical: 'middle', wrapText: true }, border: { bottom: { style: 'medium', color: { argb: 'FF000000' } } } };
            mealHeaderRow.getCell(1).style = headerCellStyle;
            if (dayData.meal2Description !== null) { mealHeaderRow.getCell(2).style = headerCellStyle; }
            else { worksheet.mergeCells(mealHeaderRow.number, 1, mealHeaderRow.number, 2); }
            mealHeaderRow.height = 30;
            const maxUsers = Math.max(dayData.meal1Users.length, dayData.meal2Users.length);
            if (maxUsers === 0 && dayData.meal1Description !== "Nije objavljeno") { worksheet.addRow(["Nema odabira", ""]); } 
            else {
                for (let i = 0; i < maxUsers; i++) {
                    const userForMeal1 = dayData.meal1Users[i] || ""; 
                    let userForMeal2 = "";
                    if (dayData.meal2Description !== null) { userForMeal2 = dayData.meal2Users[i] || ""; }
                    worksheet.addRow([userForMeal1, userForMeal2]);
                }
            }
        }

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="odabiri_jela_${dateForFilename}.xlsx"`);
        await workbook.xlsx.write(res);
        res.end();
        console.log(`[GET /admin/export-choices/excel] Pivotirana Excel datoteka (s povijesnim jelovnikom) generirana i poslana.`);

    } catch (error) {
        console.error('[GET /admin/export-choices/excel] Greška pri generiranju pivotirane Excel datoteke:', error.stack);
        if (!res.headersSent) {
            res.status(500).send('Greška pri generiranju Excel datoteke. Provjerite konzolu servera za detalje.');
        }
    }
});



// RUTA ZA BRISANJE KORISNIKA
router.post('/users/delete/:userId', async (req, res) => {
    console.log(`[POST /admin/users/delete/${req.params.userId}] Pokušaj brisanja korisnika.`);
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
        console.error(`[POST /admin/users/delete/${req.params.userId}] Greška:`, error.stack);
        res.redirect('/admin/all-users?error=' + encodeURIComponent('Greška prilikom brisanja korisnika.'));
    }
});

// RUTA ZA PRIKAZ ODABIRA POJEDINOG KORISNIKA
router.get('/users/:userId/votes', async (req, res) => {
    const userId = parseInt(req.params.userId);
    const weekQuery = req.query.week;
    let targetWeekStartDateString;
    let targetWeekDisplay;

    console.log(`[GET /admin/users/${userId}/votes] Dohvaćanje glasova. Query week: ${weekQuery}`);

    if (weekQuery && /^\d{4}-\d{2}-\d{2}$/.test(weekQuery)) {
        try {
            const queryDate = new Date(weekQuery + "T00:00:00Z"); 
            const weekStartForQuery = getWeekStartDate(queryDate); 
            targetWeekStartDateString = formatDateToYYYYMMDD(weekStartForQuery); 
            
            const endDateObj = new Date(weekStartForQuery);
            endDateObj.setDate(weekStartForQuery.getDate() + 4); 
            targetWeekDisplay = `${formatDateToDDMMYYYY(weekStartForQuery)} - ${formatDateToDDMMYYYY(endDateObj)}`; 
        } catch (e) {
            console.warn(`[GET /admin/users/${userId}/votes] Greška pri parsiranju 'week' (${weekQuery}), koristim tekući tjedan. Greška: ${e.message}`);
            const today = new Date();
            const currentWeekStart = getWeekStartDate(today);
            targetWeekStartDateString = formatDateToYYYYMMDD(currentWeekStart);
            const currentWeekEnd = new Date(currentWeekStart);
            currentWeekEnd.setDate(currentWeekStart.getDate() + 4);
            targetWeekDisplay = `${formatDateToDDMMYYYY(currentWeekStart)} - ${formatDateToDDMMYYYY(currentWeekEnd)}`;
        }
    } else { 
        const today = new Date();
        const currentWeekStart = getWeekStartDate(today);
        targetWeekStartDateString = formatDateToYYYYMMDD(currentWeekStart);
        const currentWeekEnd = new Date(currentWeekStart);
        currentWeekEnd.setDate(currentWeekStart.getDate() + 4);
        targetWeekDisplay = `${formatDateToDDMMYYYY(currentWeekStart)} - ${formatDateToDDMMYYYY(currentWeekEnd)}`;
        if (weekQuery) { 
             console.warn(`[GET /admin/users/${userId}/votes] Neispravan format 'week' query parametra (${weekQuery}), koristim tekući tjedan.`);
        }
    }
    
    try {
        const user = await findUserById(userId);
        if (!user) { 
            return res.status(404).render('partials/error_page', { 
                statusCode: 404, message: 'Korisnik nije pronađen.', title: 'Nije pronađeno'
            }); 
        }
        
        const userChoices = await getUserChoicesForWeek(userId, targetWeekStartDateString); 
        const weeklyMenuTemplate = res.locals.weeklyMenu; 

        const choicesDetails = DAYS_OF_WEEK_ORDER.map((dayKey, index) => {
            const dayOfWeekNumeric = index + 1;
            const dayMenu = weeklyMenuTemplate[dayKey] || { name: (DAY_DISPLAY_NAMES[dayKey] || dayKey.toUpperCase()), meal_1: null, has_two_options: false, meal_2: null};
            const userChoiceForDay = userChoices[dayOfWeekNumeric]; 
            let chosenMealDescription = "Ništa nije odabrano";

            if (userChoiceForDay && userChoiceForDay.option === 1) {
                chosenMealDescription = `Jelo 1: ${userChoiceForDay.description || dayMenu.meal_1 || 'N/A'}`;
            } else if (userChoiceForDay && userChoiceForDay.option === 2) {
                
                const meal2DescFromTemplate = dayMenu.has_two_options ? (dayMenu.meal_2 || 'N/A') : 'N/A (Jelo 2 nije bilo opcija)';
                chosenMealDescription = `Jelo 2: ${userChoiceForDay.description || meal2DescFromTemplate}`;
            }
            
            let dayDisplayName = dayKey.toUpperCase();
            if (dayMenu && dayMenu.name && dayMenu.name !== "Nije definirano") {
                dayDisplayName = dayMenu.name;
            } else if (typeof DAY_DISPLAY_NAMES !== 'undefined' && DAY_DISPLAY_NAMES[dayKey]) {
                dayDisplayName = DAY_DISPLAY_NAMES[dayKey];
            }

            return { dayName: dayDisplayName, chosenMealDescription: chosenMealDescription };
        });

        
        const currentTargetWeekStartObj = new Date(targetWeekStartDateString + "T00:00:00Z"); 

        const prevWeekStartObj = new Date(currentTargetWeekStartObj);
        prevWeekStartObj.setDate(currentTargetWeekStartObj.getDate() - 7); 
        const prevWeekLink = `/admin/users/${userId}/votes?week=${formatDateToYYYYMMDD(prevWeekStartObj)}`;

        const nextWeekStartObj = new Date(currentTargetWeekStartObj);
        nextWeekStartObj.setDate(currentTargetWeekStartObj.getDate() + 7); 
        
        const today = new Date();
        const startOfTodayCalendarWeek = getWeekStartDate(today); 

        let nextWeekLink = null;
        if (currentTargetWeekStartObj.getTime() < startOfTodayCalendarWeek.getTime()) {
            nextWeekLink = `/admin/users/${userId}/votes?week=${formatDateToYYYYMMDD(nextWeekStartObj)}`;
        }
        
        res.render('admin/user_votes', {
            title: `Odabiri za ${user.username}`, 
            userName: user.username, 
            choices: choicesDetails,
            currentWeekDisplay: targetWeekDisplay, 
            currentWeekStartDate: targetWeekStartDateString,
            prevWeekLink,
            nextWeekLink 
            
        });
    } catch (error) { 
        console.error(`[GET /admin/users/${userId}/votes] Greška za tjedan ${targetWeekStartDateString}:`, error.stack);
        res.status(500).render('partials/error_page', { 
            statusCode: 500, 
            message: 'Greška prilikom dohvaćanja glasova korisnika.', 
            title: 'Greška Servera'
        });
    }
});

// RUTA ZA RESETIRANJE GLASOVA - ZAKOMENTIRANO JER SE GLASOVI ČUVAJU
/*
router.post('/reset-votes', async (req, res) => {
    console.log('[POST /admin/reset-votes] Funkcionalnost resetiranja glasova je onemogućena.');
    res.redirect('/admin?error=' + encodeURIComponent('Funkcija resetiranja glasova je trenutno onemogućena.'));
});
*/

// --- RUTE ZA UPRAVLJANJE JELOVNIKOM (TEMPLATE) ---
router.get('/menu', async (req, res) => {
    console.log('[GET /admin/menu] Prikaz stranice za upravljanje templateom jelovnika.');
    try {
        
        res.render('admin/menu_management', {
            title: 'Upravljanje Tjednim Jelovnikom (Template)',
            message: req.query.message,
            error: req.query.error
        });
    } catch (error) {
        console.error("[GET /admin/menu] Error loading menu management page:", error.stack);
        res.redirect('/admin?error=' + encodeURIComponent('Greška pri učitavanju stranice za jelovnik.'));
    }
});

router.get('/menu/edit/:dayKey', async (req, res) => {
    console.log(`[GET /admin/menu/edit/${req.params.dayKey}] Prikaz forme za uređivanje templatea.`);
    try {
        const { dayKey } = req.params;
        if (!DAYS_OF_WEEK_ORDER.includes(dayKey)) {
            return res.status(404).render('partials/error_page', { statusCode: 404, message: 'Nepostojeći dan.', title: 'Nije pronađeno'});
        }
        const dayMenuData = await getSingleDayMenuTemplate(dayKey);
        
        let dayNameForTitle = dayKey.charAt(0).toUpperCase() + dayKey.slice(1);
        if (dayMenuData && dayMenuData.day_name_display) {
            dayNameForTitle = dayMenuData.day_name_display;
        } else if (typeof DAY_DISPLAY_NAMES !== 'undefined' && DAY_DISPLAY_NAMES[dayKey]) {
            dayNameForTitle = DAY_DISPLAY_NAMES[dayKey];
        }

        res.render('admin/edit_menu_item', {
            title: `Uredi Template za ${dayNameForTitle}`,
            dayMenu: dayMenuData,
            dayKey
        });
    } catch (error) {
        console.error(`[GET /admin/menu/edit/${req.params.dayKey}] Error loading edit page:`, error.stack);
        res.redirect('/admin/menu?error=' + encodeURIComponent('Greška pri učitavanju forme za uređivanje.'));
    }
});

router.post('/menu/edit/:dayKey', async (req, res) => {
    console.log(`[POST /admin/menu/edit/${req.params.dayKey}] Spremanje izmjena u template.`);
    //console.log('Primljeno tijelo zahtjeva (req.body):', JSON.stringify(req.body, null, 2));
    try {
        const { dayKey } = req.params;
        const {
            day_name_display, meal_1_description, has_two_options,
            meal_2_description, option_2_prompt, no_offer_today
        } = req.body;
        const hasTwoOptionsBool = !!has_two_options;
        const noOfferTodayBool = !!no_offer_today;

        // Logiranje vrijednosti prije prosljeđivanja u DB funkciju
        //console.log('--- Vrijednosti za spremanje ---');
        //console.log('dayKey:', dayKey);
        //console.log('day_name_display:', day_name_display ? day_name_display.trim() : null);
        //console.log('meal_1_description (za DB):', noOfferTodayBool ? "" : (meal_1_description || "").trim());
        //console.log('hasTwoOptionsBool (za DB):', noOfferTodayBool ? false : hasTwoOptionsBool);
        //console.log('meal_2_description (iz forme):', meal_2_description); // <<<< VAŽAN LOG
        //console.log('meal_2_description (za DB):', noOfferTodayBool ? "" : (hasTwoOptionsBool ? (meal_2_description || "").trim() : null));
        //console.log('option_2_prompt (za DB):', noOfferTodayBool ? "" : (hasTwoOptionsBool ? (option_2_prompt || "").trim() : null));
        //console.log('noOfferTodayBool (za DB):', noOfferTodayBool);
        //console.log('-----------------------------');

        
        await upsertDailyMenuTemplate( 
            dayKey, day_name_display.trim(), 
            
            noOfferTodayBool ? "" : (meal_1_description || "").trim(),
            noOfferTodayBool ? "" : (hasTwoOptionsBool ? (meal_2_description || "").trim() : null),
            noOfferTodayBool ? false : hasTwoOptionsBool, 
            noOfferTodayBool ? "" : (hasTwoOptionsBool ? (option_2_prompt || "").trim() : null),
            noOfferTodayBool 
        );
        res.redirect('/admin/menu?message=' + encodeURIComponent(`Template za ${day_name_display} uspješno ažuriran.`));
    } catch (error) {
        console.error(`[POST /admin/menu/edit/${req.params.dayKey}] Error saving menu template:`, error.stack);
        res.redirect(`/admin/menu/edit/${req.params.dayKey}?error=` + encodeURIComponent('Greška pri spremanju templatea jelovnika.'));
    }
});

router.post('/menu/reset-week', async (req, res) => { 
    console.log('[POST /admin/menu/reset-week] Pokušaj resetiranja tjednog jelovnika (templatea).');
    try {
        await clearWeeklyMenuTemplate(); 
        res.redirect('/admin/menu?message=' + encodeURIComponent('Cijeli template tjednog jelovnika je uspješno resetiran.'));
    } catch (error) {
        console.error("[POST /admin/menu/reset-week] Greška prilikom resetiranja tjednog jelovnika (templatea):", error.stack);
        res.redirect('/admin/menu?error=' + encodeURIComponent('Dogodila se greška prilikom resetiranja templatea jelovnika.'));
    }
});

// RUTA ZA PRIKAZ KORISNIKA KOJI SU ODABRALI SPECIFIČNO JELO ODREĐENOG DANA I TJEDNA
router.get('/voters/:weekStartDate/:dayOfWeekNumeric/:optionNumber', async (req, res) => {
    const { weekStartDate, dayOfWeekNumeric, optionNumber } = req.params;
    const optionNumInt = parseInt(optionNumber);
    const dayNumericInt = parseInt(dayOfWeekNumeric);

    let dayNameDisplay = `Dan ${dayNumericInt}`;
    const dayKeyFromNumeric = DAYS_OF_WEEK_ORDER[dayNumericInt - 1]; 
    
    if (res.locals.weeklyMenu && res.locals.weeklyMenu[dayKeyFromNumeric] && res.locals.weeklyMenu[dayKeyFromNumeric].name) {
        dayNameDisplay = res.locals.weeklyMenu[dayKeyFromNumeric].name;
    } else if (typeof DAY_DISPLAY_NAMES !== 'undefined' && DAY_DISPLAY_NAMES[dayKeyFromNumeric]) {
        dayNameDisplay = DAY_DISPLAY_NAMES[dayKeyFromNumeric];
    }
    
    const weekStartDateObjForDisplay = new Date(weekStartDate + "T00:00:00Z");

    try {
        if (!dayKeyFromNumeric || (optionNumInt !== 1 && optionNumInt !== 2)) {
            return res.status(400).render('partials/error_page', { statusCode: 400, message: 'Neispravan dan ili opcija jela.', title: 'Neispravan zahtjev'});
        }
        const voters = await getUsersWhoChoseOptionOnDate(weekStartDate, dayNumericInt, optionNumInt);
        res.render('admin/voters_for_day', {
            title: `Korisnici: Jelo ${optionNumInt} za ${dayNameDisplay} (Tjedan počinje: ${formatDateToDDMMYYYY(weekStartDateObjForDisplay)})`,
            dayName: dayNameDisplay, optionNumber: optionNumInt, 
            weekStartDate: weekStartDate, 
            weekStartDateDisplay: formatDateToDDMMYYYY(weekStartDateObjForDisplay),
            dayKey: dayKeyFromNumeric, voters: voters,
            
        });
    } catch (error) {
        console.error(`[GET /admin/voters/${weekStartDate}/${dayOfWeekNumeric}/${optionNumber}] Greška:`, error.stack);
        res.status(500).render('partials/error_page', { 
            statusCode: 500, 
            message: `Greška prilikom dohvaćanja glasača za ${dayNameDisplay}, Jelo ${optionNumber}.`, 
            title: 'Greška Servera'
        });
    }
});


// --- RUTE ZA OBJAVLJIVANJE JELOVNIKA ---
router.get('/menu/publish', async (req, res) => {
    console.log('[GET /admin/menu/publish] Prikaz forme za odabir tjedna za objavu.');
    try {
        const today = new Date();
        const currentWeekStart = getWeekStartDate(today);
        const futureWeeks = [];
        for (let i = 0; i < 8; i++) { 
            const weekStart = new Date(currentWeekStart);
            weekStart.setDate(currentWeekStart.getDate() + (i * 7));
            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekStart.getDate() + 4);
            futureWeeks.push({
                value: formatDateToYYYYMMDD(weekStart),
                display: `${formatDateToDDMMYYYY(weekStart)} - ${formatDateToDDMMYYYY(weekEnd)}`
            });
        }
        
        res.render('admin/publish_menu', {
            title: 'Objavi Jelovnik za Tjedan',
            futureWeeks: futureWeeks,
            message: req.query.message,
            error: req.query.error
        });
    } catch (error) {
        console.error("[GET /admin/menu/publish] Greška:", error.stack);
        res.status(500).render('partials/error_page', {statusCode: 500, message: 'Greška pri pripremi stranice za objavu.', title: 'Greška'});
    }
});

router.post('/menu/publish', async (req, res) => {
    const { week_start_date } = req.body; 

    if (!week_start_date || !/^\d{4}-\d{2}-\d{2}$/.test(week_start_date)) {
        return res.redirect('/admin/menu/publish?error=' + encodeURIComponent('Neispravan format datuma tjedna.'));
    }
    console.log(`[POST /admin/menu/publish] Pokušaj objave jelovnika za tjedan: ${week_start_date}`);
    try {
        await publishMenuForWeek(week_start_date);
        const weekStartDateObj = new Date(week_start_date + "T00:00:00Z"); 
        const displayDate = formatDateToDDMMYYYY(weekStartDateObj);
        res.redirect('/admin/menu/publish?message=' + encodeURIComponent(`Jelovnik uspješno objavljen za tjedan koji počinje ${displayDate}.`));
    } catch (error) {
        console.error(`[POST /admin/menu/publish] Greška pri objavi jelovnika za ${week_start_date}:`, error.stack);
        res.redirect('/admin/menu/publish?error=' + encodeURIComponent('Greška prilikom objave jelovnika.'));
    }
});


module.exports = router;