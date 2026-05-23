/**
 * Authentication Module
 * Handles user login, logout, and local access bypass status
 */

window.SniparrAuth = {
    checkLocalAccessBypassStatus: function() {
        console.log("[SniparrAuth] Checking local access bypass status...");
        SniparrUtils.fetchWithTimeout('./api/get_local_access_bypass_status')
            .then(response => {
                if (!response.ok) throw new Error(`HTTP error ${response.status}`);
                return response.json();
            })
            .then(data => {
                if (data && typeof data.isEnabled === 'boolean') {
                    this.updateUIForLocalAccessBypass(data.isEnabled);
                } else {
                    this.updateUIForLocalAccessBypass(false);
                }
            })
            .catch(error => {
                console.error('[SniparrAuth] Error checking local access bypass status:', error);
                this.updateUIForLocalAccessBypass(false);
            });
    },
    
    updateUIForLocalAccessBypass: function(isEnabled) {
        const userInfoContainer = document.getElementById('userInfoContainer');
        const userNav = document.getElementById('userNav');
        
        if (isEnabled === true) {
            if (userInfoContainer) userInfoContainer.style.display = 'none';
            if (userNav) {
                userNav.style.display = 'none';
            }
        } else {
            if (userInfoContainer) userInfoContainer.style.display = 'flex';
            if (userNav) userNav.style.display = '';
        }
    },
    
    logout: function(e) {
        if (e) e.preventDefault();
        console.log('[SniparrAuth] Logging out...');
        SniparrUtils.fetchWithTimeout('./logout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                window.location.href = './login';
            } else {
                if (window.SniparrNotifications) window.SniparrNotifications.showNotification('Logout failed', 'error');
            }
        })
        .catch(error => {
            console.error('[SniparrAuth] Error during logout:', error);
            if (window.SniparrNotifications) window.SniparrNotifications.showNotification('An error occurred during logout', 'error');
        });
    }
};
