/**
 * Theme Module
 * Handles logo persistence. Sniparr is always dark — no light mode.
 */

window.SniparrTheme = {
    logoSrc: null,

    setupLogoHandling: function() {
        const logoImg = document.querySelector('.sidebar .logo');
        if (logoImg) {
            this.logoSrc = logoImg.src;
            if (!logoImg.complete) {
                logoImg.onload = () => {
                    this.logoSrc = logoImg.src;
                };
            }
        }
        
        window.addEventListener('beforeunload', () => {
            if (this.logoSrc) {
                sessionStorage.setItem('sniparr-logo-src', this.logoSrc);
            }
        });
    },

    initDarkMode: function() {
        // Sniparr is always dark — ensure the class is applied
        document.body.classList.add('dark-theme');
    }
};
