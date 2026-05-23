/**
 * Navigation Module
 * Handles section switching, hash navigation, and sidebar management
 */

window.SniparrNavigation = {
    // Handle navigation clicks
    handleNavigation: function(e) {
        e.preventDefault();
        
        const target = e.currentTarget;
        const href = target.getAttribute('href');
        const isInternalLink = href && href.startsWith('#');
        
        // Check for unsaved changes before navigating
        if (window.sniparrUI && typeof window.sniparrUI.suppressUnsavedChangesCheck === 'boolean') {
            if (window.sniparrUI.suppressUnsavedChangesCheck) {
                console.log('[Navigation] Suppression flag active, allowing navigation without check');
                window.sniparrUI.suppressUnsavedChangesCheck = false;
            }
        }
        
        // Add special handling for apps section - clear global app module flags
        if (window.sniparrUI && window.sniparrUI.currentSection === 'apps' && href && !href.includes('apps')) {
            // Reset the app module flags when navigating away
            if (window._appsModuleLoaded) {
                window._appsSuppressChangeDetection = true;
                if (window.appsModule && typeof window.appsModule.settingsChanged !== 'undefined') {
                    window.appsModule.settingsChanged = false;
                }
                // Schedule ending suppression to avoid any edge case issues
                setTimeout(() => {
                    window._appsSuppressChangeDetection = false;
                }, 1000);
            }
        }

        // Proceed with navigation
        if (isInternalLink) {
            window.location.hash = href; // Change hash to trigger handleHashNavigation
        } else {
            // If it's an external link (like /user), just navigate normally
            window.location.href = href;
        }
    },
    
    handleHashNavigation: function(hash) {
        let section = (hash || '').replace(/^#+/, '').trim();
        if (section.indexOf('%23') >= 0) section = section.split('%23').pop() || section;
        if (section.indexOf('./') === 0) section = section.replace(/^\.?\/*/, '');
        if (!section) section = 'home';
        // Legacy Movie Snipe home → Media Hunt Collection
        if (section === 'movie-snipe-home') {
            section = 'media-snipe-collection';
            if (window.location.hash !== '#media-snipe-collection') {
                window.history.replaceState(null, document.title, window.location.pathname + (window.location.search || '') + '#media-snipe-collection');
            }
        }
        // TV/Movie Collection → unified Media Hunt Collection
        if (section === 'tv-snipe-collection' || section === 'movie-snipe-collection') {
            if (window.sniparrUI) window.sniparrUI._pendingMediaHuntSidebar = 'movie';
            section = 'media-snipe-collection';
            if (window.location.hash !== '#media-snipe-collection') {
                window.history.replaceState(null, document.title, window.location.pathname + (window.location.search || '') + '#media-snipe-collection');
            }
        }
        // Legacy TV Snipe home → Media Hunt Collection
        if (section === 'tv-snipe-home') {
            section = 'media-snipe-collection';
            if (window.location.hash !== '#media-snipe-collection') {
                window.history.replaceState(null, document.title, window.location.pathname + (window.location.search || '') + '#media-snipe-collection');
            }
        }
        // Calendar: canonical hash is media-snipe-calendar (movie-snipe-calendar and tv-snipe-calendar redirect)
        if (section === 'movie-snipe-calendar' || section === 'tv-snipe-calendar') {
            var mode = section === 'tv-snipe-calendar' ? 'tv' : 'movie';
            section = 'media-snipe-calendar';
            if (window.sniparrUI) window.sniparrUI._pendingMediaHuntCalendarMode = mode;
            if (window.location.hash !== '#media-snipe-calendar') {
                window.history.replaceState(null, document.title, window.location.pathname + (window.location.search || '') + '#media-snipe-calendar');
            }
        }
        if (section === 'activity') {
            section = 'activity-queue';
            if (window.location.hash !== '#activity-queue') window.location.hash = 'activity-queue';
        }
        // Legacy: logs-movie-hunt → logs-media-hunt
        if (section === 'logs-movie-hunt') {
            section = 'logs-media-hunt';
            if (window.location.hash !== '#logs-media-hunt') {
                window.history.replaceState(null, document.title, window.location.pathname + (window.location.search || '') + '#logs-media-hunt');
            }
        }
        // NZB Sniparr: canonical hashes are nzb-snipe-folders, nzb-snipe-servers, nzb-snipe-advanced
        // Legacy nzb-snipe-settings* → redirect to new hashes
        if (section === 'nzb-snipe-settings' || section === 'nzb-snipe-settings-folders') {
            section = 'nzb-snipe-folders';
            if (window.location.hash !== '#nzb-snipe-folders') {
                window.history.replaceState(null, document.title, window.location.pathname + (window.location.search || '') + '#nzb-snipe-folders');
            }
        }
        if (section === 'nzb-snipe-settings-servers') {
            section = 'nzb-snipe-servers';
            if (window.location.hash !== '#nzb-snipe-servers') {
                window.history.replaceState(null, document.title, window.location.pathname + (window.location.search || '') + '#nzb-snipe-servers');
            }
        }
        if (section === 'nzb-snipe-settings-processing' || section === 'nzb-snipe-settings-advanced') {
            section = 'nzb-snipe-advanced';
            if (window.location.hash !== '#nzb-snipe-advanced') {
                window.history.replaceState(null, document.title, window.location.pathname + (window.location.search || '') + '#nzb-snipe-advanced');
            }
        }
        // Instances moved to Collection: settings-instance-management redirects to media-snipe-instances
        if (section === 'settings-instance-management') {
            section = 'media-snipe-instances';
            if (window.location.hash !== '#media-snipe-instances') {
                window.history.replaceState(null, document.title, window.location.pathname + (window.location.search || '') + '#media-snipe-instances');
            }
        }
        // Legacy media-snipe-settings: go to Media Management so Settings sub-menu expands and shows sub-items
        if (section === 'media-snipe-settings') {
            section = 'settings-media-management';
            if (window.location.hash !== '#settings-media-management') {
                window.history.replaceState(null, document.title, window.location.pathname + (window.location.search || '') + '#settings-media-management');
            }
        }
        // Legacy: Movie Management → Media Management
        if (section === 'settings-movie-management') {
            section = 'settings-media-management';
            if (window.location.hash !== '#settings-media-management') {
                window.history.replaceState(null, document.title, window.location.pathname + (window.location.search || '') + '#settings-media-management');
            }
        }
        // Legacy: TV Snipe settings → unified Media Hunt settings (sidebar was removed)
        // NOTE: tv-snipe-activity-* are NOT redirected - they show TV Snipe Activity (Queue/History/Blocklist)
        var tvHuntToSettings = {
            'tv-snipe-settings-custom-formats': 'settings-custom-formats',
            'tv-snipe-settings-profiles': 'settings-profiles',
            'tv-snipe-settings-indexers': 'indexer-hunt',
            'tv-snipe-settings-clients': 'settings-clients',
            'tv-snipe-settings-root-folders': 'settings-root-folders',
            'settings-import-media-tv': 'settings-import-media',
            'tv-snipe-settings-sizes': 'settings-sizes',
            'tv-snipe-settings-tv-management': 'settings-media-management',
            'tv-snipe-settings-import-lists': 'settings-import-lists',
        };
        if (tvHuntToSettings[section]) {
            var target = tvHuntToSettings[section];
            section = target;
            if (window.location.hash !== '#' + target) {
                window.history.replaceState(null, document.title, window.location.pathname + (window.location.search || '') + '#' + target);
            }
        }
        // App instance editor URLs: #radarr-settings, #radarr-settings/0, #sonarr-settings, etc.
        var appSettingsMatch = section.match(/^(sonarr|radarr|lidarr|readarr|whisparr|eros|prowlarr)-settings(?:\/(\d+))?$/);
        if (appSettingsMatch) {
            var appType = appSettingsMatch[1];
            var idx = appSettingsMatch[2] != null ? parseInt(appSettingsMatch[2], 10) : null;
            if (window.SettingsForms && typeof window.SettingsForms.navigateToInstanceEditor === 'function') {
                var hasSettings = window.sniparrUI && window.sniparrUI.originalSettings && window.sniparrUI.originalSettings[appType];
                if (hasSettings) {
                    window.SettingsForms.navigateToInstanceEditor(appType, idx);
                    return;
                }
            }
            section = appType;
            window.history.replaceState(null, document.title, window.location.pathname + (window.location.search || '') + '#' + appType);
        }
        if (window.sniparrUI) {
            window.sniparrUI.switchSection(section);
        }
    },

    // switchSection is handled by sniparrUI.switchSection() in app.js.
    // This module only provides handleHashNavigation() which delegates to it.
    
    // System tab management
    switchSystemTab: function(tab) {
        // Update tab buttons
        document.querySelectorAll('#systemSection .system-tab').forEach(function(t) {
            t.classList.toggle('active', t.getAttribute('data-system-tab') === tab);
        });
        // Update tab panels
        document.querySelectorAll('#systemSection .system-tab-panel').forEach(function(p) {
            var isActive = p.getAttribute('data-system-panel') === tab;
            p.style.display = isActive ? 'block' : 'none';
            p.classList.toggle('active', isActive);
        });
    },

    setupSystemTabs: function() {
        var self = this;
        document.querySelectorAll('#systemSection .system-tab').forEach(function(tab) {
            tab.addEventListener('click', function() {
                var t = tab.getAttribute('data-system-tab');
                if (t) {
                    // Update the hash to reflect the tab
                    window.location.hash = t === 'sniparr-manager' ? 'sniparr-manager' : t;
                }
            });
        });
    },

    // ─── Sidebar management ───────────────────────────────────
    // With the unified sidebar there is only one #sidebar element.
    // The show*Sidebar() API is preserved so app.js callers don't change.
    // Each function now expands the relevant accordion group instead
    // of toggling display on separate sidebar divs.

    showMainSidebar: function() {
        // Home page — collapse all groups
        if (typeof expandSidebarGroup === 'function') {
            // Let setActiveNavItem handle it via hashchange
        }
        if (typeof setActiveNavItem === 'function') setActiveNavItem();
    },

    showAppsSidebar: function() {
        if (typeof expandSidebarGroup === 'function') expandSidebarGroup('sidebar-group-apps');
        if (typeof setActiveNavItem === 'function') setActiveNavItem();
    },

    showSettingsSidebar: function() {
        if (typeof expandSidebarGroup === 'function') expandSidebarGroup('sidebar-group-settings');
        if (typeof setActiveNavItem === 'function') setActiveNavItem();
    },

    showMovieHuntSidebar: function() {
        if (typeof expandSidebarGroup === 'function') expandSidebarGroup('sidebar-group-media-hunt');
        this.updateMovieHuntSidebarActive();
    },

    showTVHuntSidebar: function() {
        this.showMovieHuntSidebar();
    },

    updateMovieHuntSidebarActive: function() {
        if (!window.sniparrUI) return;
        const currentSection = window.sniparrUI.currentSection;
        let sectionForNav = currentSection;
        if (currentSection === 'instance-editor' && window.SettingsForms && window.SettingsForms._currentEditing) {
            const appType = window.SettingsForms._currentEditing.appType;
            if (appType === 'indexer') sectionForNav = 'indexer-hunt';
            else if (appType === 'client') sectionForNav = 'settings-clients';
        }
        const collectionSections = ['movie-snipe-home', 'movie-snipe-collection', 'media-snipe-collection', 'media-snipe-instances', 'media-snipe-calendar', 'settings-clients'];
        const activitySections = ['activity-queue', 'activity-history', 'activity-blocklist', 'activity-logs', 'logs-media-hunt', 'logs-tv-hunt', 'tv-snipe-activity-queue', 'tv-snipe-activity-history', 'tv-snipe-activity-blocklist'];
        const configSections = ['media-snipe-settings', 'movie-snipe-settings', 'settings-instance-management', 'settings-media-management', 'settings-profiles', 'settings-sizes', 'profile-editor', 'settings-custom-formats', 'settings-import-media', 'settings-import-lists', 'settings-root-folders', 'instance-editor'];
        const indexMasterSections = ['indexer-hunt', 'indexer-snipe-stats', 'indexer-snipe-history'];

        // Use hash as source of truth for sub-expansion (avoids revert when async code runs ~1s later)
        const hashSection = (window.location.hash || '').replace(/^#+/, '').split('/')[0];
        const hashForNav = hashSection && (configSections.indexOf(hashSection) !== -1 || activitySections.indexOf(hashSection) !== -1 || collectionSections.indexOf(hashSection) !== -1 || indexMasterSections.indexOf(hashSection) !== -1) ? hashSection : null;
        if (hashForNav) sectionForNav = hashForNav;

        const onActivity = activitySections.indexOf(sectionForNav) !== -1;
        const onConfig = configSections.indexOf(sectionForNav) !== -1;

        // Expand only the relevant sub (matches setActiveNavItem — avoids flicker when clicking Settings)
        const colSub = document.getElementById('movie-snipe-collection-sub');
        const actSub = document.getElementById('movie-snipe-activity-sub');
        const cfgSub = document.getElementById('media-snipe-config-sub');
        if (colSub) colSub.classList.toggle('expanded', !onActivity && !onConfig);
        if (actSub) actSub.classList.toggle('expanded', onActivity);
        if (cfgSub) cfgSub.classList.toggle('expanded', onConfig);

        // Remove ALL view modes and other sub-group expansions
        const mhBody = document.getElementById('sidebar-group-media-hunt');
        if (mhBody) {
            mhBody.classList.toggle('config-view', onConfig);
            mhBody.classList.toggle('activity-view', onActivity);
            mhBody.classList.remove('indexmaster-view');
        }

        // Highlight the active item within Media Hunt sidebar
        const items = document.querySelectorAll('#sidebar-group-media-hunt .nav-item');
        
        // Mapping for sub-pages to their main nav item for highlighting
        var navMapping = {
            'indexer-snipe-stats': 'indexer-hunt',
            'indexer-snipe-history': 'indexer-hunt'
        };

        var navTarget = navMapping[sectionForNav] || sectionForNav;

        items.forEach(item => {
            item.classList.remove('active');
            const href = item.getAttribute('href') || (item.querySelector('a') && item.querySelector('a').getAttribute('href'));
            var targetHash = (href || '').replace(/^[^#]*#/, '');
            if (targetHash && (targetHash === navTarget || targetHash === sectionForNav)) {
                item.classList.add('active');
            }
        });
    },

    updateTVHuntSidebarActive: function() {
        // TV Snipe sidebar removed; no-op
    },

    updateAppsSidebarActive: function() {
        // Active state is handled by setActiveNavItem() in the inline script
        if (typeof setActiveNavItem === 'function') setActiveNavItem();
    },

    updateSettingsSidebarActive: function() {
        if (typeof setActiveNavItem === 'function') setActiveNavItem();
    },

    setupAppsNavigation: function() {
        // Navigation is handled by hash links — no extra click listeners needed with unified sidebar
    },

    setupSettingsNavigation: function() {
        // Navigation is handled by hash links
    },

    setupMovieHuntNavigation: function() {
        // Navigation is handled by hash links
    },

    setupTVHuntNavigation: function() {
        // TV Snipe sidebar removed; no-op
    },

    setupNzbHuntNavigation: function() {
        // Navigation is handled by hash links
    },

};
