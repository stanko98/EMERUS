
require('dotenv').config(); 

const express = require('express');
const session = require('express-session');
const { Pool } = require('pg'); 
const PGSession = require('connect-pg-simple')(session); 
const path = require('path');

// Učitavanje definicija ruta
const authRoutes = require('./routes/auth');
const mealRoutes = require('./routes/meals');
const adminRoutes = require('./routes/admin');

// Učitavanje konfiguracije i DB funkcija
const { DAYS_OF_WEEK_ORDER } = require('./config/menu'); 
const { getMenuTemplate, getArchivedMenuForWeek, DAY_DISPLAY_NAMES } = require('./database'); 
const { getWeekStartDate, formatDateToYYYYMMDD, getWorkWeekDaysForDate,formatDateToDDMMYYYY } = require('./utils/dateUtils');

const app = express();
const PORT = process.env.PORT || 3000;

// Postavljanje globalno dostupnih funkcija/varijabli za EJS predloške
app.locals.formatDateToDDMMYYYY = formatDateToDDMMYYYY;

const isProduction = process.env.NODE_ENV === 'production';

// Konfiguracija Pool-a za sesije
const sessionPoolConfig = {
    connectionString: process.env.DATABASE_URL,
};
if (isProduction && process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('sslmode')) {
    sessionPoolConfig.ssl = { rejectUnauthorized: false };
} else if (!process.env.DATABASE_URL) {
    sessionPoolConfig.user = process.env.DB_USER;
    sessionPoolConfig.host = process.env.DB_HOST;
    sessionPoolConfig.database = process.env.DB_NAME;
    sessionPoolConfig.password = process.env.DB_PASSWORD;
    sessionPoolConfig.port = parseInt(process.env.DB_PORT || "5432");
}
const sessionPool = new Pool(sessionPoolConfig);

// Osnovni Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Konfiguracija sesije s connect-pg-simple
app.use(session({
    store: new PGSession({
        pool: sessionPool,                
        tableName: 'user_sessions',       
        createTableIfMissing: true,     
    }),
    secret: process.env.SESSION_SECRET || 'fallback_secret_for_dev_only_change_in_prod_very_long_and_random',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: isProduction, 
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 
    }
}));

// Postavke za View Engine (EJS)
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware za dostupnost podataka o korisniku, trenutnoj putanji i TEMPLATE tjednom jelovniku
app.use(async (req, res, next) => {
    res.locals.user = req.session.user;
    res.locals.currentPath = req.path;
    res.locals.daysOrder = DAYS_OF_WEEK_ORDER;
    res.locals.DAY_DISPLAY_NAMES = DAY_DISPLAY_NAMES;

    try {
        
        res.locals.weeklyMenu = await getMenuTemplate(); 
        console.log('[Middleware] Template weeklyMenu postavljen u res.locals.');
    } catch (error) {
        console.error("Greška pri dohvaćanju TEMPLATE jelovnika za res.locals u server.js:", error.stack);
        res.locals.weeklyMenu = {}; 
        DAYS_OF_WEEK_ORDER.forEach(dayKey => {
            const fallbackDayName = DAY_DISPLAY_NAMES[dayKey] || dayKey.toUpperCase();
            res.locals.weeklyMenu[dayKey] = { name: fallbackDayName, meal_1: "Greška pri učitavanju", has_two_options: false };
        });
    }

    if (req.path === '/' && !req.session.user) {
        res.locals.isGuestView = true;
    } else {
        res.locals.isGuestView = false;
    }
    next();
});

