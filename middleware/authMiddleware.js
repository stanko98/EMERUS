function isAuthenticated(req, res, next) {
    if (!req.session.user) {
        return res.redirect('/login?message=Please login to continue');
    }
    next();
}

function isAdmin(req, res, next) {
    if (!req.session.user || !req.session.user.is_admin) {
        req.session.destroy(); 
        return res.status(403).render('partials/error_page', {
            statusCode: 403,
            message: 'Nemate ovlasti za pristup ovoj stranici.',
            title: 'Zabranjen pristup'
        });
    }
    next();
}

module.exports = { isAuthenticated, isAdmin };