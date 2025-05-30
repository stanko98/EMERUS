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

// Učitavanje konfiguracije redoslijeda dana i funkcije za dohvaćanje menija iz baze
const { DAYS_OF_WEEK_ORDER } = require('./config/menu'); 
const { getMenuDataFromDB } = require('./database'); 

const app = express();
const PORT = process.env.PORT || 3000;

const isProduction = process.env.NODE_ENV === 'production';


const sessionPool = new Pool({
    connectionString: process.env.DATABASE_URL, 
    ssl: isProduction ? { rejectUnauthorized: false } : false 
});

/*
const sessionPool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: parseInt(process.env.DB_PORT || "5432"),
    // ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false, // Za produkcijske SSL konekcije
});
*/

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
    secret: process.env.SESSION_SECRET || 'fallback_secret_for_dev_only_change_in_prod',
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

// Middleware za dostupnost podataka o korisniku, trenutnoj putanji i tjednom jelovniku u svim predlošcima
app.use(async (req, res, next) => {
    res.locals.user = req.session.user;
    res.locals.currentPath = req.path;
    
    try {
        res.locals.weeklyMenu = await getMenuDataFromDB(); 
        res.locals.daysOrder = DAYS_OF_WEEK_ORDER;
    } catch (error) {
        console.error("Greška pri dohvaćanju tjednog jelovnika za res.locals u server.js:", error);
        res.locals.weeklyMenu = {}; 
        DAYS_OF_WEEK_ORDER.forEach(dayKey => {
            
            const fallbackDayName = dayKey.charAt(0).toUpperCase() + dayKey.slice(1);
            res.locals.weeklyMenu[dayKey] = { name: fallbackDayName, meal_1: "Greška pri učitavanju", has_two_options: false };
        });
        res.locals.daysOrder = DAYS_OF_WEEK_ORDER;
    }

    if (req.path === '/' && !req.session.user) {
        res.locals.isGuestView = true;
    } else {
        res.locals.isGuestView = false;
    }
    next();
});

// Definicije Ruta
app.get('/', (req, res) => {
    if (req.session.user) {
        res.redirect('/dashboard');
    } else {
        res.render('guest_menu', { 
            title: 'Tjedni Menu - Emerus Kuhinja'
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
app.listen(PORT, () => {
    if (isProduction) {
        console.log(`Server je pokrenut i sluša na portu ${PORT}`);
    } else {
        console.log(`Server je pokrenut i sluša na http://localhost:${PORT}`);
    }
    
});