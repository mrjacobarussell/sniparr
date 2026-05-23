/**
 * Settings Module
 * Handles loading, saving, and auto-saving of application settings
 */

window.SniparrSettings = {
    settingsCurrentlySaving: false,

    loadAllSettings: function() {
        if (!window.sniparrUI) return;
        
        window.sniparrUI.updateSaveResetButtonState(false);
        window.sniparrUI.settingsChanged = false;
        
        SniparrUtils.fetchWithTimeout('./api/settings')
            .then(response => response.json())
            .then(data => {
                console.log('[SniparrSettings] Loaded settings:', data);
                
                window.sniparrUI.originalSettings = data;
                
                try {
                    localStorage.setItem('sniparr-settings-cache', JSON.stringify(data));
                } catch (e) {
                    console.warn('[SniparrSettings] Failed to cache settings:', e);
                }
                
                const apps = ['sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros', 'swaparr', 'prowlarr', 'general'];
                apps.forEach(app => {
                    if (data[app]) {
                        if (app === 'swaparr') window.swaparrSettings = data.swaparr;
                        this.populateSettingsForm(app, data[app]);
                    }
                });
                
                if (typeof SettingsForms !== 'undefined') {
                    if (typeof SettingsForms.updateDurationDisplay === 'function') SettingsForms.updateDurationDisplay();
                    if (typeof SettingsForms.updateAllSwaparrInstanceVisibility === 'function') SettingsForms.updateAllSwaparrInstanceVisibility();
                }
                
                if (window.sniparrUI.loadStatefulInfo) window.sniparrUI.loadStatefulInfo();
            })
            .catch(error => {
                console.error('[SniparrSettings] Error loading settings:', error);
                if (window.SniparrNotifications) window.SniparrNotifications.showNotification('Error loading settings', 'error');
            });
    },
    
    populateSettingsForm: function(app, appSettings) {
        const form = document.getElementById(`${app}Settings`);
        if (!form) return;
        
        if (typeof SettingsForms !== 'undefined') {
            const formFunction = SettingsForms[`generate${app.charAt(0).toUpperCase()}${app.slice(1)}Form`];
            if (typeof formFunction === 'function') {
                formFunction(form, appSettings);
                
                if (typeof SettingsForms.updateDurationDisplay === 'function') {
                    try { SettingsForms.updateDurationDisplay(); } catch (e) {}
                }
                
                if (app === 'swaparr' && typeof SettingsForms.updateAllSwaparrInstanceVisibility === 'function') {
                    try { SettingsForms.updateAllSwaparrInstanceVisibility(); } catch (e) {}
                }
            }
        }
    },
    
    saveSettings: function() {
        if (!window.sniparrUI) return;
        
        const app = window.sniparrUI.currentSettingsTab;
        window.sniparrUI.settingsChanged = false;
        window.sniparrUI.updateSaveResetButtonState(false);
        
        let settings = this.getFormSettings(app);
        if (!settings) {
            if (window.SniparrNotifications) window.SniparrNotifications.showNotification('Error collecting settings', 'error');
            return;
        }

        const isAuthModeChanged = app === 'general' && 
            window.sniparrUI.originalSettings?.general?.auth_mode !== settings.auth_mode;
            
        const endpoint = app === 'general' ? './api/settings/general' : `./api/settings/${app}`;
        
        SniparrUtils.fetchWithTimeout(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        })
        .then(response => {
            if (!response.ok) return response.json().then(err => { throw new Error(err.error || `HTTP ${response.status}`); });
            return response.json();
        })
        .then(savedConfig => {
            if (isAuthModeChanged) {
                if (window.SniparrNotifications) window.SniparrNotifications.showNotification('Settings saved. Reloading...', 'success');
                setTimeout(() => window.location.href = './', 1500);
                return;
            }
            
            if (typeof savedConfig === 'object' && savedConfig !== null) {
                window.sniparrUI.originalSettings = JSON.parse(JSON.stringify(savedConfig));
                
                if (app === 'swaparr') {
                    const swaparrData = savedConfig.swaparr || (savedConfig && !savedConfig.sonarr ? savedConfig : null);
                    if (swaparrData) window.swaparrSettings = swaparrData;
                }
                
            }

            const currentAppSettings = window.sniparrUI.originalSettings[app] || {};
            if (app === 'sonarr' && !currentAppSettings.instances && settings.instances) {
                currentAppSettings.instances = settings.instances;
            }
            
            if (app === 'general' && typeof SettingsForms !== 'undefined' && SettingsForms.reRenderGeneralSection) {
                const sectionMap = { 'settings': 'main', 'notifications': 'notifications', 'settings-logs': 'logs' };
                const section = sectionMap[window.sniparrUI.currentSection] || 'main';
                SettingsForms.reRenderGeneralSection(section, window.sniparrUI.originalSettings.general);
            } else {
                this.populateSettingsForm(app, currentAppSettings);
            }
            if (window.sniparrUI.checkAppConnection) window.sniparrUI.checkAppConnection(app);
            if (window.sniparrUI.updateHomeConnectionStatus) window.sniparrUI.updateHomeConnectionStatus();
            
            if (app === 'general') {
                if (settings.stateful_management_hours && document.getElementById('stateful_management_hours')) {
                    if (window.sniparrUI.updateStatefulExpirationOnUI) window.sniparrUI.updateStatefulExpirationOnUI();
                } else {
                    if (window.sniparrUI.loadStatefulInfo) window.sniparrUI.loadStatefulInfo();
                }
                window.dispatchEvent(new CustomEvent('settings-saved', { detail: { appType: app, settings: settings } }));
            }
        })
        .catch(error => {
            console.error('[SniparrSettings] Error saving settings:', error);
            if (window.SniparrNotifications) window.SniparrNotifications.showNotification(`Error: ${error.message}`, 'error');
            window.sniparrUI.settingsChanged = true;
            window.sniparrUI.updateSaveResetButtonState(true);
        });
    },

    setupSettingsAutoSave: function() {
        const settingsContainer = document.getElementById('settingsSection');
        if (!settingsContainer) return;

        settingsContainer.addEventListener('input', (event) => {
            if (event.target.matches('input, textarea')) this.triggerSettingsAutoSave();
        });
        
        settingsContainer.addEventListener('change', (event) => {
            if (event.target.matches('input, select, textarea')) {
                if (event.target.id === 'timezone' && window.sniparrUI.applyTimezoneChange) {
                    window.sniparrUI.applyTimezoneChange(event.target.value);
                } else if (event.target.id === 'auth_mode' && window.sniparrUI.applyAuthModeChange) {
                    window.sniparrUI.applyAuthModeChange(event.target.value);
                } else if (event.target.id === 'show_trending' && window.sniparrUI.applyShowTrendingChange) {
                    window.sniparrUI.applyShowTrendingChange(event.target.checked);
                }
                this.triggerSettingsAutoSave();
            }
        });
    },

    triggerSettingsAutoSave: function() {
        if (this.settingsCurrentlySaving || !window.sniparrUI) return;
        
        const app = window.sniparrUI.currentSettingsTab;
        const isGeneralSettings = window.sniparrUI.currentSection === 'settings' && !app;
        
        if (!app && !isGeneralSettings) return;
        
        if (isGeneralSettings) {
            this.autoSaveGeneralSettings(true).catch(e => console.error(e));
        } else {
            this.autoSaveSettings(app);
        }
    },

    autoSaveSettings: function(app) {
        if (this.settingsCurrentlySaving || !window.sniparrUI) return;
        
        this.settingsCurrentlySaving = true;
        const originalShowNotification = window.sniparrUI.showNotification;
        
        window.sniparrUI.showNotification = (message, type) => {
            if (type === 'error' && window.SniparrNotifications) window.SniparrNotifications.showNotification(message, type);
        };
        
        this.saveSettings();
        
        setTimeout(() => {
            if (window.sniparrUI) window.sniparrUI.showNotification = originalShowNotification;
            this.settingsCurrentlySaving = false;
        }, 1000);
    },

    getFormSettings: function(app) {
        const settings = {};
        let form = document.getElementById(`${app}Settings`);
        
        if (app === 'swaparr') {
            form = document.getElementById('swaparrContainer') || 
                   document.querySelector('.swaparr-container') ||
                   document.querySelector('[data-app-type="swaparr"]');
        }
        
        if (!form) return null;

        if (app === 'swaparr') {
            const inputs = form.querySelectorAll('input, select, textarea');
            inputs.forEach(input => {
                let key = input.id.startsWith('swaparr_') ? input.id.substring(8) : input.id;
                let value = input.type === 'checkbox' ? input.checked : (input.type === 'number' ? (input.value === '' ? null : parseInt(input.value, 10)) : input.value.trim());
                
                if (key === 'malicious_detection') key = 'malicious_file_detection';
                
                if (key && !key.includes('_tags') && !key.includes('_input')) {
                    if (key === 'sleep_duration' && input.type === 'number') settings[key] = value * 60;
                    else settings[key] = value;
                }
            });
            
            const tagContainers = [
                { id: 'swaparr_malicious_extensions_tags', key: 'malicious_extensions' },
                { id: 'swaparr_suspicious_patterns_tags', key: 'suspicious_patterns' },
                { id: 'swaparr_quality_patterns_tags', key: 'blocked_quality_patterns' }
            ];
            
            tagContainers.forEach(({ id, key }) => {
                const container = document.getElementById(id);
                settings[key] = container ? Array.from(container.querySelectorAll('.tag-text')).map(el => el.textContent) : [];
            });
            
            return settings;
        }

        if (app === 'general') {
            const currentSection = window.sniparrUI.currentSection;
            const sectionMap = { 'settings': 'main', 'notifications': 'notifications', 'settings-logs': 'logs' };
            const section = sectionMap[currentSection] || 'main';
            let container = null;
            if (section === 'main') container = document.getElementById('generalSettings');
            else if (section === 'notifications') container = document.querySelector('[data-app-type="notifications"]');
            else if (section === 'logs') container = document.querySelector('[data-app-type="logs"]');
            if (!container) return null;
            const sectionData = typeof SettingsForms !== 'undefined' && SettingsForms.getFormSettingsGeneralSection
                ? SettingsForms.getFormSettingsGeneralSection(container, section)
                : null;
            if (!sectionData) return null;
            const base = (window.sniparrUI && window.sniparrUI.originalSettings && window.sniparrUI.originalSettings.general)
                ? JSON.parse(JSON.stringify(window.sniparrUI.originalSettings.general))
                : {};
            Object.assign(base, sectionData);
            return base;
        }
        
        const instanceItems = form.querySelectorAll('.instance-item');
        settings.instances = [];
        
        if (instanceItems.length > 0) {
            instanceItems.forEach((item, index) => {
                const id = item.dataset.instanceId;
                const url = form.querySelector(`#${app}-url-${id}`);
                const key = form.querySelector(`#${app}-key-${id}`);
                const name = form.querySelector(`#${app}-name-${id}`);
                const enabled = form.querySelector(`#${app}-enabled-${id}`);

                if (url && key) {
                    settings.instances.push({
                        name: name?.value.trim() || `Instance ${index + 1}`,
                        api_url: window.SniparrHelpers ? window.SniparrHelpers.cleanUrlString(url.value) : url.value.trim(),
                        api_key: key.value.trim(),
                        enabled: enabled ? enabled.checked : (window.sniparrUI?.originalSettings?.[app]?.instances?.[index]?.enabled ?? true)
                    });
                }
            });
        } else {
            const url = form.querySelector(`#${app}_api_url`);
            const key = form.querySelector(`#${app}_api_key`);
            const name = form.querySelector(`#${app}_instance_name`);
            const enabled = form.querySelector(`#${app}_enabled`);

            if (url?.value.trim() && key?.value.trim()) {
                 settings.instances.push({
                     name: name?.value.trim() || `${app} Instance 1`,
                     api_url: window.SniparrHelpers ? window.SniparrHelpers.cleanUrlString(url.value) : url.value.trim(),
                     api_key: key.value.trim(),
                     enabled: enabled ? enabled.checked : (window.sniparrUI?.originalSettings?.[app]?.instances?.[0]?.enabled ?? true)
                 });
            }
        }

        // Safeguard: if we collected zero instances but the server has instances,
        // preserve the server's instances to prevent accidental config wipe
        if (settings.instances.length === 0 && window.sniparrUI?.originalSettings?.[app]?.instances?.length > 0) {
            console.warn(`[SniparrSettings] getFormSettings collected 0 instances for ${app} but server has ${window.sniparrUI.originalSettings[app].instances.length}. Preserving server instances to prevent data loss.`);
            settings.instances = JSON.parse(JSON.stringify(window.sniparrUI.originalSettings[app].instances));
        }

        const allInputs = form.querySelectorAll('input, select');
        allInputs.forEach(input => {
            if (input.type === 'button' || input.id.includes('-url-') || input.id.includes('-key-') || input.id.includes('-name-') || input.id.includes('-enabled-') || input.id.includes('_api_url') || input.id.includes('_api_key') || input.id.includes('_instance_name') || input.id.includes('_enabled')) return;
            
            let key = input.id.startsWith(`${app}_`) ? input.id.substring(app.length + 1) : input.id;
            if (!key || /^\d+$/.test(key)) return;
            
            settings[key] = input.type === 'checkbox' ? input.checked : (input.type === 'number' ? (input.value === '' ? null : parseInt(input.value, 10)) : input.value.trim());
        });

        return settings;
    },

    testNotification: function() {
        const status = document.getElementById('testNotificationStatus');
        const btn = document.getElementById('testNotificationBtn');
        if (!status || !btn || !window.sniparrUI) return;
        
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Auto-saving...';
        status.innerHTML = '<span style="color: #fbbf24;">Auto-saving settings before testing...</span>';
        
        this.autoSaveGeneralSettings().then(() => {
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
            status.innerHTML = '<span style="color: #fbbf24;">Sending test notification...</span>';
            return SniparrUtils.fetchWithTimeout('./api/test-notification', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
        })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                status.innerHTML = '<span style="color: #10b981;">✓ Test notification sent!</span>';
                if (window.SniparrNotifications) window.SniparrNotifications.showNotification('Test notification sent!', 'success');
            } else {
                status.innerHTML = '<span style="color: #ef4444;">✗ Failed to send</span>';
                if (window.SniparrNotifications) window.SniparrNotifications.showNotification(data.error || 'Failed to send', 'error');
            }
        })
        .catch(e => {
            status.innerHTML = '<span style="color: #ef4444;">✗ Error</span>';
            if (window.SniparrNotifications) window.SniparrNotifications.showNotification(e.message, 'error');
        })
        .finally(() => {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-bell"></i> Test Notification';
            setTimeout(() => { if (status) status.innerHTML = ''; }, 5000);
        });
    },

    autoSaveGeneralSettings: function(silent = false) {
        if (this.settingsCurrentlySaving) return Promise.resolve();
        const settings = this.getFormSettings('general');
        if (!settings) {
            return Promise.resolve();
        }
        this.settingsCurrentlySaving = true;
        const sectionMap = { 'settings': 'main', 'notifications': 'notifications', 'settings-logs': 'logs' };
        const section = sectionMap[window.sniparrUI.currentSection] || 'main';
        return SniparrUtils.fetchWithTimeout('./api/settings/general', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        })
        .then(r => r.json())
        .then(data => {
            if (data.success && !silent && window.SniparrNotifications) window.SniparrNotifications.showNotification('General settings auto-saved', 'success');
            if (data.general && window.sniparrUI && window.sniparrUI.originalSettings) {
                window.sniparrUI.originalSettings.general = JSON.parse(JSON.stringify(data.general));
                if (typeof window.sniparrUI.updateMovieHuntNavVisibility === 'function') {
                    window.sniparrUI.updateMovieHuntNavVisibility();
                }
            }
            // Don't re-render notifications - it has its own change-detection that would be reset
            if (section !== 'notifications' && typeof SettingsForms !== 'undefined' && SettingsForms.reRenderGeneralSection && data.general) {
                SettingsForms.reRenderGeneralSection(section, data.general);
            }
            this.settingsCurrentlySaving = false;
            return data;
        })
        .catch(e => {
            this.settingsCurrentlySaving = false;
            throw e;
        });
    },

    autoSaveSwaparrSettings: function(silent = false) {
        if (this.settingsCurrentlySaving) return Promise.resolve();
        this.settingsCurrentlySaving = true;
        
        const settings = this.getFormSettings('swaparr');
        return SniparrUtils.fetchWithTimeout('./api/settings/swaparr', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        })
        .then(r => r.json())
        .then(data => {
            if (data.success && !silent && window.SniparrNotifications) window.SniparrNotifications.showNotification('Swaparr settings auto-saved', 'success');
            this.settingsCurrentlySaving = false;
            return data;
        })
        .catch(e => {
            this.settingsCurrentlySaving = false;
            throw e;
        });
    },

    applyTimezoneChange: function(timezone) {
        console.log(`[SniparrSettings] Applying timezone change to: ${timezone}`);
        fetch('./api/settings/apply-timezone', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ timezone: timezone })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                console.log('[SniparrSettings] Timezone applied successfully');
                if (window.sniparrUI && window.sniparrUI.refreshTimeDisplays) window.sniparrUI.refreshTimeDisplays();
            } else {
                console.error('[SniparrSettings] Failed to apply timezone:', data.error);
                if (window.SniparrNotifications) window.SniparrNotifications.showNotification(`Failed to apply timezone: ${data.error}`, 'error');
            }
        })
        .catch(error => {
            console.error('[SniparrSettings] Error applying timezone:', error);
            if (window.SniparrNotifications) window.SniparrNotifications.showNotification(`Error applying timezone: ${error.message}`, 'error');
        });
    },

    applyAuthModeChange: function(authMode) {
        console.log(`[SniparrSettings] Authentication mode changed to: ${authMode}`);
    },

    applyUpdateCheckingChange: function(enabled) {
        console.log(`[SniparrSettings] Update checking ${enabled ? 'enabled' : 'disabled'}`);
    },

    applyShowTrendingChange: function(enabled) {
        console.log(`[SniparrSettings] Show Discover Content ${enabled ? 'enabled' : 'disabled'}`);
    }
};
