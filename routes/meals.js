const express = require('express');
const { saveUserDailyChoice, getUserDailyChoices } = require('../database'); 
const { isAuthenticated } = require('../middleware/authMiddleware');
const router = express.Router();

router.get('/dashboard', isAuthenticated, async (req, res) => {
    console.log('[GET /dashboard] Ulaz u rutu.');
    try {
        const userId = req.session.user.id;
        console.log(`[GET /dashboard] Pristupa korisnik ID: ${userId}, Admin status: ${req.session.user.is_admin}`);

        const userChoices = await getUserDailyChoices(userId); 
        console.log('[GET /dashboard] Korisnički odabiri:', userChoices);

        res.render('dashboard', {
            userChoices, 
            message: req.query.message,
            error: req.query.error
        });
    } catch (error) {
        console.error("[GET /dashboard] Greška u ruti:", error);
        res.status(500).render('dashboard', {
            userChoices: {}, 
            message: 'Greška pri učitavanju podataka za dashboard.',
            error: true,
        });
    }
});

router.post('/dashboard', isAuthenticated, async (req, res) => {
    console.log('[POST /dashboard] Ulaz u rutu.');
    const userId = req.session.user.id;
    const choicesFromForm = req.body.choices || {}; 
    

    try {
        console.log('[POST /dashboard] Spremanje odabira:', choicesFromForm);
        for (const dayKey of res.locals.daysOrder) {
            const chosenOptionForDay = choicesFromForm[dayKey]; 
            await saveUserDailyChoice(userId, dayKey, chosenOptionForDay);
        }
        res.redirect('/dashboard?message=Odabiri uspješno spremljeni!');
    } catch (error) {
        console.error("[POST /dashboard] Error saving meal preferences:", error);
        const userChoices = await getUserDailyChoices(userId);
        res.render('dashboard', {
            userChoices,
            message: 'Greška pri spremanju odabira. Molimo pokušajte ponovno.',
            error: true
        });
    }
});

module.exports = router;