/**
 * UI Handlers Module
 * Handles dropdowns, tab changes, and other UI interaction events
 */

window.SniparrUIHandlers = {
    handleHistoryOptionChange: function(app) {
        if (app && app.target && typeof app.target.value === 'string') {
            app = app.target.value;
        } else if (app && app.target && typeof app.target.getAttribute === 'function') {
            app = app.target.getAttribute('data-app');
        }
        
        if (!app || (window.sniparrUI && app === window.sniparrUI.currentHistoryApp)) return;
        
        const historyAppSelect = document.getElementById('historyAppSelect');
        if (historyAppSelect) historyAppSelect.value = app;
        
        let displayName = app.charAt(0).toUpperCase() + app.slice(1);
        if (app === 'whisparr') displayName = 'Whisparr V2';
        else if (app === 'eros') displayName = 'Whisparr V3';
        
        if (window.sniparrUI && window.sniparrUI.elements.currentHistoryApp) {
            window.sniparrUI.elements.currentHistoryApp.textContent = displayName;
        }
        
        this.updateHistoryPlaceholder(app);
        if (window.sniparrUI) window.sniparrUI.currentHistoryApp = app;
    },
    
    updateHistoryPlaceholder: function(app) {
        const placeholder = document.getElementById('history-placeholder-text');
        if (!placeholder) return;
        
        let message = "";
        if (app === 'all') {
            message = "The History feature will be available in a future update. Stay tuned for enhancements that will allow you to view your media processing history.";
        } else {
            const displayName = window.SniparrHelpers ? window.SniparrHelpers.capitalizeFirst(app) : app;
            message = `The ${displayName} History feature is under development and will be available in a future update. You'll be able to track your ${displayName} media processing history here.`;
        }
        
        placeholder.textContent = message;
    },
    
    handleSettingsOptionChange: function(e) {
        e.preventDefault();
        
        const app = e.target.getAttribute('data-app');
        if (!app || (window.sniparrUI && app === window.sniparrUI.currentSettingsApp)) return;
        
        if (window.sniparrUI && window.sniparrUI.elements.settingsOptions) {
            window.sniparrUI.elements.settingsOptions.forEach(option => {
                option.classList.remove('active');
            });
        }
        e.target.classList.add('active');
        
        let displayName = app.charAt(0).toUpperCase() + app.slice(1);
        if (window.sniparrUI && window.sniparrUI.elements.currentSettingsApp) {
            window.sniparrUI.elements.currentSettingsApp.textContent = displayName;
        }
        
        if (window.sniparrUI && window.sniparrUI.elements.settingsDropdownContent) {
            window.sniparrUI.elements.settingsDropdownContent.classList.remove('show');
        }
        
        if (window.sniparrUI && window.sniparrUI.elements.appSettingsPanels) {
            window.sniparrUI.elements.appSettingsPanels.forEach(panel => {
                panel.classList.remove('active');
                panel.style.display = 'none';
            });
        }
        
        const selectedPanel = document.getElementById(app + 'Settings');
        if (selectedPanel) {
            selectedPanel.classList.add('active');
            selectedPanel.style.display = 'block';
        }
        
        if (window.sniparrUI) window.sniparrUI.currentSettingsTab = app;
        console.log(`[SniparrUIHandlers] Switched settings tab to: ${app}`);
    }
};