// Definicije Ruta
app.get('/', async (req, res) => { 
    if (req.session.user) {
        return res.redirect('/dashboard'); 
    }
    
    try {
        const weekQuery = req.query.week;
        let targetReferenceDate;

        if (weekQuery && /^\d{4}-\d{2}-\d{2}$/.test(weekQuery)) {
            try {
                targetReferenceDate = new Date(weekQuery + "T00:00:00Z");
                if (isNaN(targetReferenceDate.getTime())) { 
                    console.warn(`[GET / - GUEST] Neispravan 'week' query (${weekQuery}), koristim tekući datum.`);
                    targetReferenceDate = new Date(); 
                }
            } catch (e) {
                console.warn(`[GET / - GUEST] Greška pri parsiranju 'week' query (${weekQuery}), koristim tekući datum.`, e);
                targetReferenceDate = new Date();
            }
        } else {
            targetReferenceDate = new Date();
            if (weekQuery) {
                 console.warn(`[GET / - GUEST] Neispravan format 'week' query (${weekQuery}), koristim tekući datum.`);
            }
        }

        const targetWeekStartDate = getWeekStartDate(targetReferenceDate);
        const targetWeekStartDateString = formatDateToYYYYMMDD(targetWeekStartDate);
        
        
        let displayedMenu = await getArchivedMenuForWeek(targetWeekStartDateString);
        let isTargetMenuPublished = true;
        if (!displayedMenu) {
            console.log(`[GET / - GUEST] Nema arhiviranog menija za tjedan ${targetWeekStartDateString}, koristim template.`);
            displayedMenu = res.locals.weeklyMenu; 
            isTargetMenuPublished = false;
        }
        
        const workWeekDaysForTarget = getWorkWeekDaysForDate(targetWeekStartDate);
        
        const endDateOfTargetWeek = new Date(targetWeekStartDate);
        endDateOfTargetWeek.setDate(targetWeekStartDate.getDate() + 4);
        const targetWeekDisplay = `${formatDateToDDMMYYYY(targetWeekStartDate)} - ${formatDateToDDMMYYYY(endDateOfTargetWeek)}`;

        const prevWeekStartObj = new Date(targetWeekStartDate);
        prevWeekStartObj.setDate(prevWeekStartObj.getDate() - 7);
        const prevWeekLink = `/?week=${formatDateToYYYYMMDD(prevWeekStartObj)}`;

        const nextWeekStartObj = new Date(targetWeekStartDate);
        nextWeekStartObj.setDate(nextWeekStartObj.getDate() + 7);
        const nextWeekLink = `/?week=${formatDateToYYYYMMDD(nextWeekStartObj)}`;
        
        const today = new Date();
        const startOfTodayWeek = getWeekStartDate(today);
        const isFutureWeek = targetWeekStartDate > startOfTodayWeek;
        const isCurrentWeek = targetWeekStartDate.getTime() === startOfTodayWeek.getTime();

        console.log(`[GET / - GUEST] Prikazujem za tjedan: ${targetWeekDisplay}, Budući: ${isFutureWeek}, Tekući: ${isCurrentWeek}, Objavljen: ${isTargetMenuPublished}`);
        res.render('guest_menu', { 
            title: `Tjedni Menu (${targetWeekDisplay}) - Emerus Kuhinja`,
            workWeekDays: workWeekDaysForTarget,
            currentWeekDisplay: targetWeekDisplay,
            prevWeekLink,
            nextWeekLink,
            isFutureWeek: isFutureWeek,
            isCurrentWeek: isCurrentWeek,
            displayedMenu: displayedMenu, 
            isMenuPublished: isTargetMenuPublished, 
            // DAY_DISPLAY_NAMES, daysOrder i weeklyMenu (template) su dostupni preko res.locals
        });
    } catch (error) {
        console.error("[GET / - GUEST] Greška u ruti:", error.stack);
        res.status(500).render('partials/error_page', {
            statusCode: 500,
            message: 'Greška pri učitavanju jelovnika.',
            title: 'Greška Servera'
        });
    }
});

// Montiranje ruta
app.use('/', authRoutes);
app.use('/', mealRoutes);
app.use('/admin', adminRoutes);

// Osnovno rukovanje greškama
app.use((err, req, res, next) => {
    console.error("Global Error Handler:", err.message);
    if (!isProduction && err.stack) { 
        console.error(err.stack);
    }
    res.status(err.status || 500).render('partials/error_page', {
        statusCode: err.status || 500,
        message: err.message || 'Došlo je do neočekivane greške na serveru.',
        title: `Greška ${err.status || 500}`
    });
});

// Middleware za 404 greške
app.use((req, res, next) => {
    res.status(404).render('partials/error_page', {
        statusCode: 404,
        message: 'Tražena stranica nije pronađena.',
        title: 'Stranica nije pronađena'
    });
});

// Pokretanje servera
app.listen(PORT, '0.0.0.0', () => {
    if (isProduction) {
        console.log(`Server je pokrenut i sluša na portu ${PORT}`);
    } else {
        console.log(`Server je pokrenut i sluša na http://localhost:${PORT}`);
    }
});