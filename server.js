
require('dotenv').config(); 

const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session); 
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

// Osnovni Middleware
app.use(express.urlencoded({ extended: true })); 
app.use(express.json()); 
app.use(express.static(path.join(__dirname, 'public'))); 

// Konfiguracija sesije
app.use(session({
    store: new SQLiteStore({
        db: 'sessions.sqlite',
        dir: '.',
        table: 'sessions'
    }),
    secret: process.env.SESSION_SECRET || 'a_very_strong_fallback_secret_key_for_development_only',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
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
        console.error("Greška pri dohvaćanju tjednog jelovnika za res.locals:", error);
        
        res.locals.weeklyMenu = {}; 
        DAYS_OF_WEEK_ORDER.forEach(dayKey => {
            res.locals.weeklyMenu[dayKey] = { name: dayKey.toUpperCase(), meal_1: "Greška pri učitavanju", has_two_options: false };
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

// Osnovno rukovanje greškama (Error Handling Middleware)
app.use((err, req, res, next) => {
    console.error("Global Error Handler:", err.message);
    if (process.env.NODE_ENV !== 'production' && err.stack) {
        console.error(err.stack);
    }
    res.status(err.status || 500).render('partials/error_page', {
        statusCode: err.status || 500,
        message: err.message || 'Došlo je do neočekivane greške na serveru.',
        title: `Greška ${err.status || 500}`
    });
});

// Middleware za 404 greške (Not Found)
app.use((req, res, next) => {
    res.status(404).render('partials/error_page', {
        statusCode: 404,
        message: 'Tražena stranica nije pronađena.',
        title: 'Stranica nije pronađena'
    });
});


// Pokretanje servera
app.listen(PORT, () => {
    console.log(`Server je pokrenut i sluša na http://localhost:${PORT}`);
});