const express = require('express');
const { addUser, findUserByUsername, verifyPassword } = require('../database');
const router = express.Router();

// Middleware: Ako je korisnik već prijavljen, preusmjeri ga na dashboard
function guest(req, res, next) {
    if (req.session.user) {
        if (req.session.user.is_admin) {
            return res.redirect('/admin');
        }
        return res.redirect('/dashboard');
    }
    next();
}

// GET /register - samo za goste (neprijavljene korisnike)
router.get('/register', guest, (req, res) => {
    res.render('register', { error: null, success: null });
});

// POST /register - samo za goste
router.post('/register', guest, async (req, res) => {
    const { username, password, confirm_password } = req.body;
    if (!username || !password || !confirm_password) {
        return res.render('register', { error: 'Sva polja su obavezna.', success: null });
    }
    if (password !== confirm_password) {
        return res.render('register', { error: 'Lozinke se ne podudaraju.', success: null });
    }

    try {
        const existingUser = await findUserByUsername(username);
        if (existingUser) {
            return res.render('register', { error: 'Korisničko ime je već zauzeto.', success: null });
        }
        
        await addUser(username, password);
        const successMessage = encodeURIComponent('Registracija uspješna! Molimo prijavite se.');
        res.redirect(`/login?message=${successMessage}`);

    } catch (error) {
        console.error("Registration error:", error);
        res.render('register', { error: 'Dogodila se greška prilikom registracije.', success: null });
    }
});

// GET /login - samo za goste
router.get('/login', guest, (req, res) => {
    res.render('login', { 
        error: req.query.error || null, 
        message: req.query.message ? decodeURIComponent(req.query.message) : null 
    });
});

// POST /login - samo za goste
router.post('/login', guest, async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.render('login', { error: 'Korisničko ime i lozinka su obavezni.', message: null });
    }

    try {
        const user = await findUserByUsername(username);
        if (!user) {
            return res.render('login', { error: 'Neispravno korisničko ime ili lozinka.', message: null });
        }
        const isValid = await verifyPassword(password, user.password);
        if (!isValid) {
            return res.render('login', { error: 'Neispravno korisničko ime ili lozinka.', message: null });
        }

        req.session.user = {
            id: user.id,
            username: user.username,
            is_admin: !!user.is_admin
        };

        if (req.session.user.is_admin) {
            res.redirect('/admin');
        } else {
            res.redirect('/dashboard');
        }

    } catch (error) {
        console.error("Login error:", error);
        res.render('login', { error: 'Dogodila se greška prilikom prijave.', message: null });
    }
});

// GET /logout - za prijavljene korisnike
router.get('/logout', (req, res, next) => {
    req.session.destroy(err => {
        if (err) {
            console.error("Logout error:", err);
            return res.redirect('/'); 
        }
        res.clearCookie('connect.sid');
        res.redirect('/'); 
    });
});

module.exports = router;