
/* === app.js === */
/**
 * Sniparr - Core Application Orchestrator
 * Main entry point for the Sniparr UI.
 * Coordinates between modular components and handles global application state.
 */


let sniparrUI = {
    // Current state
    currentSection: 'home', // Default section
    currentHistoryApp: 'all', // Default history app
    currentLogApp: 'all', // Default log app for compatibility
    autoScroll: true,
    eventSources: {}, // Event sources for compatibility
    isLoadingStats: false, // Flag to prevent multiple simultaneous stats requests
    configuredApps: {
        sonarr: false,
        radarr: false,
        lidarr: false,
        readarr: false, // Added readarr
        whisparr: false, // Added whisparr
        eros: false, // Added eros
        swaparr: false // Added swaparr
    },
    configuredAppsInitialized: false, // Track if we've loaded app states at least once
    originalSettings: {}, // Store the full original settings object
    settingsChanged: false, // Legacy flag (auto-save enabled)
    
    // Logo URL
    logoUrl: "./static/logo/sniparr.svg",
    
    // Element references
    elements: {},
    
    // Initialize the application
    init: function() {
        console.log('[sniparrUI] Initializing UI...');
        
        // Expose sniparrUI to global scope early for modules that need it during loading
        window.sniparrUI = this;
        
        // Skip initialization on login page
        const isLoginPage = document.querySelector('.login-container, #loginForm, .login-form');
        if (isLoginPage) {
            console.log('[sniparrUI] Login page detected, skipping full initialization');
            return;
        }
        
        // Cache frequently used DOM elements
        this.cacheElements();

        this._enableThirdPartyApps = true;
        fetch('./api/settings')
            .then(r => r.json())
            .then(all => {
                var generalSettings = (all && all.general) || {};
                this._enableThirdPartyApps = generalSettings.enable_third_party_apps !== false;
                // Update sidebar group visibility from database settings (nav-group-* IDs)
                var appsGroup = document.getElementById('nav-group-apps');
                var appsLabel = document.getElementById('nav-group-apps-label');
                if (appsGroup) appsGroup.style.display = (generalSettings.enable_third_party_apps === false) ? 'none' : '';
                if (appsLabel) appsLabel.style.display = (generalSettings.enable_third_party_apps === false) ? 'none' : '';
                if (typeof window.applyFeatureFlags === 'function') window.applyFeatureFlags();
                
                // Initialize originalSettings early
                this.originalSettings = all || {};
                this.originalSettings.general = all.general || { ui_preferences: {} };
                if (!this.originalSettings.general.ui_preferences) this.originalSettings.general.ui_preferences = {};
                
                // NOW initialize UI preferences that depend on settings
                if (window.SniparrTheme) {
                    window.SniparrTheme.initDarkMode();
                }
                this.logoUrl = SniparrUtils.getUIPreference('logo-url', this.logoUrl);
                if (typeof window.applyLogoToAllElements === 'function') {
                    window.applyLogoToAllElements();
                }

                // Settings are now loaded — re-initialize view toggle with correct preference
                if (window.SniparrStats && (this.currentSection === 'home' || !this.currentSection)) {
                    window.SniparrStats.initViewToggle();
                    window.SniparrStats.loadMediaStats(true);
                }
                if ((this.currentSection === 'home' || !this.currentSection) && window.SniparrIndexerHuntHome && typeof window.SniparrIndexerHuntHome.load === 'function') {
                    window.SniparrIndexerHuntHome.load();
                }

                // Settings are loaded — now safe to check welcome preference
                if (this.currentSection === 'home' || !this.currentSection) {
                    this._maybeShowWelcome();
                }
            })
            .catch(() => {});
        
        // Register event handlers
        this.setupEventListeners();
        this.setupLogoHandling();
        // Auto-save enabled - no unsaved changes handler needed
        
        // NOTE: loadMediaStats() + initViewToggle() + startPolling() are called
        // by switchSection('home') via handleHashNavigation below — no need to duplicate here.
        
        // Check if we need to navigate to a specific section after refresh
        const targetSection = localStorage.getItem('sniparr-target-section');
        if (targetSection) {
            console.log(`[sniparrUI] Found target section after refresh: ${targetSection}`);
            localStorage.removeItem('sniparr-target-section');
            // Keep URL in sync so hash-based logic and back button work (replaceState avoids firing hashchange)
            if (window.location.hash !== '#' + targetSection) {
                window.history.replaceState(null, document.title, window.location.pathname + (window.location.search || '') + '#' + targetSection);
            }
            // Navigate to the target section
            this.switchSection(targetSection);
        } else {
            // Initial navigation based on hash
            this.handleHashNavigation(window.location.hash);
        }
        
        // Remove initial sidebar hiding style
        const initialSidebarStyle = document.getElementById('initial-sidebar-state');
        if (initialSidebarStyle) {
            initialSidebarStyle.remove();
        }
        
        // Check which sidebar should be shown based on current section
        console.log(`[sniparrUI] Initialization - current section: ${this.currentSection}`);
        if (this.currentSection === 'settings' || this.currentSection === 'scheduling' || this.currentSection === 'notifications' || this.currentSection === 'backup-restore' || this.currentSection === 'user' || this.currentSection === 'settings-logs') {
            console.log('[sniparrUI] Initialization - showing settings group');
            this.showSettingsSidebar();
        } else if (this.currentSection === 'system' || this.currentSection === 'sniparr-manager' || this.currentSection === 'logs') {
            console.log('[sniparrUI] Initialization - showing system group');
            this.showMainSidebar();
        } else if (this.currentSection === 'indexer-hunt' || this.currentSection === 'indexer-snipe-stats' || this.currentSection === 'indexer-snipe-history') {
            console.log('[sniparrUI] Initialization - showing main sidebar for Indexer Snipe');
            this.showMainSidebar();
        } else if (this.currentSection === 'apps' || this.currentSection === 'sonarr' || this.currentSection === 'radarr' || this.currentSection === 'lidarr' || this.currentSection === 'readarr' || this.currentSection === 'whisparr' || this.currentSection === 'eros' || this.currentSection === 'prowlarr' || this.currentSection === 'swaparr') {
            console.log('[sniparrUI] Initialization - showing apps sidebar');
            this.showAppsSidebar();
        } else {
            // Default: show main sidebar (Home)
            console.log('[sniparrUI] Initialization - showing main sidebar (default)');
            this.showMainSidebar();
        }
        
        // Auto-save enabled - no unsaved changes handler needed
        
        // Load username
        this.loadUsername();
        
        // Preload stateful management info so it's ready when needed
        this.loadStatefulInfo();
        
        // Load current version
        this.loadCurrentVersion();
        // Load latest version from GitHub
        this.loadLatestVersion();
        // Load latest beta version from GitHub
        this.loadBetaVersion();
        // Load GitHub star count
        this.loadGitHubStarCount();
        
        // Initialize instance event handlers
        this.setupInstanceEventHandlers();
        
        // Setup navigation for sidebars
        this.setupAppsNavigation();
        this.setupSettingsNavigation();
        this.setupSystemNavigation();
        
        // Auto-save enabled - no unsaved changes handler needed
        
        // Setup Swaparr components
        this.setupSwaparrResetCycle();
        
        // Setup Swaparr status polling (refresh every 30 seconds)
        this.setupSwaparrStatusPolling();
        
        // Setup Prowlarr status polling (refresh every 30 seconds)
        this.setupProwlarrStatusPolling();
        
        // Setup Indexer Hunt home card (shows if indexers configured)
        this.setupIndexerHuntHome();
        
        // Make dashboard visible after initialization to prevent FOUC
        setTimeout(() => {
            this.showDashboard();
            // Mark as initialized after everything is set up to enable refresh on section changes
            this.isInitialized = true;
            console.log('[sniparrUI] Initialization complete - refresh on section change enabled');
        }, 50); // Reduced from implicit longer delay
    },

    // Cache DOM elements for better performance
    cacheElements: function() {
        if (window.SniparrDOM) {
            window.SniparrDOM.cacheElements(this);
        }
    },
    
    // Set up event listeners
    setupEventListeners: function() {
        // Navigation
        document.addEventListener('click', (e) => {
            // Sidebar: hash links use client-side navigation
            const sidebarNavItem = e.target.closest('#sidebar .nav-item');
            if (sidebarNavItem) {
                const link = sidebarNavItem.tagName === 'A' ? sidebarNavItem : sidebarNavItem.querySelector('a');
                const href = link && link.getAttribute('href');
                if (href && href.indexOf('#') >= 0) {
                    e.preventDefault();
                    const hash = href.substring(href.indexOf('#'));
                    const normalizedHash = (hash || '').replace(/^#+/, '');
                    if (window.location.hash !== hash) {
                        window.location.hash = hash;
                    } else if (normalizedHash === 'media-snipe-collection' && window.TVHuntCollection && typeof window.TVHuntCollection.showMainView === 'function') {
                        window.TVHuntCollection.showMainView();
                    }
                    if (typeof setActiveNavItem === 'function') setActiveNavItem();
                    return;
                }
            }

            // Navigation link handling (other nav areas)
            if (e.target.matches('.nav-link') || e.target.closest('.nav-link')) {
                const link = e.target.matches('.nav-link') ? e.target : e.target.closest('.nav-link');
                e.preventDefault();
                this.handleNavigation(e);
            }
            
            // Handle cycle reset button clicks
            if (e.target.matches('.cycle-reset-button') || e.target.closest('.cycle-reset-button')) {
                const button = e.target.matches('.cycle-reset-button') ? e.target : e.target.closest('.cycle-reset-button');
                const app = button.dataset.app;
                if (app) {
                    this.resetAppCycle(app, button);
                }
            }
        });
        
        // History dropdown toggle
        if (this.elements.historyDropdownBtn) {
            this.elements.historyDropdownBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation(); // Prevent event bubbling
                
                // Toggle this dropdown
                this.elements.historyDropdownContent.classList.toggle('show');
            });
            
            // Close dropdown when clicking outside
            document.addEventListener('click', (e) => {
                if (!e.target.closest('.history-dropdown') && this.elements.historyDropdownContent.classList.contains('show')) {
                    this.elements.historyDropdownContent.classList.remove('show');
                }
            });
        }
        
        // History options
        this.elements.historyOptions.forEach(option => {
            option.addEventListener('click', (e) => this.handleHistoryOptionChange(e));
        });
        
        // Settings dropdown toggle
        if (this.elements.settingsDropdownBtn) {
            this.elements.settingsDropdownBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation(); // Prevent event bubbling
                
                // Toggle this dropdown
                this.elements.settingsDropdownContent.classList.toggle('show');
            });
            
            // Close dropdown when clicking outside
            document.addEventListener('click', (e) => {
                if (!e.target.closest('.settings-dropdown') && this.elements.settingsDropdownContent.classList.contains('show')) {
                    this.elements.settingsDropdownContent.classList.remove('show');
                }
            });
        }
        
        // Settings options
        this.elements.settingsOptions.forEach(option => {
            option.addEventListener('click', (e) => this.handleSettingsOptionChange(e));
        });
        
        // Save settings button
        // Save button removed for auto-save
        
        // Test notification button (delegated event listener for dynamic content)
        document.addEventListener('click', (e) => {
            if (e.target.id === 'testNotificationBtn' || e.target.closest('#testNotificationBtn')) {
                this.testNotification();
            }
        });
        
        // Start hunt button
        if (this.elements.startHuntButton) {
            this.elements.startHuntButton.addEventListener('click', () => this.startHunt());
        }
        
        // Stop hunt button
        if (this.elements.stopHuntButton) {
            this.elements.stopHuntButton.addEventListener('click', () => this.stopHunt());
        }
        
        // Logout button
        if (this.elements.logoutLink) {
            this.elements.logoutLink.addEventListener('click', (e) => this.logout(e));
        }
        
        // Dark mode toggle
        const darkModeToggle = document.getElementById('darkModeToggle');
        if (darkModeToggle) {
            const prefersDarkMode = localStorage.getItem('sniparr-dark-mode') === 'true';
            darkModeToggle.checked = prefersDarkMode;
            
            darkModeToggle.addEventListener('change', function() {
                const isDarkMode = this.checked;
                document.body.classList.toggle('dark-theme', isDarkMode);
                localStorage.setItem('sniparr-dark-mode', isDarkMode);
            });
        }
        
        // Settings now use manual save - no auto-save setup
        console.log('[sniparrUI] Settings using manual save - skipping auto-save setup');
        
        // Auto-save enabled - no need to warn about unsaved changes
        
        // Stateful management reset button
        const resetStatefulBtn = document.getElementById('reset_stateful_btn');
        if (resetStatefulBtn) {
            resetStatefulBtn.addEventListener('click', () => this.resetStatefulManagement());
        }
        
        // Stateful management hours input
        const statefulHoursInput = document.getElementById('stateful_management_hours');
        if (statefulHoursInput) {
            statefulHoursInput.addEventListener('change', () => {
                this.updateStatefulExpirationOnUI();
            });
        }
        
        // Handle window hash change
        window.addEventListener('hashchange', (e) => {
            // Check for unsaved changes before navigation
            if (window._hasUnsavedChanges) {
                var newHash = new URL(e.newURL).hash;
                // Revert navigation immediately
                history.pushState(null, null, e.oldURL);

                if (window.SniparrConfirm && window.SniparrConfirm.show) {
                    window.SniparrConfirm.show({
                        title: 'Unsaved Changes',
                        message: 'You have unsaved changes that will be lost if you leave.',
                        confirmLabel: 'Go Back',
                        cancelLabel: 'Leave',
                        onConfirm: () => {
                            // Stay — navigation already reverted above, modal closes
                        },
                        onCancel: () => {
                            window._hasUnsavedChanges = false;
                            window.location.hash = newHash;
                        }
                    });
                } else {
                    if (!confirm('You have unsaved changes that will be lost. Leave anyway?')) {
                        return;
                    }
                    window._hasUnsavedChanges = false;
                    window.location.hash = newHash;
                }
                return;
            }
            this.handleHashNavigation(window.location.hash);
        });

        // Handle page unload/refresh
        window.addEventListener('beforeunload', (e) => {
            if (window._hasUnsavedChanges) {
                e.preventDefault();
                e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
                return e.returnValue;
            }
        });

        // Settings form delegation - now triggers auto-save
        const settingsFormContainer = document.querySelector('#settingsSection');
        if (settingsFormContainer) {
            // Settings now use manual save - remove auto-save event listeners
            console.log('[sniparrUI] Settings section using manual save - no auto-save listeners');
        }

        // Auto-save enabled - no need for beforeunload warnings

        // NOTE: Initial hash navigation is handled in init() after setupEventListeners() returns.
        // Do NOT call handleHashNavigation here to avoid double-navigation on page load.

        // HISTORY: Listen for change on #historyAppSelect
        const historyAppSelect = document.getElementById('historyAppSelect');
        if (historyAppSelect) {
            historyAppSelect.addEventListener('change', (e) => {
                const app = e.target.value;
                this.handleHistoryOptionChange(app);
            });
        }

        // Reset stats button
        const resetButton = document.getElementById('reset-stats');
        if (resetButton) {
            resetButton.addEventListener('click', (e) => {
                e.preventDefault();
                this.resetMediaStats();
            });
        }
    },
    
    // Setup logo handling to prevent flashing during navigation
    setupLogoHandling: function() {
        if (window.SniparrTheme) {
            window.SniparrTheme.setupLogoHandling();
        }
    },
    
    // Navigation handling
    handleNavigation: function(e) {
        if (window.SniparrNavigation) {
            window.SniparrNavigation.handleNavigation(e);
        }
    },
    
    handleHashNavigation: function(hash) {
        if (window.SniparrNavigation) {
            window.SniparrNavigation.handleHashNavigation(hash);
        }
    },
    
    switchSection: function(section) {
        console.log(`[sniparrUI] *** SWITCH SECTION CALLED *** section: ${section}, current: ${this.currentSection}`);

        // Feature flag guards: redirect to home if section is disabled
        var thirdPartyAppSections = ['sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros', 'prowlarr', 'swaparr'];
        if (this._enableThirdPartyApps === false && thirdPartyAppSections.indexOf(section) !== -1) {
            console.log('[sniparrUI] 3rd Party Apps disabled - redirecting to home');
            this.switchSection('home'); return;
        }

        // Check for unsaved changes before allowing navigation
        if (this.isInitialized && this.currentSection && this.currentSection !== section) {
            // Check for unsaved Swaparr changes if leaving Swaparr section
            if (this.currentSection === 'swaparr' && window.SettingsForms && typeof window.SettingsForms.checkUnsavedChanges === 'function') {
                if (!window.SettingsForms.checkUnsavedChanges()) {
                    console.log(`[sniparrUI] Navigation cancelled due to unsaved Swaparr changes`);
                    return; // User chose to stay and save changes
                }
            }
            
            // Check for unsaved Settings changes if leaving Settings section
            if (this.currentSection === 'settings' && window.SettingsForms && typeof window.SettingsForms.checkUnsavedChanges === 'function') {
                if (!window.SettingsForms.checkUnsavedChanges()) {
                    console.log(`[sniparrUI] Navigation cancelled due to unsaved Settings changes`);
                    return; // User chose to stay and save changes
                }
            }
            
            // Check for unsaved Notifications changes if leaving Notifications section
            if (this.currentSection === 'notifications' && window.SettingsForms && typeof window.SettingsForms.checkUnsavedChanges === 'function') {
                if (!window.SettingsForms.checkUnsavedChanges()) {
                    console.log(`[sniparrUI] Navigation cancelled due to unsaved Notifications changes`);
                    return; // User chose to stay and save changes
                }
            }
            
            // Check for unsaved App instance changes if leaving Apps section
            const appSections = ['apps'];
            if (appSections.includes(this.currentSection) && window.SettingsForms && typeof window.SettingsForms.checkUnsavedChanges === 'function') {
                if (!window.SettingsForms.checkUnsavedChanges()) {
                    console.log(`[sniparrUI] Navigation cancelled due to unsaved App changes`);
                    return; // User chose to stay and save changes
                }
            }
            
            // Check for unsaved Prowlarr changes if leaving Prowlarr section
            if (this.currentSection === 'prowlarr' && window.SettingsForms && typeof window.SettingsForms.checkUnsavedChanges === 'function') {
                if (!window.SettingsForms.checkUnsavedChanges()) {
                    console.log(`[sniparrUI] Navigation cancelled due to unsaved Prowlarr changes`);
                    return; // User chose to stay and save changes
                }
            }
            
            // Check for unsaved Profile Editor changes if leaving Profile Editor
            if (this.currentSection === 'profile-editor' && section !== 'profile-editor' && window.SettingsForms && typeof window.SettingsForms.isProfileEditorDirty === 'function' && window.SettingsForms.isProfileEditorDirty()) {
                window.SettingsForms.confirmLeaveProfileEditor(function(result) {
                    if (result === 'save') {
                        window.SettingsForms.saveProfileFromEditor(section);
                    } else if (result === 'discard') {
                        window.SettingsForms.cancelProfileEditor(section);
                    }
                });
                return;
            }

            // Check for unsaved Movie Management changes if leaving Movie Management
            if (this.currentSection === 'settings-media-management' && section !== 'settings-media-management' && window.MovieManagement && typeof window.MovieManagement.isDirty === 'function' && window.MovieManagement.isDirty()) {
                window.MovieManagement.confirmLeave(function(result) {
                    if (result === 'save') {
                        window.MovieManagement.save(section);
                    } else if (result === 'discard') {
                        window.MovieManagement.cancel(section);
                    }
                });
                return;
            }

            // Check for unsaved Instance Editor changes if leaving Instance Editor
            if (this.currentSection === 'instance-editor' && section !== 'instance-editor' && window.SettingsForms && typeof window.SettingsForms.confirmLeaveInstanceEditor === 'function' && typeof window.SettingsForms.isInstanceEditorDirty === 'function' && window.SettingsForms.isInstanceEditorDirty()) {
                window.SettingsForms.confirmLeaveInstanceEditor((result) => {
                    if (result === 'save') {
                        // true means navigate back after save
                        window.SettingsForms._instanceEditorNextSection = section;
                        window.SettingsForms.saveInstanceFromEditor(true); 
                    } else if (result === 'discard') {
                        window.SettingsForms.cancelInstanceEditor(section);
                    }
                });
                return;
            }

            // Don't refresh page when navigating to/from instance editor or between app sections
            const noRefreshSections = ['home', 'instance-editor', 'profile-editor', 'sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros', 'prowlarr', 'swaparr', 'system', 'sniparr-manager', 'logs', 'about', 'settings', 'scheduling', 'notifications', 'backup-restore', 'settings-logs', 'user', 'indexer-hunt', 'indexer-snipe-stats', 'indexer-snipe-history'];
            const skipRefresh = noRefreshSections.includes(section) || noRefreshSections.includes(this.currentSection);
            
            if (!skipRefresh) {
                console.log(`[sniparrUI] User switching from ${this.currentSection} to ${section}, refreshing page...`);
                // Store the target section in localStorage so we can navigate to it after refresh
                localStorage.setItem('sniparr-target-section', section);
                location.reload();
                return;
            } else {
                console.log(`[sniparrUI] Switching from ${this.currentSection} to ${section} without page refresh (app/editor navigation)`);
            }
        }
        
        // Stop stats polling when leaving home section
        if (window.SniparrStats) window.SniparrStats.stopPolling();

        // Clean up cycle countdown when leaving home (stops timer intervals and API polling)
        if (this.currentSection === 'home' && window.CycleCountdown && typeof window.CycleCountdown.cleanup === 'function') {
            window.CycleCountdown.cleanup();
        }

        // Update active section
        this.elements.sections.forEach(s => {
            s.classList.remove('active');
            s.style.display = 'none';
        });
        
        // Additionally, make sure scheduling section is completely hidden
        if (section !== 'scheduling' && this.elements.schedulingSection) {
            this.elements.schedulingSection.style.display = 'none';
        }
        
        // Update navigation
        this.elements.navItems.forEach(item => {
            item.classList.remove('active');
        });
        
        // Show selected section
        let newTitle = 'Home'; // Default title
        const sponsorsSection = document.getElementById('sponsorsSection'); // Get sponsors section element
        const sponsorsNav = document.getElementById('sponsorsNav'); // Get sponsors nav element

        if (section === 'home' && this.elements.homeSection) {
            this.elements.homeSection.classList.add('active');
            this.elements.homeSection.style.display = 'block';
            if (this.elements.homeNav) this.elements.homeNav.classList.add('active');
            newTitle = 'Home';
            this.currentSection = 'home';
            
            // Show main sidebar when returning to home
            this.showMainSidebar();
            
            // Disconnect logs if switching away from logs
            this.disconnectAllEventSources(); 
            
            // Check app connections when returning to home page to update status
            // This will call updateEmptyStateVisibility() after all checks complete
            this.checkAppConnections();
            // Load Swaparr status
            this.loadSwaparrStatus();
            // Refresh stats when returning to home section
            this.loadMediaStats();
            // Initialize view toggle and start live polling
            if (window.SniparrStats) {
                window.SniparrStats.initViewToggle();
                window.SniparrStats.startPolling();
            }
            // Re-initialize cycle countdown when returning to home (cleanup stops it when leaving)
            if (window.CycleCountdown && typeof window.CycleCountdown.initialize === 'function') {
                window.CycleCountdown.initialize();
            }
            // Show welcome message on first visit (not during setup wizard)
            this._maybeShowWelcome();
        } else if (section === 'about') {
            // About removed — redirect to home
            this.switchSection('home'); return;
        } else if ((section === 'system' || section === 'sniparr-manager' || section === 'logs') && document.getElementById('systemSection')) {
            // System section with sidebar sub-navigation (Sniparr Manager, Logs)
            var systemSection = document.getElementById('systemSection');
            systemSection.classList.add('active');
            systemSection.style.display = 'block';
            
            // Determine which tab to show
            var activeTab = section === 'system' ? 'sniparr-manager' : section;
            if (window.SniparrNavigation) window.SniparrNavigation.switchSystemTab(activeTab);
            
            // Set title based on active tab
            var tabTitles = { 'sniparr-manager': 'Sniparr Manager', 'logs': 'Logs' };
            newTitle = tabTitles[activeTab] || 'System';
            this.currentSection = section === 'system' ? 'sniparr-manager' : section;
            
            // Expand System group in unified sidebar
            if (typeof expandSidebarGroup === 'function') expandSidebarGroup('sidebar-group-system');
            if (typeof setActiveNavItem === 'function') setActiveNavItem();
            
            // Initialize the active tab's module
            if (activeTab === 'sniparr-manager') {
                if (typeof huntManagerModule !== 'undefined') huntManagerModule.refresh();
            } else if (activeTab === 'logs') {
                var wrapperLogs = document.getElementById('logs-media-snipe-content-wrapper');
                if (wrapperLogs) wrapperLogs.style.display = '';
                if (window.LogsModule && typeof window.LogsModule.setAppFilterContext === 'function') {
                    window.LogsModule.setAppFilterContext('system');
                }
                if (window.LogsModule && typeof window.LogsModule.updateDebugLevelVisibility === 'function') {
                    window.LogsModule.updateDebugLevelVisibility();
                }
                if (window.LogsModule) {
                    try {
                        if (window.LogsModule.initialized) { window.LogsModule.connectToLogs(); }
                        else { window.LogsModule.init(); }
                    } catch (error) { console.error('[sniparrUI] Error during LogsModule calls:', error); }
                }
            }
        // ── Indexer Hunt sections ──────────────────────────────────────
        } else if (section === 'indexer-hunt' && document.getElementById('indexer-snipe-section')) {
            document.getElementById('indexer-snipe-section').classList.add('active');
            document.getElementById('indexer-snipe-section').style.display = 'block';
            newTitle = 'Indexer Manager';
            this.currentSection = 'indexer-hunt';
            this.showMainSidebar();
            if (window.IndexerHunt && typeof window.IndexerHunt.init === 'function') {
                window.IndexerHunt.init();
            }
            if (window.SettingsForms && typeof window.SettingsForms.initOrRefreshIndexers === 'function') {
                window.SettingsForms.initOrRefreshIndexers();
            }
        } else if (section === 'indexer-snipe-stats' && document.getElementById('indexer-snipe-stats-section')) {
            document.getElementById('indexer-snipe-stats-section').classList.add('active');
            document.getElementById('indexer-snipe-stats-section').style.display = 'block';
            newTitle = 'Indexer Manager – Stats';
            this.currentSection = 'indexer-snipe-stats';
            this.showMainSidebar();
            if (window.IndexerHuntStats && typeof window.IndexerHuntStats.init === 'function') {
                window.IndexerHuntStats.init();
            }
        } else if (section === 'indexer-snipe-history' && document.getElementById('indexer-snipe-history-section')) {
            document.getElementById('indexer-snipe-history-section').classList.add('active');
            document.getElementById('indexer-snipe-history-section').style.display = 'block';
            newTitle = 'Indexer Manager – History';
            this.currentSection = 'indexer-snipe-history';
            this.showMainSidebar();
            if (window.IndexerHuntHistory && typeof window.IndexerHuntHistory.init === 'function') {
                window.IndexerHuntHistory.init();
            }
        } else if (section === 'media-snipe-collection' && document.getElementById('mediaHuntSection')) {
            if (document.getElementById('tvHuntActivitySection')) {
                document.getElementById('tvHuntActivitySection').classList.remove('active');
                document.getElementById('tvHuntActivitySection').style.display = 'none';
            }
            if (document.getElementById('activitySection')) {
                document.getElementById('activitySection').classList.remove('active');
                document.getElementById('activitySection').style.display = 'none';
            }
            document.getElementById('mediaHuntSection').classList.add('active');
            document.getElementById('mediaHuntSection').style.display = 'block';
            ['mediaHuntInstanceManagementSection', 'mediaHuntInstanceEditorSection', 'tvHuntSettingsCustomFormatsSection', 'mediaHuntProfilesSection', 'tvHuntSettingsIndexersSection', 'tvHuntSettingsClientsSection', 'tvHuntSettingsRootFoldersSection', 'mediaHuntSettingsImportMediaSection', 'tvHuntSettingsTVManagementSection', 'tvManagementSection', 'tvHuntSettingsImportListsSection'].forEach(function(id) {
                var el = document.getElementById(id);
                if (el) { el.classList.remove('active'); el.style.display = 'none'; }
            });
            if (document.getElementById('mediaHuntCalendarSection')) {
                document.getElementById('mediaHuntCalendarSection').classList.remove('active');
                document.getElementById('mediaHuntCalendarSection').style.display = 'none';
            }
            var collectionView = document.getElementById('media-snipe-collection-view');
            var wizardView = document.getElementById('media-snipe-setup-wizard-view');
            if (collectionView) collectionView.style.display = 'none';
            if (wizardView) wizardView.style.display = 'none';
            newTitle = 'Media Hunt';
            this.currentSection = 'media-snipe-collection';
            if (this._pendingMediaHuntSidebar === 'tv') { this.showTVHuntSidebar(); }
            else if (this._pendingMediaHuntSidebar === 'movie') { this.showMovieHuntSidebar(); }
            else { this.showMovieHuntSidebar(); }
            this._pendingMediaHuntSidebar = undefined;
            if (typeof setActiveNavItem === 'function') setActiveNavItem();

            // ── Setup Wizard gate — show wizard if setup is incomplete ──
            var _hash = window.location.hash || '';
            if (window.SetupWizard && typeof window.SetupWizard.check === 'function') {
                window.SetupWizard.check(function(needsWizard) {
                    if (needsWizard) {
                        window.SetupWizard.show();
                    } else {
                        if (wizardView) wizardView.style.display = 'none';
                        if (collectionView) collectionView.style.display = 'block';
                        if (!/\/tv\/\d+$/.test(_hash)) {
                            if (window.TVHuntCollection && typeof window.TVHuntCollection.showMainView === 'function') {
                                window.TVHuntCollection.showMainView();
                            }
                        }
                        if (window.MediaHuntCollection && typeof window.MediaHuntCollection.init === 'function') {
                            window.MediaHuntCollection.init();
                        }
                    }
                });
            } else {
                // Fallback if SetupWizard not loaded
                if (collectionView) collectionView.style.display = 'block';
                if (window.MediaHuntCollection && typeof window.MediaHuntCollection.init === 'function') {
                    window.MediaHuntCollection.init();
                }
            }
        } else if ((section === 'media-snipe-settings' || section === 'media-snipe-instances') && document.getElementById('mediaHuntInstanceManagementSection')) {
            if (document.getElementById('tvHuntActivitySection')) {
                document.getElementById('tvHuntActivitySection').classList.remove('active');
                document.getElementById('tvHuntActivitySection').style.display = 'none';
            }
            if (document.getElementById('media-snipe-settings-default-section')) {
                document.getElementById('media-snipe-settings-default-section').classList.remove('active');
                document.getElementById('media-snipe-settings-default-section').style.display = 'none';
            }
            document.getElementById('mediaHuntInstanceManagementSection').classList.add('active');
            document.getElementById('mediaHuntInstanceManagementSection').style.display = 'block';
            if (document.getElementById('mediaHuntInstanceEditorSection')) { document.getElementById('mediaHuntInstanceEditorSection').classList.remove('active'); document.getElementById('mediaHuntInstanceEditorSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsCustomFormatsSection')) { document.getElementById('tvHuntSettingsCustomFormatsSection').classList.remove('active'); document.getElementById('tvHuntSettingsCustomFormatsSection').style.display = 'none'; }
            if (document.getElementById('mediaHuntProfilesSection')) { document.getElementById('mediaHuntProfilesSection').classList.remove('active'); document.getElementById('mediaHuntProfilesSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsIndexersSection')) { document.getElementById('tvHuntSettingsIndexersSection').classList.remove('active'); document.getElementById('tvHuntSettingsIndexersSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsClientsSection')) { document.getElementById('tvHuntSettingsClientsSection').classList.remove('active'); document.getElementById('tvHuntSettingsClientsSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsRootFoldersSection')) { document.getElementById('tvHuntSettingsRootFoldersSection').classList.remove('active'); document.getElementById('tvHuntSettingsRootFoldersSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsTVManagementSection')) { document.getElementById('tvHuntSettingsTVManagementSection').classList.remove('active'); document.getElementById('tvHuntSettingsTVManagementSection').style.display = 'none'; }
            if (document.getElementById('tvManagementSection')) { document.getElementById('tvManagementSection').classList.remove('active'); document.getElementById('tvManagementSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsImportListsSection')) { document.getElementById('tvHuntSettingsImportListsSection').classList.remove('active'); document.getElementById('tvHuntSettingsImportListsSection').style.display = 'none'; }
            if (document.getElementById('mediaHuntSection')) { document.getElementById('mediaHuntSection').classList.remove('active'); document.getElementById('mediaHuntSection').style.display = 'none'; }
            if (document.getElementById('mediaHuntCalendarSection')) { document.getElementById('mediaHuntCalendarSection').classList.remove('active'); document.getElementById('mediaHuntCalendarSection').style.display = 'none'; }
            newTitle = section === 'media-snipe-instances' ? 'Instances' : 'Media Hunt Settings';
            this.currentSection = section;
            this.showMovieHuntSidebar();
            this._pendingMediaHuntSidebar = undefined;
            if (typeof setActiveNavItem === 'function') setActiveNavItem();
            if (window.MediaHuntInstanceManagement && typeof window.MediaHuntInstanceManagement.init === 'function') {
                window.MediaHuntInstanceManagement.init();
            }
        } else if (section === 'tv-snipe-settings-custom-formats' && document.getElementById('settingsCustomFormatsSection')) {
            if (document.getElementById('tvHuntActivitySection')) { document.getElementById('tvHuntActivitySection').classList.remove('active'); document.getElementById('tvHuntActivitySection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsCustomFormatsSection')) { document.getElementById('tvHuntSettingsCustomFormatsSection').classList.remove('active'); document.getElementById('tvHuntSettingsCustomFormatsSection').style.display = 'none'; }
            document.getElementById('settingsCustomFormatsSection').classList.add('active');
            document.getElementById('settingsCustomFormatsSection').style.display = 'block';
            if (document.getElementById('tvHuntSettingsCustomFormatsNav')) document.getElementById('tvHuntSettingsCustomFormatsNav').classList.add('active');
            if (document.getElementById('mediaHuntInstanceManagementSection')) { document.getElementById('mediaHuntInstanceManagementSection').classList.remove('active'); document.getElementById('mediaHuntInstanceManagementSection').style.display = 'none'; }
            if (document.getElementById('mediaHuntInstanceEditorSection')) { document.getElementById('mediaHuntInstanceEditorSection').classList.remove('active'); document.getElementById('mediaHuntInstanceEditorSection').style.display = 'none'; }
            if (document.getElementById('mediaHuntProfilesSection')) { document.getElementById('mediaHuntProfilesSection').classList.remove('active'); document.getElementById('mediaHuntProfilesSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsIndexersSection')) { document.getElementById('tvHuntSettingsIndexersSection').classList.remove('active'); document.getElementById('tvHuntSettingsIndexersSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsClientsSection')) { document.getElementById('tvHuntSettingsClientsSection').classList.remove('active'); document.getElementById('tvHuntSettingsClientsSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsRootFoldersSection')) { document.getElementById('tvHuntSettingsRootFoldersSection').classList.remove('active'); document.getElementById('tvHuntSettingsRootFoldersSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsTVManagementSection')) { document.getElementById('tvHuntSettingsTVManagementSection').classList.remove('active'); document.getElementById('tvHuntSettingsTVManagementSection').style.display = 'none'; }
            if (document.getElementById('tvManagementSection')) { document.getElementById('tvManagementSection').classList.remove('active'); document.getElementById('tvManagementSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsImportListsSection')) { document.getElementById('tvHuntSettingsImportListsSection').classList.remove('active'); document.getElementById('tvHuntSettingsImportListsSection').style.display = 'none'; }
            if (document.getElementById('mediaHuntSection')) { document.getElementById('mediaHuntSection').classList.remove('active'); document.getElementById('mediaHuntSection').style.display = 'none'; }
            if (document.getElementById('mediaHuntCalendarSection')) { document.getElementById('mediaHuntCalendarSection').classList.remove('active'); document.getElementById('mediaHuntCalendarSection').style.display = 'none'; }
            newTitle = 'Custom Formats';
            this.currentSection = 'tv-snipe-settings-custom-formats';
            this.showTVHuntSidebar();
            if (window.CustomFormats && typeof window.CustomFormats.initOrRefresh === 'function') {
                window.CustomFormats.initOrRefresh('tv');
            }
        } else if (section === 'tv-snipe-settings-profiles' && document.getElementById('mediaHuntProfilesSection')) {
            if (document.getElementById('tvHuntActivitySection')) { document.getElementById('tvHuntActivitySection').classList.remove('active'); document.getElementById('tvHuntActivitySection').style.display = 'none'; }
            document.getElementById('mediaHuntProfilesSection').classList.add('active');
            document.getElementById('mediaHuntProfilesSection').style.display = 'block';
            if (document.getElementById('tvHuntSettingsProfilesNav')) document.getElementById('tvHuntSettingsProfilesNav').classList.add('active');
            if (document.getElementById('mediaHuntInstanceManagementSection')) { document.getElementById('mediaHuntInstanceManagementSection').classList.remove('active'); document.getElementById('mediaHuntInstanceManagementSection').style.display = 'none'; }
            if (document.getElementById('mediaHuntInstanceEditorSection')) { document.getElementById('mediaHuntInstanceEditorSection').classList.remove('active'); document.getElementById('mediaHuntInstanceEditorSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsCustomFormatsSection')) { document.getElementById('tvHuntSettingsCustomFormatsSection').classList.remove('active'); document.getElementById('tvHuntSettingsCustomFormatsSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsIndexersSection')) { document.getElementById('tvHuntSettingsIndexersSection').classList.remove('active'); document.getElementById('tvHuntSettingsIndexersSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsClientsSection')) { document.getElementById('tvHuntSettingsClientsSection').classList.remove('active'); document.getElementById('tvHuntSettingsClientsSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsRootFoldersSection')) { document.getElementById('tvHuntSettingsRootFoldersSection').classList.remove('active'); document.getElementById('tvHuntSettingsRootFoldersSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsTVManagementSection')) { document.getElementById('tvHuntSettingsTVManagementSection').classList.remove('active'); document.getElementById('tvHuntSettingsTVManagementSection').style.display = 'none'; }
            if (document.getElementById('tvManagementSection')) { document.getElementById('tvManagementSection').classList.remove('active'); document.getElementById('tvManagementSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsImportListsSection')) { document.getElementById('tvHuntSettingsImportListsSection').classList.remove('active'); document.getElementById('tvHuntSettingsImportListsSection').style.display = 'none'; }
            if (document.getElementById('mediaHuntSection')) { document.getElementById('mediaHuntSection').classList.remove('active'); document.getElementById('mediaHuntSection').style.display = 'none'; }
            if (document.getElementById('mediaHuntCalendarSection')) { document.getElementById('mediaHuntCalendarSection').classList.remove('active'); document.getElementById('mediaHuntCalendarSection').style.display = 'none'; }
            newTitle = 'Profiles';
            this.currentSection = 'tv-snipe-settings-profiles';
            this.showTVHuntSidebar();
            if (window.MediaHuntProfiles && typeof window.MediaHuntProfiles.initOrRefresh === 'function') {
                window.MediaHuntProfiles.initOrRefresh('tv');
            }
        } else if (section === 'tv-snipe-settings-indexers' && document.getElementById('indexer-snipe-section')) {
            /* TV Snipe Indexers merged into Index Master; redirect to Index Master */
            this.switchSection('indexer-hunt');
            return;
        } else if (section === 'tv-snipe-settings-clients' && document.getElementById('tvHuntSettingsClientsSection')) {
            if (document.getElementById('tvHuntActivitySection')) { document.getElementById('tvHuntActivitySection').classList.remove('active'); document.getElementById('tvHuntActivitySection').style.display = 'none'; }
            document.getElementById('tvHuntSettingsClientsSection').classList.add('active');
            document.getElementById('tvHuntSettingsClientsSection').style.display = 'block';
            if (document.getElementById('tvHuntSettingsClientsNav')) document.getElementById('tvHuntSettingsClientsNav').classList.add('active');
            if (document.getElementById('mediaHuntInstanceManagementSection')) { document.getElementById('mediaHuntInstanceManagementSection').classList.remove('active'); document.getElementById('mediaHuntInstanceManagementSection').style.display = 'none'; }
            if (document.getElementById('mediaHuntInstanceEditorSection')) { document.getElementById('mediaHuntInstanceEditorSection').classList.remove('active'); document.getElementById('mediaHuntInstanceEditorSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsCustomFormatsSection')) { document.getElementById('tvHuntSettingsCustomFormatsSection').classList.remove('active'); document.getElementById('tvHuntSettingsCustomFormatsSection').style.display = 'none'; }
            if (document.getElementById('mediaHuntProfilesSection')) { document.getElementById('mediaHuntProfilesSection').classList.remove('active'); document.getElementById('mediaHuntProfilesSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsIndexersSection')) { document.getElementById('tvHuntSettingsIndexersSection').classList.remove('active'); document.getElementById('tvHuntSettingsIndexersSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsRootFoldersSection')) { document.getElementById('tvHuntSettingsRootFoldersSection').classList.remove('active'); document.getElementById('tvHuntSettingsRootFoldersSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsTVManagementSection')) { document.getElementById('tvHuntSettingsTVManagementSection').classList.remove('active'); document.getElementById('tvHuntSettingsTVManagementSection').style.display = 'none'; }
            if (document.getElementById('tvManagementSection')) { document.getElementById('tvManagementSection').classList.remove('active'); document.getElementById('tvManagementSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsImportListsSection')) { document.getElementById('tvHuntSettingsImportListsSection').classList.remove('active'); document.getElementById('tvHuntSettingsImportListsSection').style.display = 'none'; }
            if (document.getElementById('mediaHuntSection')) { document.getElementById('mediaHuntSection').classList.remove('active'); document.getElementById('mediaHuntSection').style.display = 'none'; }
            if (document.getElementById('mediaHuntCalendarSection')) { document.getElementById('mediaHuntCalendarSection').classList.remove('active'); document.getElementById('mediaHuntCalendarSection').style.display = 'none'; }
            newTitle = 'TV Snipe Clients';
            this.currentSection = 'tv-snipe-settings-clients';
            this.showTVHuntSidebar();
            if (window.TVHuntInstanceDropdown && window.TVHuntInstanceDropdown.attach) {
                window.TVHuntInstanceDropdown.attach('tv-snipe-settings-clients-instance-select', function() {
                    if (window.TVHuntSettingsForms && typeof window.TVHuntSettingsForms.refreshClientsList === 'function') {
                        window.TVHuntSettingsForms.refreshClientsList();
                    }
                });
            }
            if (window.TVHuntSettingsForms && typeof window.TVHuntSettingsForms.refreshClientsList === 'function') {
                window.TVHuntSettingsForms.refreshClientsList();
            }
        } else if (section === 'tv-snipe-settings-root-folders' && document.getElementById('settingsRootFoldersSection')) {
            if (document.getElementById('tvHuntActivitySection')) { document.getElementById('tvHuntActivitySection').classList.remove('active'); document.getElementById('tvHuntActivitySection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsRootFoldersSection')) { document.getElementById('tvHuntSettingsRootFoldersSection').classList.remove('active'); document.getElementById('tvHuntSettingsRootFoldersSection').style.display = 'none'; }
            document.getElementById('settingsRootFoldersSection').classList.add('active');
            document.getElementById('settingsRootFoldersSection').style.display = 'block';
            if (document.getElementById('tvHuntSettingsRootFoldersNav')) document.getElementById('tvHuntSettingsRootFoldersNav').classList.add('active');
            if (document.getElementById('mediaHuntInstanceManagementSection')) { document.getElementById('mediaHuntInstanceManagementSection').classList.remove('active'); document.getElementById('mediaHuntInstanceManagementSection').style.display = 'none'; }
            if (document.getElementById('mediaHuntInstanceEditorSection')) { document.getElementById('mediaHuntInstanceEditorSection').classList.remove('active'); document.getElementById('mediaHuntInstanceEditorSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsCustomFormatsSection')) { document.getElementById('tvHuntSettingsCustomFormatsSection').classList.remove('active'); document.getElementById('tvHuntSettingsCustomFormatsSection').style.display = 'none'; }
            if (document.getElementById('mediaHuntProfilesSection')) { document.getElementById('mediaHuntProfilesSection').classList.remove('active'); document.getElementById('mediaHuntProfilesSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsIndexersSection')) { document.getElementById('tvHuntSettingsIndexersSection').classList.remove('active'); document.getElementById('tvHuntSettingsIndexersSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsClientsSection')) { document.getElementById('tvHuntSettingsClientsSection').classList.remove('active'); document.getElementById('tvHuntSettingsClientsSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsTVManagementSection')) { document.getElementById('tvHuntSettingsTVManagementSection').classList.remove('active'); document.getElementById('tvHuntSettingsTVManagementSection').style.display = 'none'; }
            if (document.getElementById('tvManagementSection')) { document.getElementById('tvManagementSection').classList.remove('active'); document.getElementById('tvManagementSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsImportListsSection')) { document.getElementById('tvHuntSettingsImportListsSection').classList.remove('active'); document.getElementById('tvHuntSettingsImportListsSection').style.display = 'none'; }
            if (document.getElementById('mediaHuntSection')) { document.getElementById('mediaHuntSection').classList.remove('active'); document.getElementById('mediaHuntSection').style.display = 'none'; }
            if (document.getElementById('mediaHuntCalendarSection')) { document.getElementById('mediaHuntCalendarSection').classList.remove('active'); document.getElementById('mediaHuntCalendarSection').style.display = 'none'; }
            newTitle = 'Root Folders';
            this.currentSection = 'tv-snipe-settings-root-folders';
            this.showTVHuntSidebar();
            if (window.RootFolders && typeof window.RootFolders.initOrRefresh === 'function') {
                window.RootFolders.initOrRefresh('tv');
            }
        } else if (section === 'tv-snipe-settings-tv-management' && document.getElementById('tvManagementSection')) {
            if (document.getElementById('tvHuntActivitySection')) { document.getElementById('tvHuntActivitySection').classList.remove('active'); document.getElementById('tvHuntActivitySection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsTVManagementSection')) { document.getElementById('tvHuntSettingsTVManagementSection').classList.remove('active'); document.getElementById('tvHuntSettingsTVManagementSection').style.display = 'none'; }
            if (document.getElementById('tvManagementSection')) { document.getElementById('tvManagementSection').classList.remove('active'); document.getElementById('tvManagementSection').style.display = 'none'; }
            document.getElementById('tvManagementSection').classList.add('active');
            document.getElementById('tvManagementSection').style.display = 'block';
            if (document.getElementById('tvHuntSettingsTVManagementNav')) document.getElementById('tvHuntSettingsTVManagementNav').classList.add('active');
            if (document.getElementById('mediaHuntInstanceManagementSection')) { document.getElementById('mediaHuntInstanceManagementSection').classList.remove('active'); document.getElementById('mediaHuntInstanceManagementSection').style.display = 'none'; }
            if (document.getElementById('mediaHuntInstanceEditorSection')) { document.getElementById('mediaHuntInstanceEditorSection').classList.remove('active'); document.getElementById('mediaHuntInstanceEditorSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsCustomFormatsSection')) { document.getElementById('tvHuntSettingsCustomFormatsSection').classList.remove('active'); document.getElementById('tvHuntSettingsCustomFormatsSection').style.display = 'none'; }
            if (document.getElementById('mediaHuntProfilesSection')) { document.getElementById('mediaHuntProfilesSection').classList.remove('active'); document.getElementById('mediaHuntProfilesSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsIndexersSection')) { document.getElementById('tvHuntSettingsIndexersSection').classList.remove('active'); document.getElementById('tvHuntSettingsIndexersSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsClientsSection')) { document.getElementById('tvHuntSettingsClientsSection').classList.remove('active'); document.getElementById('tvHuntSettingsClientsSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsRootFoldersSection')) { document.getElementById('tvHuntSettingsRootFoldersSection').classList.remove('active'); document.getElementById('tvHuntSettingsRootFoldersSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsImportListsSection')) { document.getElementById('tvHuntSettingsImportListsSection').classList.remove('active'); document.getElementById('tvHuntSettingsImportListsSection').style.display = 'none'; }
            if (document.getElementById('mediaHuntSection')) { document.getElementById('mediaHuntSection').classList.remove('active'); document.getElementById('mediaHuntSection').style.display = 'none'; }
            if (document.getElementById('mediaHuntCalendarSection')) { document.getElementById('mediaHuntCalendarSection').classList.remove('active'); document.getElementById('mediaHuntCalendarSection').style.display = 'none'; }
            if (document.getElementById('movieManagementSection')) { document.getElementById('movieManagementSection').classList.remove('active'); document.getElementById('movieManagementSection').style.display = 'none'; }
            newTitle = 'Media Management';
            this.currentSection = 'tv-snipe-settings-tv-management';
            this.showTVHuntSidebar();
            if (window.TVManagement && typeof window.TVManagement.initOrRefresh === 'function') {
                window.TVManagement.initOrRefresh();
            }
        } else if (section === 'tv-snipe-settings-import-lists' && document.getElementById('settingsImportListsSection')) {
            if (document.getElementById('tvHuntActivitySection')) { document.getElementById('tvHuntActivitySection').classList.remove('active'); document.getElementById('tvHuntActivitySection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsImportListsSection')) { document.getElementById('tvHuntSettingsImportListsSection').classList.remove('active'); document.getElementById('tvHuntSettingsImportListsSection').style.display = 'none'; }
            document.getElementById('settingsImportListsSection').classList.add('active');
            document.getElementById('settingsImportListsSection').style.display = 'block';
            if (document.getElementById('tvHuntSettingsImportListsNav')) document.getElementById('tvHuntSettingsImportListsNav').classList.add('active');
            if (document.getElementById('mediaHuntInstanceManagementSection')) { document.getElementById('mediaHuntInstanceManagementSection').classList.remove('active'); document.getElementById('mediaHuntInstanceManagementSection').style.display = 'none'; }
            if (document.getElementById('mediaHuntInstanceEditorSection')) { document.getElementById('mediaHuntInstanceEditorSection').classList.remove('active'); document.getElementById('mediaHuntInstanceEditorSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsCustomFormatsSection')) { document.getElementById('tvHuntSettingsCustomFormatsSection').classList.remove('active'); document.getElementById('tvHuntSettingsCustomFormatsSection').style.display = 'none'; }
            if (document.getElementById('mediaHuntProfilesSection')) { document.getElementById('mediaHuntProfilesSection').classList.remove('active'); document.getElementById('mediaHuntProfilesSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsIndexersSection')) { document.getElementById('tvHuntSettingsIndexersSection').classList.remove('active'); document.getElementById('tvHuntSettingsIndexersSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsClientsSection')) { document.getElementById('tvHuntSettingsClientsSection').classList.remove('active'); document.getElementById('tvHuntSettingsClientsSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsRootFoldersSection')) { document.getElementById('tvHuntSettingsRootFoldersSection').classList.remove('active'); document.getElementById('tvHuntSettingsRootFoldersSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsTVManagementSection')) { document.getElementById('tvHuntSettingsTVManagementSection').classList.remove('active'); document.getElementById('tvHuntSettingsTVManagementSection').style.display = 'none'; }
            if (document.getElementById('tvManagementSection')) { document.getElementById('tvManagementSection').classList.remove('active'); document.getElementById('tvManagementSection').style.display = 'none'; }
            if (document.getElementById('mediaHuntSection')) { document.getElementById('mediaHuntSection').classList.remove('active'); document.getElementById('mediaHuntSection').style.display = 'none'; }
            if (document.getElementById('mediaHuntCalendarSection')) { document.getElementById('mediaHuntCalendarSection').classList.remove('active'); document.getElementById('mediaHuntCalendarSection').style.display = 'none'; }
            newTitle = 'Import Lists';
            this.currentSection = 'tv-snipe-settings-import-lists';
            this.showTVHuntSidebar();
            if (window.ImportLists && typeof window.ImportLists.initOrRefresh === 'function') {
                window.ImportLists.initOrRefresh('tv');
            }
        } else if (section && section.startsWith('tv-snipe-activity') && document.getElementById('tvHuntActivitySection')) {
            // TV Snipe Activity - dedicated section (History, Blocklist unique to TV Snipe; separate from Movie Snipe)
            // Redirect queue to history (queue is now in NZB Sniparr)
            if (section === 'tv-snipe-activity-queue') {
                section = 'tv-snipe-activity-history';
                history.replaceState(null, '', './#tv-snipe-activity-history');
            }
            if (document.getElementById('activitySection')) {
                document.getElementById('activitySection').classList.remove('active');
                document.getElementById('activitySection').style.display = 'none';
            }
            document.getElementById('tvHuntActivitySection').classList.add('active');
            document.getElementById('tvHuntActivitySection').style.display = 'block';
            // Update sidebar nav links so History/Blocklist stay in TV Snipe Activity
            var hNav = document.getElementById('movieHuntActivityHistoryNav');
            var bNav = document.getElementById('movieHuntActivityBlocklistNav');
            if (hNav) hNav.setAttribute('href', './#tv-snipe-activity-history');
            if (bNav) bNav.setAttribute('href', './#tv-snipe-activity-blocklist');
            // Hide all TV Snipe settings/main sections
            ['mediaHuntSection', 'mediaHuntInstanceManagementSection', 'mediaHuntInstanceEditorSection', 'tvHuntSettingsCustomFormatsSection', 'mediaHuntProfilesSection', 'tvHuntSettingsIndexersSection', 'tvHuntSettingsClientsSection', 'tvHuntSettingsRootFoldersSection', 'mediaHuntSettingsImportMediaSection', 'tvHuntSettingsTVManagementSection', 'tvManagementSection', 'tvHuntSettingsImportListsSection'].forEach(function(id) {
                var el = document.getElementById(id);
                if (el) { el.classList.remove('active'); el.style.display = 'none'; }
            });
            var view = section === 'tv-snipe-activity-history' ? 'history' : 'blocklist';
            newTitle = 'TV Snipe ' + view.charAt(0).toUpperCase() + view.slice(1);
            this.currentSection = section;
            this.showTVHuntSidebar();
            if (window.TVHuntActivityModule && typeof window.TVHuntActivityModule.init === 'function') {
                window.TVHuntActivityModule.init(view);
            }
        } else if (section === 'media-snipe-calendar' && document.getElementById('mediaHuntCalendarSection')) {
            if (document.getElementById('mediaHuntSection')) {
                document.getElementById('mediaHuntSection').classList.remove('active');
                document.getElementById('mediaHuntSection').style.display = 'none';
            }
            if (document.getElementById('activitySection')) {
                document.getElementById('activitySection').classList.remove('active');
                document.getElementById('activitySection').style.display = 'none';
            }
            if (document.getElementById('tvHuntActivitySection')) {
                document.getElementById('tvHuntActivitySection').classList.remove('active');
                document.getElementById('tvHuntActivitySection').style.display = 'none';
            }
            document.getElementById('mediaHuntCalendarSection').classList.add('active');
            document.getElementById('mediaHuntCalendarSection').style.display = 'block';
            if (document.getElementById('movieHuntCalendarNav')) document.getElementById('movieHuntCalendarNav').classList.add('active');
            newTitle = 'Calendar';
            this.currentSection = 'media-snipe-calendar';
            this.showMovieHuntSidebar();
            var calMode = this._pendingMediaHuntCalendarMode || 'movie';
            this._pendingMediaHuntCalendarMode = undefined;
            window._mediaHuntCalendarMode = calMode;
            if (window.MediaHuntCalendar && typeof window.MediaHuntCalendar.init === 'function') {
                window.MediaHuntCalendar.init();
            }
        } else if ((section === 'activity-queue' || section === 'activity-history' || section === 'activity-blocklist' || section === 'activity-logs') && document.getElementById('activitySection')) {
            if (document.getElementById('tvHuntActivitySection')) {
                document.getElementById('tvHuntActivitySection').classList.remove('active');
                document.getElementById('tvHuntActivitySection').style.display = 'none';
            }
            document.getElementById('activitySection').classList.add('active');
            document.getElementById('activitySection').style.display = 'block';
            // Restore sidebar nav links to Movie Snipe Activity
            var qNav = document.getElementById('movieHuntActivityQueueNav');
            var hNav = document.getElementById('movieHuntActivityHistoryNav');
            var bNav = document.getElementById('movieHuntActivityBlocklistNav');
            if (qNav) qNav.setAttribute('href', './#activity-queue');
            if (hNav) hNav.setAttribute('href', './#activity-history');
            if (bNav) bNav.setAttribute('href', './#activity-blocklist');
            if (document.getElementById('mediaHuntSection')) {
                document.getElementById('mediaHuntSection').classList.remove('active');
                document.getElementById('mediaHuntSection').style.display = 'none';
            }
            if (document.getElementById('mediaHuntCalendarSection')) {
                document.getElementById('mediaHuntCalendarSection').classList.remove('active');
                document.getElementById('mediaHuntCalendarSection').style.display = 'none';
            }
            var view = section === 'activity-queue' ? 'queue' : section === 'activity-history' ? 'history' : section === 'activity-blocklist' ? 'blocklist' : 'logs';
            newTitle = section === 'activity-queue' ? 'Activity – Queue' : section === 'activity-history' ? 'Activity – History' : section === 'activity-blocklist' ? 'Activity – Blocklist' : 'Activity – Logs';
            this.currentSection = section;
            this.showMovieHuntSidebar();
            if (window.ActivityModule && typeof window.ActivityModule.init === 'function') {
                window.ActivityModule.init(view);
            }
        } else if ((section === 'movie-snipe-instance-editor' || section === 'tv-snipe-instance-editor') && document.getElementById('mediaHuntInstanceEditorSection')) {
            window._mediaHuntInstanceEditorMode = section === 'tv-snipe-instance-editor' ? 'tv' : 'movie';
            if (section === 'tv-snipe-instance-editor') {
                if (document.getElementById('tvHuntActivitySection')) { document.getElementById('tvHuntActivitySection').classList.remove('active'); document.getElementById('tvHuntActivitySection').style.display = 'none'; }
                if (document.getElementById('mediaHuntInstanceManagementSection')) { document.getElementById('mediaHuntInstanceManagementSection').classList.remove('active'); document.getElementById('mediaHuntInstanceManagementSection').style.display = 'none'; }
                if (document.getElementById('tvHuntSettingsCustomFormatsSection')) { document.getElementById('tvHuntSettingsCustomFormatsSection').classList.remove('active'); document.getElementById('tvHuntSettingsCustomFormatsSection').style.display = 'none'; }
                if (document.getElementById('mediaHuntProfilesSection')) { document.getElementById('mediaHuntProfilesSection').classList.remove('active'); document.getElementById('mediaHuntProfilesSection').style.display = 'none'; }
                if (document.getElementById('tvHuntSettingsIndexersSection')) { document.getElementById('tvHuntSettingsIndexersSection').classList.remove('active'); document.getElementById('tvHuntSettingsIndexersSection').style.display = 'none'; }
                if (document.getElementById('tvHuntSettingsClientsSection')) { document.getElementById('tvHuntSettingsClientsSection').classList.remove('active'); document.getElementById('tvHuntSettingsClientsSection').style.display = 'none'; }
                if (document.getElementById('tvHuntSettingsRootFoldersSection')) { document.getElementById('tvHuntSettingsRootFoldersSection').classList.remove('active'); document.getElementById('tvHuntSettingsRootFoldersSection').style.display = 'none'; }
                if (document.getElementById('tvHuntSettingsTVManagementSection')) { document.getElementById('tvHuntSettingsTVManagementSection').classList.remove('active'); document.getElementById('tvHuntSettingsTVManagementSection').style.display = 'none'; }
            if (document.getElementById('tvManagementSection')) { document.getElementById('tvManagementSection').classList.remove('active'); document.getElementById('tvManagementSection').style.display = 'none'; }
                if (document.getElementById('tvHuntSettingsImportListsSection')) { document.getElementById('tvHuntSettingsImportListsSection').classList.remove('active'); document.getElementById('tvHuntSettingsImportListsSection').style.display = 'none'; }
                if (document.getElementById('mediaHuntSection')) { document.getElementById('mediaHuntSection').classList.remove('active'); document.getElementById('mediaHuntSection').style.display = 'none'; }
                if (document.getElementById('mediaHuntCalendarSection')) { document.getElementById('mediaHuntCalendarSection').classList.remove('active'); document.getElementById('mediaHuntCalendarSection').style.display = 'none'; }
                newTitle = 'TV Snipe Instance Editor';
                this.currentSection = 'tv-snipe-instance-editor';
                this.showTVHuntSidebar();
            } else {
                if (document.getElementById('media-snipe-settings-default-section')) {
                    document.getElementById('media-snipe-settings-default-section').classList.remove('active');
                    document.getElementById('media-snipe-settings-default-section').style.display = 'none';
                }
                if (document.getElementById('mediaHuntInstanceManagementSection')) {
                    document.getElementById('mediaHuntInstanceManagementSection').classList.remove('active');
                    document.getElementById('mediaHuntInstanceManagementSection').style.display = 'none';
                }
                newTitle = 'Movie Snipe';
                this.currentSection = 'movie-snipe-instance-editor';
                this.showMovieHuntSidebar();
            }
            document.getElementById('mediaHuntInstanceEditorSection').classList.add('active');
            document.getElementById('mediaHuntInstanceEditorSection').style.display = 'block';
        } else if (section === 'apps') {
            console.log('[sniparrUI] Apps section requested - redirecting to Sonarr by default');
            // Instead of showing apps dashboard, redirect to Sonarr
            this.switchSection('sonarr');
            window.location.hash = '#sonarr';
            return;
        } else if (section === 'sonarr' && document.getElementById('sonarrSection')) {
            document.getElementById('sonarrSection').classList.add('active');
            document.getElementById('sonarrSection').style.display = 'block';
            if (document.getElementById('appsSonarrNav')) document.getElementById('appsSonarrNav').classList.add('active');
            newTitle = 'Sonarr';
            this.currentSection = 'sonarr';
            
            // Switch to Apps sidebar
            this.showAppsSidebar();
            
            // Initialize app module for sonarr
            if (typeof appsModule !== 'undefined') {
                appsModule.init('sonarr');
            }
        } else if (section === 'radarr' && document.getElementById('radarrSection')) {
            document.getElementById('radarrSection').classList.add('active');
            document.getElementById('radarrSection').style.display = 'block';
            if (document.getElementById('appsRadarrNav')) document.getElementById('appsRadarrNav').classList.add('active');
            newTitle = 'Radarr';
            this.currentSection = 'radarr';
            
            // Switch to Apps sidebar
            this.showAppsSidebar();
            
            // Initialize app module for radarr
            if (typeof appsModule !== 'undefined') {
                appsModule.init('radarr');
            }
        } else if (section === 'lidarr' && document.getElementById('lidarrSection')) {
            document.getElementById('lidarrSection').classList.add('active');
            document.getElementById('lidarrSection').style.display = 'block';
            if (document.getElementById('appsLidarrNav')) document.getElementById('appsLidarrNav').classList.add('active');
            newTitle = 'Lidarr';
            this.currentSection = 'lidarr';
            
            // Switch to Apps sidebar
            this.showAppsSidebar();
            
            // Initialize app module for lidarr
            if (typeof appsModule !== 'undefined') {
                appsModule.init('lidarr');
            }
        } else if (section === 'readarr' && document.getElementById('readarrSection')) {
            document.getElementById('readarrSection').classList.add('active');
            document.getElementById('readarrSection').style.display = 'block';
            if (document.getElementById('appsReadarrNav')) document.getElementById('appsReadarrNav').classList.add('active');
            newTitle = 'Readarr';
            this.currentSection = 'readarr';
            
            // Switch to Apps sidebar
            this.showAppsSidebar();
            
            // Initialize app module for readarr
            if (typeof appsModule !== 'undefined') {
                appsModule.init('readarr');
            }
        } else if (section === 'whisparr' && document.getElementById('whisparrSection')) {
            document.getElementById('whisparrSection').classList.add('active');
            document.getElementById('whisparrSection').style.display = 'block';
            if (document.getElementById('appsWhisparrNav')) document.getElementById('appsWhisparrNav').classList.add('active');
            newTitle = 'Whisparr V2';
            this.currentSection = 'whisparr';
            
            // Switch to Apps sidebar
            this.showAppsSidebar();
            
            // Initialize app module for whisparr
            if (typeof appsModule !== 'undefined') {
                appsModule.init('whisparr');
            }
        } else if (section === 'eros' && document.getElementById('erosSection')) {
            document.getElementById('erosSection').classList.add('active');
            document.getElementById('erosSection').style.display = 'block';
            if (document.getElementById('appsErosNav')) document.getElementById('appsErosNav').classList.add('active');
            newTitle = 'Whisparr V3';
            this.currentSection = 'eros';
            
            // Switch to Apps sidebar
            this.showAppsSidebar();
            
            // Initialize app module for eros
            if (typeof appsModule !== 'undefined') {
                appsModule.init('eros');
            }
        } else if (section === 'swaparr' && document.getElementById('swaparrSection')) {
            document.getElementById('swaparrSection').classList.add('active');
            document.getElementById('swaparrSection').style.display = 'block';
            if (document.getElementById('appsSwaparrNav')) document.getElementById('appsSwaparrNav').classList.add('active');
            newTitle = 'Swaparr';
            this.currentSection = 'swaparr';
            
            // Show Apps sidebar (Swaparr lives under Apps)
            this.showAppsSidebar();
            
            // Initialize Swaparr section
            this.initializeSwaparr();
        } else if (section === 'settings' && document.getElementById('settingsSection')) {
            document.getElementById('settingsSection').classList.add('active');
            document.getElementById('settingsSection').style.display = 'block';
            newTitle = 'Settings';
            this.currentSection = 'settings';
            this.showSettingsSidebar();
            this.initializeSettings();
        } else if (section === 'settings-instance-management' && document.getElementById('mediaHuntInstanceManagementSection')) {
            document.getElementById('mediaHuntInstanceManagementSection').classList.add('active');
            document.getElementById('mediaHuntInstanceManagementSection').style.display = 'block';
            if (document.getElementById('media-snipe-settings-default-section')) {
                document.getElementById('media-snipe-settings-default-section').classList.remove('active');
                document.getElementById('media-snipe-settings-default-section').style.display = 'none';
            }
            if (document.getElementById('mediaHuntInstanceEditorSection')) {
                document.getElementById('mediaHuntInstanceEditorSection').classList.remove('active');
                document.getElementById('mediaHuntInstanceEditorSection').style.display = 'none';
            }
            if (document.getElementById('movieManagementSection')) {
                document.getElementById('movieManagementSection').classList.remove('active');
                document.getElementById('movieManagementSection').style.display = 'none';
            }
            if (document.getElementById('mediaHuntProfilesSection')) {
                document.getElementById('mediaHuntProfilesSection').classList.remove('active');
                document.getElementById('mediaHuntProfilesSection').style.display = 'none';
            }
            if (document.getElementById('profileEditorSection')) {
                document.getElementById('profileEditorSection').classList.remove('active');
                document.getElementById('profileEditorSection').style.display = 'none';
            }
            if (document.getElementById('settingsSizesSection')) {
                document.getElementById('settingsSizesSection').classList.remove('active');
                document.getElementById('settingsSizesSection').style.display = 'none';
            }
            if (document.getElementById('settingsCustomFormatsSection')) {
                document.getElementById('settingsCustomFormatsSection').classList.remove('active');
                document.getElementById('settingsCustomFormatsSection').style.display = 'none';
            }
            if (document.getElementById('settingsIndexersSection')) {
                document.getElementById('settingsIndexersSection').classList.remove('active');
                document.getElementById('settingsIndexersSection').style.display = 'none';
            }
            if (document.getElementById('settingsClientsSection')) {
                document.getElementById('settingsClientsSection').classList.remove('active');
                document.getElementById('settingsClientsSection').style.display = 'none';
            }
            if (document.getElementById('settingsImportListsSection')) {
                document.getElementById('settingsImportListsSection').classList.remove('active');
                document.getElementById('settingsImportListsSection').style.display = 'none';
            }
            if (document.getElementById('settingsRootFoldersSection')) {
                document.getElementById('settingsRootFoldersSection').classList.remove('active');
                document.getElementById('settingsRootFoldersSection').style.display = 'none';
            }
            newTitle = 'Instances';
            this.currentSection = 'settings-instance-management';
            this.showMovieHuntSidebar();
            window._mediaHuntInstanceManagementMode = 'movie';
            if (window.MediaHuntInstanceManagement && typeof window.MediaHuntInstanceManagement.init === 'function') {
                window.MediaHuntInstanceManagement.init();
            }
        } else if (section === 'settings-media-management' && document.getElementById('movieManagementSection')) {
            if (document.getElementById('tvHuntSettingsTVManagementSection')) { document.getElementById('tvHuntSettingsTVManagementSection').classList.remove('active'); document.getElementById('tvHuntSettingsTVManagementSection').style.display = 'none'; }
            if (document.getElementById('tvManagementSection')) { document.getElementById('tvManagementSection').classList.remove('active'); document.getElementById('tvManagementSection').style.display = 'none'; }
            document.getElementById('movieManagementSection').classList.add('active');
            document.getElementById('movieManagementSection').style.display = 'block';
            if (document.getElementById('movieHuntSettingsMovieManagementNav')) document.getElementById('movieHuntSettingsMovieManagementNav').classList.add('active');
            if (document.getElementById('mediaHuntInstanceManagementSection')) {
                document.getElementById('mediaHuntInstanceManagementSection').classList.remove('active');
                document.getElementById('mediaHuntInstanceManagementSection').style.display = 'none';
            }
            if (document.getElementById('mediaHuntProfilesSection')) {
                document.getElementById('mediaHuntProfilesSection').classList.remove('active');
                document.getElementById('mediaHuntProfilesSection').style.display = 'none';
            }
            if (document.getElementById('profileEditorSection')) {
                document.getElementById('profileEditorSection').classList.remove('active');
                document.getElementById('profileEditorSection').style.display = 'none';
            }
            if (document.getElementById('settingsSizesSection')) {
                document.getElementById('settingsSizesSection').classList.remove('active');
                document.getElementById('settingsSizesSection').style.display = 'none';
            }
            if (document.getElementById('settingsCustomFormatsSection')) {
                document.getElementById('settingsCustomFormatsSection').classList.remove('active');
                document.getElementById('settingsCustomFormatsSection').style.display = 'none';
            }
            if (document.getElementById('settingsIndexersSection')) {
                document.getElementById('settingsIndexersSection').classList.remove('active');
                document.getElementById('settingsIndexersSection').style.display = 'none';
            }
            if (document.getElementById('settingsClientsSection')) {
                document.getElementById('settingsClientsSection').classList.remove('active');
                document.getElementById('settingsClientsSection').style.display = 'none';
            }
            if (document.getElementById('settingsImportListsSection')) {
                document.getElementById('settingsImportListsSection').classList.remove('active');
                document.getElementById('settingsImportListsSection').style.display = 'none';
            }
            if (document.getElementById('settingsRootFoldersSection')) {
                document.getElementById('settingsRootFoldersSection').classList.remove('active');
                document.getElementById('settingsRootFoldersSection').style.display = 'none';
            }
            newTitle = 'Media Management';
            this.currentSection = 'settings-media-management';
            this.showMovieHuntSidebar();
            if (window.MovieManagement && typeof window.MovieManagement.initOrRefresh === 'function') {
                window.MovieManagement.initOrRefresh();
            }
        } else if (section === 'settings-profiles' && document.getElementById('mediaHuntProfilesSection')) {
            document.getElementById('mediaHuntProfilesSection').classList.add('active');
            document.getElementById('mediaHuntProfilesSection').style.display = 'block';
            if (document.getElementById('movieHuntSettingsProfilesNav')) document.getElementById('movieHuntSettingsProfilesNav').classList.add('active');
            if (document.getElementById('mediaHuntInstanceManagementSection')) {
                document.getElementById('mediaHuntInstanceManagementSection').classList.remove('active');
                document.getElementById('mediaHuntInstanceManagementSection').style.display = 'none';
            }
            if (document.getElementById('movieManagementSection')) {
                document.getElementById('movieManagementSection').classList.remove('active');
                document.getElementById('movieManagementSection').style.display = 'none';
            }
            if (document.getElementById('profileEditorSection')) {
                document.getElementById('profileEditorSection').classList.remove('active');
                document.getElementById('profileEditorSection').style.display = 'none';
            }
            if (document.getElementById('settingsSizesSection')) {
                document.getElementById('settingsSizesSection').classList.remove('active');
                document.getElementById('settingsSizesSection').style.display = 'none';
            }
            if (document.getElementById('settingsCustomFormatsSection')) {
                document.getElementById('settingsCustomFormatsSection').classList.remove('active');
                document.getElementById('settingsCustomFormatsSection').style.display = 'none';
            }
            newTitle = 'Profiles';
            this.currentSection = 'settings-profiles';
            this.showMovieHuntSidebar();
            if (window.MediaHuntProfiles && typeof window.MediaHuntProfiles.initOrRefresh === 'function') {
                window.MediaHuntProfiles.initOrRefresh('movie');
            }
        } else if (section === 'settings-sizes' && document.getElementById('settingsSizesSection')) {
            document.getElementById('settingsSizesSection').classList.add('active');
            document.getElementById('settingsSizesSection').style.display = 'block';
            if (document.getElementById('movieHuntSettingsSizesNav')) document.getElementById('movieHuntSettingsSizesNav').classList.add('active');
            if (document.getElementById('mediaHuntInstanceManagementSection')) {
                document.getElementById('mediaHuntInstanceManagementSection').classList.remove('active');
                document.getElementById('mediaHuntInstanceManagementSection').style.display = 'none';
            }
            if (document.getElementById('movieManagementSection')) {
                document.getElementById('movieManagementSection').classList.remove('active');
                document.getElementById('movieManagementSection').style.display = 'none';
            }
            if (document.getElementById('mediaHuntProfilesSection')) {
                document.getElementById('mediaHuntProfilesSection').classList.remove('active');
                document.getElementById('mediaHuntProfilesSection').style.display = 'none';
            }
            if (document.getElementById('profileEditorSection')) {
                document.getElementById('profileEditorSection').classList.remove('active');
                document.getElementById('profileEditorSection').style.display = 'none';
            }
            if (document.getElementById('settingsCustomFormatsSection')) {
                document.getElementById('settingsCustomFormatsSection').classList.remove('active');
                document.getElementById('settingsCustomFormatsSection').style.display = 'none';
            }
            if (document.getElementById('settingsIndexersSection')) {
                document.getElementById('settingsIndexersSection').classList.remove('active');
                document.getElementById('settingsIndexersSection').style.display = 'none';
            }
            if (document.getElementById('settingsClientsSection')) {
                document.getElementById('settingsClientsSection').classList.remove('active');
                document.getElementById('settingsClientsSection').style.display = 'none';
            }
            if (document.getElementById('settingsImportListsSection')) {
                document.getElementById('settingsImportListsSection').classList.remove('active');
                document.getElementById('settingsImportListsSection').style.display = 'none';
            }
            if (document.getElementById('settingsRootFoldersSection')) {
                document.getElementById('settingsRootFoldersSection').classList.remove('active');
                document.getElementById('settingsRootFoldersSection').style.display = 'none';
            }
            var _sizesPreferMode = this._pendingSizesMode || 'movie';
            this._pendingSizesMode = null;
            newTitle = 'Sizes';
            this.currentSection = 'settings-sizes';
            if (_sizesPreferMode === 'tv') {
                this.showTVHuntSidebar();
                if (document.getElementById('tvHuntSettingsSizesNav')) document.getElementById('tvHuntSettingsSizesNav').classList.add('active');
            } else {
                this.showMovieHuntSidebar();
            }
            if (window.SizesModule && typeof window.SizesModule.initOrRefresh === 'function') {
                window.SizesModule.initOrRefresh(_sizesPreferMode);
            }
        } else if (section === 'settings-custom-formats' && document.getElementById('settingsCustomFormatsSection')) {
            if (document.getElementById('tvHuntSettingsCustomFormatsSection')) { document.getElementById('tvHuntSettingsCustomFormatsSection').classList.remove('active'); document.getElementById('tvHuntSettingsCustomFormatsSection').style.display = 'none'; }
            document.getElementById('settingsCustomFormatsSection').classList.add('active');
            document.getElementById('settingsCustomFormatsSection').style.display = 'block';
            if (document.getElementById('movieHuntSettingsCustomFormatsNav')) document.getElementById('movieHuntSettingsCustomFormatsNav').classList.add('active');
            if (document.getElementById('mediaHuntInstanceManagementSection')) {
                document.getElementById('mediaHuntInstanceManagementSection').classList.remove('active');
                document.getElementById('mediaHuntInstanceManagementSection').style.display = 'none';
            }
            if (document.getElementById('movieManagementSection')) {
                document.getElementById('movieManagementSection').classList.remove('active');
                document.getElementById('movieManagementSection').style.display = 'none';
            }
            if (document.getElementById('mediaHuntProfilesSection')) {
                document.getElementById('mediaHuntProfilesSection').classList.remove('active');
                document.getElementById('mediaHuntProfilesSection').style.display = 'none';
            }
            if (document.getElementById('profileEditorSection')) {
                document.getElementById('profileEditorSection').classList.remove('active');
                document.getElementById('profileEditorSection').style.display = 'none';
            }
            if (document.getElementById('settingsSizesSection')) {
                document.getElementById('settingsSizesSection').classList.remove('active');
                document.getElementById('settingsSizesSection').style.display = 'none';
            }
            newTitle = 'Custom Formats';
            this.currentSection = 'settings-custom-formats';
            this.showMovieHuntSidebar();
            if (window.CustomFormats && typeof window.CustomFormats.initOrRefresh === 'function') {
                window.CustomFormats.initOrRefresh('movie');
            }
        } else if (section === 'profile-editor' && document.getElementById('profileEditorSection')) {
            document.getElementById('profileEditorSection').classList.add('active');
            document.getElementById('profileEditorSection').style.display = 'block';
            if (document.getElementById('movieManagementSection')) {
                document.getElementById('movieManagementSection').classList.remove('active');
                document.getElementById('movieManagementSection').style.display = 'none';
            }
            if (document.getElementById('mediaHuntProfilesSection')) {
                document.getElementById('mediaHuntProfilesSection').classList.remove('active');
                document.getElementById('mediaHuntProfilesSection').style.display = 'none';
            }
            if (document.getElementById('settingsSizesSection')) {
                document.getElementById('settingsSizesSection').classList.remove('active');
                document.getElementById('settingsSizesSection').style.display = 'none';
            }
            if (document.getElementById('settingsCustomFormatsSection')) {
                document.getElementById('settingsCustomFormatsSection').classList.remove('active');
                document.getElementById('settingsCustomFormatsSection').style.display = 'none';
            }
            if (document.getElementById('mediaHuntProfilesSection')) {
                document.getElementById('mediaHuntProfilesSection').classList.remove('active');
                document.getElementById('mediaHuntProfilesSection').style.display = 'none';
            }
            newTitle = 'Profile Editor';
            this.currentSection = 'profile-editor';
            if (window._profileEditorTVHunt) {
                window._profileEditorTVHunt = false;
                this.showTVHuntSidebar();
                if (document.getElementById('tvHuntSettingsProfilesNav')) document.getElementById('tvHuntSettingsProfilesNav').classList.add('active');
            } else {
                this.showMovieHuntSidebar();
                if (document.getElementById('movieHuntSettingsProfilesNav')) document.getElementById('movieHuntSettingsProfilesNav').classList.add('active');
            }
        } else if (section === 'settings-indexers' && document.getElementById('indexer-snipe-section')) {
            /* Indexers merged into Index Master; redirect to Index Master */
            if (window.location.hash !== '#indexer-hunt') {
                window.history.replaceState(null, document.title, window.location.pathname + (window.location.search || '') + '#indexer-hunt');
            }
            this.switchSection('indexer-hunt');
            return;
        } else if (section === 'settings-clients' && document.getElementById('settingsClientsSection')) {
            document.getElementById('settingsClientsSection').classList.add('active');
            document.getElementById('settingsClientsSection').style.display = 'block';
            if (document.getElementById('movieHuntClientsMainNav')) document.getElementById('movieHuntClientsMainNav').classList.add('active');
            if (document.getElementById('mediaHuntInstanceManagementSection')) {
                document.getElementById('mediaHuntInstanceManagementSection').classList.remove('active');
                document.getElementById('mediaHuntInstanceManagementSection').style.display = 'none';
            }
            if (document.getElementById('movieManagementSection')) {
                document.getElementById('movieManagementSection').classList.remove('active');
                document.getElementById('movieManagementSection').style.display = 'none';
            }
            if (document.getElementById('settingsSizesSection')) {
                document.getElementById('settingsSizesSection').classList.remove('active');
                document.getElementById('settingsSizesSection').style.display = 'none';
            }
            newTitle = 'Clients';
            this.currentSection = 'settings-clients';
            this.showMovieHuntSidebar();
            if (window.SettingsForms && typeof window.SettingsForms.refreshClientsList === 'function') {
                window.SettingsForms.refreshClientsList();
            }
        } else if (section === 'settings-import-lists' && document.getElementById('settingsImportListsSection')) {
            if (document.getElementById('tvHuntSettingsImportListsSection')) { document.getElementById('tvHuntSettingsImportListsSection').classList.remove('active'); document.getElementById('tvHuntSettingsImportListsSection').style.display = 'none'; }
            document.getElementById('settingsImportListsSection').classList.add('active');
            document.getElementById('settingsImportListsSection').style.display = 'block';
            if (document.getElementById('movieHuntSettingsImportListsNav')) document.getElementById('movieHuntSettingsImportListsNav').classList.add('active');
            if (document.getElementById('mediaHuntInstanceManagementSection')) {
                document.getElementById('mediaHuntInstanceManagementSection').classList.remove('active');
                document.getElementById('mediaHuntInstanceManagementSection').style.display = 'none';
            }
            if (document.getElementById('movieManagementSection')) {
                document.getElementById('movieManagementSection').classList.remove('active');
                document.getElementById('movieManagementSection').style.display = 'none';
            }
            if (document.getElementById('settingsSizesSection')) {
                document.getElementById('settingsSizesSection').classList.remove('active');
                document.getElementById('settingsSizesSection').style.display = 'none';
            }
            newTitle = 'Import Lists';
            this.currentSection = 'settings-import-lists';
            this.showMovieHuntSidebar();
            if (window.ImportLists && typeof window.ImportLists.initOrRefresh === 'function') {
                window.ImportLists.initOrRefresh('movie');
            }
        } else if (section === 'settings-import-media' && document.getElementById('mediaHuntSettingsImportMediaSection')) {
            document.getElementById('mediaHuntSettingsImportMediaSection').classList.add('active');
            document.getElementById('mediaHuntSettingsImportMediaSection').style.display = 'block';
            if (document.getElementById('movieHuntImportMediaNav')) document.getElementById('movieHuntImportMediaNav').classList.add('active');
            newTitle = 'Import Media';
            this.currentSection = 'settings-import-media';
            this.showMovieHuntSidebar();
            if (window.MediaHuntImportMedia && typeof window.MediaHuntImportMedia.init === 'function') {
                window.MediaHuntImportMedia.init();
            }
        } else if (section === 'settings-root-folders' && document.getElementById('settingsRootFoldersSection')) {
            if (document.getElementById('tvHuntSettingsRootFoldersSection')) { document.getElementById('tvHuntSettingsRootFoldersSection').classList.remove('active'); document.getElementById('tvHuntSettingsRootFoldersSection').style.display = 'none'; }
            document.getElementById('settingsRootFoldersSection').classList.add('active');
            document.getElementById('settingsRootFoldersSection').style.display = 'block';
            if (document.getElementById('movieHuntSettingsRootFoldersNav')) document.getElementById('movieHuntSettingsRootFoldersNav').classList.add('active');
            if (document.getElementById('mediaHuntInstanceManagementSection')) {
                document.getElementById('mediaHuntInstanceManagementSection').classList.remove('active');
                document.getElementById('mediaHuntInstanceManagementSection').style.display = 'none';
            }
            if (document.getElementById('movieManagementSection')) {
                document.getElementById('movieManagementSection').classList.remove('active');
                document.getElementById('movieManagementSection').style.display = 'none';
            }
            if (document.getElementById('settingsSizesSection')) {
                document.getElementById('settingsSizesSection').classList.remove('active');
                document.getElementById('settingsSizesSection').style.display = 'none';
            }
            newTitle = 'Root Folders';
            this.currentSection = 'settings-root-folders';
            this.showMovieHuntSidebar();
            if (window.RootFolders && typeof window.RootFolders.initOrRefresh === 'function') {
                window.RootFolders.initOrRefresh('movie');
            }
        } else if (section === 'settings-logs' && document.getElementById('settingsLogsSection')) {
            document.getElementById('settingsLogsSection').classList.add('active');
            document.getElementById('settingsLogsSection').style.display = 'block';
            newTitle = 'Log Settings';
            this.currentSection = 'settings-logs';
            this.showSettingsSidebar();
            this.initializeLogsSettings();
        } else if (section === 'scheduling' && document.getElementById('schedulingSection')) {
            document.getElementById('schedulingSection').classList.add('active');
            document.getElementById('schedulingSection').style.display = 'block';
            newTitle = 'Scheduling';
            this.currentSection = 'scheduling';
            this.showSettingsSidebar();
            if (typeof window.refreshSchedulingInstances === 'function') {
                window.refreshSchedulingInstances();
            }
        } else if (section === 'notifications' && document.getElementById('notificationsSection')) {
            document.getElementById('notificationsSection').classList.add('active');
            document.getElementById('notificationsSection').style.display = 'block';
            newTitle = 'Notifications';
            this.currentSection = 'notifications';
            this.showSettingsSidebar();
            this.initializeNotifications();
        } else if (section === 'backup-restore' && document.getElementById('backupRestoreSection')) {
            document.getElementById('backupRestoreSection').classList.add('active');
            document.getElementById('backupRestoreSection').style.display = 'block';
            newTitle = 'Backup / Restore';
            this.currentSection = 'backup-restore';
            this.showSettingsSidebar();
            this.initializeBackupRestore();
        } else if (section === 'prowlarr' && document.getElementById('prowlarrSection')) {
            document.getElementById('prowlarrSection').classList.add('active');
            document.getElementById('prowlarrSection').style.display = 'block';
            if (document.getElementById('appsProwlarrNav')) document.getElementById('appsProwlarrNav').classList.add('active');
            newTitle = 'Prowlarr';
            this.currentSection = 'prowlarr';
            
            // Switch to Apps sidebar for prowlarr
            this.showAppsSidebar();
            
            // Initialize prowlarr settings if not already done
            this.initializeProwlarr();
        } else if (section === 'user' && document.getElementById('userSection')) {
            document.getElementById('userSection').classList.add('active');
            document.getElementById('userSection').style.display = 'block';
            newTitle = 'User';
            this.currentSection = 'user';
            this.showSettingsSidebar();
            this.initializeUser();
        } else if (section === 'instance-editor' && document.getElementById('instanceEditorSection')) {
            document.getElementById('instanceEditorSection').classList.add('active');
            document.getElementById('instanceEditorSection').style.display = 'block';
            this.currentSection = 'instance-editor';
            // Indexer/Client editor use Movie Snipe sidebar; app instance editor stays "Instance Editor"
            if (window.SettingsForms && window.SettingsForms._currentEditing && window.SettingsForms._currentEditing.appType === 'indexer') {
                var inst = window.SettingsForms._currentEditing.originalInstance || {};
                var preset = (inst.preset || 'manual').toString().toLowerCase().trim();
                newTitle = (window.SettingsForms.getIndexerPresetLabel && window.SettingsForms.getIndexerPresetLabel(preset)) ? (window.SettingsForms.getIndexerPresetLabel(preset) + ' Indexer Editor') : 'Indexer Editor';
                this.showMovieHuntSidebar();
                this._highlightMovieHuntNavForEditor('indexer');
            } else if (window.SettingsForms && window.SettingsForms._currentEditing && window.SettingsForms._currentEditing.appType === 'client') {
                var ct = (window.SettingsForms._currentEditing.originalInstance && window.SettingsForms._currentEditing.originalInstance.type) ? String(window.SettingsForms._currentEditing.originalInstance.type).toLowerCase() : 'nzbget';
                newTitle = (ct === 'nzbhunt' ? 'NZB Sniparr (Built-in)' : ct === 'sabnzbd' ? 'SABnzbd' : ct === 'nzbget' ? 'NZBGet' : ct) + ' Connection Settings';
                this.showMovieHuntSidebar();
                this._highlightMovieHuntNavForEditor('client');
            } else {
                var appName = 'Instance Editor';
                if (window.SettingsForms && window.SettingsForms._currentEditing && window.SettingsForms._currentEditing.appType) {
                    var appType = window.SettingsForms._currentEditing.appType;
                    appName = appType.charAt(0).toUpperCase() + appType.slice(1);
                }
                newTitle = appName;
                this.showAppsSidebar();
            }
        } else {
            // Default to home if section is unknown or element missing
            if (this.elements.homeSection) {
                this.elements.homeSection.classList.add('active');
                this.elements.homeSection.style.display = 'block';
            }
            if (this.elements.homeNav) this.elements.homeNav.classList.add('active');
            newTitle = 'Home';
            this.currentSection = 'home';
            
            // Show main sidebar
            this.showMainSidebar();
        }

        // Disconnect logs when switching away from logs section
        if (this.currentSection !== 'logs' && window.LogsModule) {
            window.LogsModule.disconnectAllEventSources();
        }

        // Update the page title
        const pageTitleElement = document.getElementById('currentPageTitle');
        if (pageTitleElement) {
            pageTitleElement.textContent = newTitle;
            // Also update mobile page title
            if (typeof window.updateMobilePageTitle === 'function') {
                window.updateMobilePageTitle(newTitle);
            }
        } else {
            console.warn("[sniparrUI] currentPageTitle element not found during section switch.");
        }
    },
    
    // ─── Sidebar switching (unified sidebar — expand groups) ───
    // With the unified sidebar, there's only one #sidebar element.
    // These functions now delegate to the sidebar.html inline expandSidebarGroup().

    _hideAllSidebars: function() {
        // No-op: only one sidebar now, always visible
    },

    showMainSidebar: function() {
        // Let setActiveNavItem handle group expansion based on hash
        if (typeof setActiveNavItem === 'function') setActiveNavItem();
    },

    _maybeShowWelcome: function() {
        // Settings must be loaded before we can check preferences
        if (!window.sniparrUI || !window.sniparrUI.originalSettings || !window.sniparrUI.originalSettings.general) {
            return; // Settings not loaded yet — will be retried after settings load
        }
        // Check if already dismissed
        var dismissed = SniparrUtils.getUIPreference('welcome-dismissed', false);
        if (dismissed) return;
        // Show the welcome modal
        var modal = document.getElementById('sniparr-welcome-modal');
        if (!modal) return;
        modal.style.display = 'flex';
        // Wire up dismiss handlers (only once)
        if (!modal._welcomeWired) {
            modal._welcomeWired = true;
            var dismissBtn = document.getElementById('sniparr-welcome-dismiss');
            var closeBtn = document.getElementById('sniparr-welcome-close');
            var backdrop = document.getElementById('sniparr-welcome-backdrop');
            var dismiss = function() {
                modal.style.display = 'none';
                SniparrUtils.setUIPreference('welcome-dismissed', true);
            };
            if (dismissBtn) dismissBtn.addEventListener('click', dismiss);
            if (closeBtn) closeBtn.addEventListener('click', dismiss);
            if (backdrop) backdrop.addEventListener('click', dismiss);
            document.addEventListener('keydown', function(e) {
                if (e.key === 'Escape' && modal.style.display === 'flex') dismiss();
            });
        }
    },

    _updateMainSidebarBetaVisibility: function() {
        // Partner Projects always visible in unified sidebar
    },
    
    showAppsSidebar: function() {
        if (typeof expandSidebarGroup === 'function') expandSidebarGroup('sidebar-group-apps');
        if (typeof setActiveNavItem === 'function') setActiveNavItem();
    },
    
    showSettingsSidebar: function() {
        // Settings now lives under System group
        if (typeof expandSidebarGroup === 'function') expandSidebarGroup('sidebar-group-system');
        if (typeof setActiveNavItem === 'function') setActiveNavItem();
    },
    
    showTVHuntSidebar: function() {
        this.showMovieHuntSidebar();
    },

    showMovieHuntSidebar: function() {
        if (typeof expandSidebarGroup === 'function') expandSidebarGroup('sidebar-group-media-hunt');
        if (window.SniparrNavigation && typeof window.SniparrNavigation.updateMovieHuntSidebarActive === 'function') {
            window.SniparrNavigation.updateMovieHuntSidebarActive();
        }
    },

    showNzbHuntSidebar: function() {
        if (typeof expandSidebarGroup === 'function') expandSidebarGroup('sidebar-group-nzb-snipe');
        if (typeof setActiveNavItem === 'function') setActiveNavItem();
    },

    /** NZB Sniparr sidebar is now always visible (controlled by applyFeatureFlags / enable_media_hunt).
     *  Kept as no-op for backward compatibility with callers. */
    _refreshNzbHuntSidebarGroup: function() {
        // No-op: sidebar visibility is handled by applyFeatureFlags()
    },

    /** Keep all Movie Snipe sidebar icons visible - no hiding when navigating between sections. */
    _updateMovieHuntSidebarSettingsOnlyVisibility: function() {
        // All navigation items remain visible for easier navigation
    },

    /** When in instance-editor for indexer/client, keep Index Master or Clients nav item highlighted. */
    _highlightMovieHuntNavForEditor: function(appType) {
        var subGroup = document.getElementById('index-master-sub');
        if (subGroup) subGroup.classList.add('expanded');
        // Query from unified sidebar
        var items = document.querySelectorAll('#sidebar-group-media-hunt .nav-item');
        for (var i = 0; i < items.length; i++) items[i].classList.remove('active');
        var nav = appType === 'indexer' ? document.getElementById('movieHuntIndexMasterNav') : document.getElementById('movieHuntIndexMasterClientsNav');
        if (nav) nav.classList.add('active');
    },

    /** Legacy: was used to show/hide Movie Snipe in Core by dev_mode. Movie Snipe is now in Beta and always visible. */
    updateMovieHuntNavVisibility: function() {
        // No-op in unified sidebar
    },
    
    // Simple event source disconnection for compatibility
    disconnectAllEventSources: function() {
        // Delegate to LogsModule if it exists
        if (window.LogsModule && typeof window.LogsModule.disconnectAllEventSources === 'function') {
            window.LogsModule.disconnectAllEventSources();
        }
        // Clear local references
        this.eventSources = {};
    },
    
    // App tab switching
    handleAppTabChange: function(e) {
        const app = e.target.getAttribute('data-app');
        if (!app) return;
        
        // Update active tab
        this.elements.appTabs.forEach(tab => {
            tab.classList.remove('active');
        });
        e.target.classList.add('active');
        
        // Let LogsModule handle app switching to preserve pagination
        this.currentApp = app;
        if (window.LogsModule && typeof window.LogsModule.handleAppChange === 'function') {
            window.LogsModule.handleAppChange(app);
        }
    },
    
    // Log option dropdown handling - Delegated to LogsModule
    // (Removed to prevent conflicts with LogsModule.handleLogOptionChange)
    
    // History option dropdown handling
    handleHistoryOptionChange: function(app) {
        if (window.SniparrUIHandlers) {
            window.SniparrUIHandlers.handleHistoryOptionChange(app);
        }
    },
    
    // Update the history placeholder text based on the selected app
    updateHistoryPlaceholder: function(app) {
        if (window.SniparrUIHandlers) {
            window.SniparrUIHandlers.updateHistoryPlaceholder(app);
        }
    },
    
    // Settings option handling
    handleSettingsOptionChange: function(e) {
        if (window.SniparrUIHandlers) {
            window.SniparrUIHandlers.handleSettingsOptionChange(e);
        }
    },
    
    // Compatibility methods that delegate to LogsModule
    connectToLogs: function() {
        if (window.SniparrLogs) {
            window.SniparrLogs.connectToLogs();
        }
    },
    
    clearLogs: function() {
        if (window.LogsModule && typeof window.LogsModule.clearLogs === 'function') {
            window.LogsModule.clearLogs(true); // true = from user action (e.g. button/menu)
        }
    },
    
    insertLogInChronologicalOrder: function(newLogEntry) {
        if (window.SniparrLogs) {
            window.SniparrLogs.insertLogInChronologicalOrder(newLogEntry);
        }
    },
    
    parseLogTimestamp: function(logEntry) {
        return window.SniparrLogs ? window.SniparrLogs.parseLogTimestamp(logEntry) : null;
    },
    
    searchLogs: function() {
        if (window.SniparrLogs) {
            window.SniparrLogs.searchLogs();
        }
    },
    
    simpleHighlightMatch: function(logEntry, searchText) {
        if (window.SniparrLogs) {
            window.SniparrLogs.simpleHighlightMatch(logEntry, searchText);
        }
    },
    
    clearLogSearch: function() {
        if (window.SniparrLogs) {
            window.SniparrLogs.clearLogSearch();
        }
    },
    
    // Settings handling
    loadAllSettings: function() {
        if (window.SniparrSettings) {
            window.SniparrSettings.loadAllSettings();
        }
    },
    
    populateSettingsForm: function(app, appSettings) {
        if (window.SniparrSettings) {
            window.SniparrSettings.populateSettingsForm(app, appSettings);
        }
    },
    
    // Called when any setting input changes in the active tab
    markSettingsAsChanged() {
        console.log("[sniparrUI] markSettingsAsChanged called, current state:", this.settingsChanged);
        if (!this.settingsChanged) {
            console.log("[sniparrUI] Settings marked as changed. Enabling save button.");
            this.settingsChanged = true;
            this.updateSaveResetButtonState(true); // Enable buttons
        } else {
            console.log("[sniparrUI] Settings already marked as changed.");
        }
    },

    saveSettings: function() {
        if (window.SniparrSettings) {
            window.SniparrSettings.saveSettings();
        }
    },

    // Update save button state
    updateSaveResetButtonState(enable) {
        const saveBtn = document.getElementById('settings-save-button');
        const notifSaveBtn = document.getElementById('notifications-save-button');
        
        console.log('[sniparrUI] updateSaveResetButtonState called with enable:', enable);
        console.log('[sniparrUI] Found buttons - settings:', !!saveBtn, 'notifications:', !!notifSaveBtn);
        
        [saveBtn, notifSaveBtn].forEach(btn => {
            if (!btn) return;
            
            console.log('[sniparrUI] Updating button:', btn.id, 'enabled:', enable);
            
            if (enable) {
                btn.disabled = false;
                btn.style.background = '#dc2626'; // Red color for enabled state
                btn.style.color = '#ffffff';
                btn.style.borderColor = '#b91c1c';
                btn.style.cursor = 'pointer';
                btn.style.boxShadow = '0 0 10px rgba(220, 38, 38, 0.3)';
            } else {
                btn.disabled = true;
                btn.style.background = '#6b7280';
                btn.style.color = '#9ca3af';
                btn.style.borderColor = '#4b5563';
                btn.style.cursor = 'not-allowed';
                btn.style.boxShadow = 'none';
            }
        });
    },

    // Setup auto-save for settings
    setupSettingsAutoSave: function() {
        if (window.SniparrSettings) {
            window.SniparrSettings.setupSettingsAutoSave();
        }
    },

    // Trigger immediate auto-save
    triggerSettingsAutoSave: function() {
        if (window.SniparrSettings) {
            window.SniparrSettings.triggerSettingsAutoSave();
        }
    },

    // Auto-save settings function
    autoSaveSettings: function(app) {
        if (window.SniparrSettings) {
            window.SniparrSettings.autoSaveSettings(app);
        }
    },

    // Clean URL by removing special characters from the end
    cleanUrlString: function(url) {
        if (!url) return "";
        
        // Trim whitespace first
        let cleanUrl = url.trim();
        
        // First remove any trailing slashes
        cleanUrl = cleanUrl.replace(/[\/\\]+$/g, '');
        
        // Then remove any other trailing special characters
        // This regex will match any special character at the end that is not alphanumeric, hyphen, period, or underscore
        return cleanUrl.replace(/[^a-zA-Z0-9\-\._]$/g, '');
    },
    
    // Get settings from the form, updated to handle instances consistently
    getFormSettings: function(app) {
        return window.SniparrSettings ? window.SniparrSettings.getFormSettings(app) : null;
    },

    // Test notification functionality
    testNotification: function() {
        if (window.SniparrSettings) {
            window.SniparrSettings.testNotification();
        }
    },

    autoSaveGeneralSettings: function(silent = false) {
        return window.SniparrSettings ? window.SniparrSettings.autoSaveGeneralSettings(silent) : Promise.resolve();
    },

    autoSaveSwaparrSettings: function(silent = false) {
        return window.SniparrSettings ? window.SniparrSettings.autoSaveSwaparrSettings(silent) : Promise.resolve();
    },
    
    // Handle instance management events
    setupInstanceEventHandlers: function() {
        if (window.SniparrInstances) {
            window.SniparrInstances.setupInstanceEventHandlers();
        }
    },
    
    // Add a new instance to the app
    addAppInstance: function(appName) {
        if (window.SniparrInstances) {
            window.SniparrInstances.addAppInstance(appName);
        }
    },
    
    // Remove an instance
    removeAppInstance: function(appName, instanceId) {
        if (window.SniparrInstances) {
            window.SniparrInstances.removeAppInstance(appName, instanceId);
        }
    },
    
    // Test connection for a specific instance
    testInstanceConnection: function(appName, instanceId, url, apiKey) {
        if (window.SniparrInstances) {
            window.SniparrInstances.testInstanceConnection(appName, instanceId, url, apiKey);
        }
    },
    
    // Helper function to translate HTTP error codes to user-friendly messages
    getConnectionErrorMessage: function(status) {
        return window.SniparrInstances ? window.SniparrInstances.getConnectionErrorMessage(status) : `Error ${status}`;
    },
    
    // App connections
    checkAppConnections: function() {
        if (window.SniparrStats) {
            window.SniparrStats.checkAppConnections();
        }
    },
    
    checkAppConnection: function(app) {
        if (window.SniparrStats) {
            return window.SniparrStats.checkAppConnection(app);
        }
        return Promise.resolve();
    },
    
    updateConnectionStatus: function(app, statusData) {
        if (window.SniparrStats) {
            window.SniparrStats.updateConnectionStatus(app, statusData);
        }
    },
    
    // Centralized function to update empty state visibility based on all configured apps
    updateEmptyStateVisibility: function() {
        if (window.SniparrStats) {
            window.SniparrStats.updateEmptyStateVisibility();
        }
    },

    // Load and update Swaparr status card
    loadSwaparrStatus: function() {
        // Delegate to Swaparr module
        if (window.SniparrSwaparr) {
            window.SniparrSwaparr.loadSwaparrStatus();
        }
    },

    // Setup Swaparr Reset buttons
    setupSwaparrResetCycle: function() {
        // Delegate to Swaparr module
        if (window.SniparrSwaparr) {
            window.SniparrSwaparr.setupSwaparrResetCycle();
        }
    },

    // Reset Swaparr data function
    resetSwaparrData: function() {
        // Delegate to Swaparr module
        if (window.SniparrSwaparr) {
            window.SniparrSwaparr.resetSwaparrData();
        }
    },

    // Update Swaparr stats display with animation
    updateSwaparrStatsDisplay: function(stats) {
        // Delegate to Swaparr module
        if (window.SniparrSwaparr) {
            window.SniparrSwaparr.updateSwaparrStatsDisplay(stats);
        }
    },

    // Setup Swaparr status polling
    setupSwaparrStatusPolling: function() {
        // Delegate to Swaparr module
        if (window.SniparrSwaparr) {
            window.SniparrSwaparr.setupSwaparrStatusPolling();
        }
    },

    // Prowlarr delegates — implementations in modules/features/prowlarr.js
    loadProwlarrStatus: function() { if (window.SniparrProwlarr) window.SniparrProwlarr.loadProwlarrStatus(); },
    loadProwlarrIndexers: function() { if (window.SniparrProwlarr) window.SniparrProwlarr.loadProwlarrIndexers(); },
    loadProwlarrStats: function() { if (window.SniparrProwlarr) window.SniparrProwlarr.loadProwlarrStats(); },
    updateIndexersList: function(d, e) { if (window.SniparrProwlarr) window.SniparrProwlarr.updateIndexersList(d, e); },
    updateProwlarrStatistics: function(s, e) { if (window.SniparrProwlarr) window.SniparrProwlarr.updateProwlarrStatistics(s, e); },
    showIndexerStats: function(n) { if (window.SniparrProwlarr) window.SniparrProwlarr.showIndexerStats(n); },
    showOverallStats: function() { if (window.SniparrProwlarr) window.SniparrProwlarr.showOverallStats(); },

    
    // User
    loadUsername: function() {
        if (window.SniparrVersion) {
            window.SniparrVersion.loadUsername();
        }
    },
    
    // Check if local access bypass is enabled and update UI accordingly
    checkLocalAccessBypassStatus: function() {
        if (window.SniparrAuth) {
            window.SniparrAuth.checkLocalAccessBypassStatus();
        }
    },
    
    updateUIForLocalAccessBypass: function(isEnabled) {
        if (window.SniparrAuth) {
            window.SniparrAuth.updateUIForLocalAccessBypass(isEnabled);
        }
    },
    
    logout: function(e) {
        if (window.SniparrAuth) {
            window.SniparrAuth.logout(e);
        }
    },
    
    // Media statistics handling
    loadMediaStats: function() {
        // Delegate to stats module
        if (window.SniparrStats) {
            window.SniparrStats.loadMediaStats();
        }
    },
    
    updateStatsDisplay: function(stats, isFromCache = false) {
        // Delegate to stats module
        if (window.SniparrStats) {
            window.SniparrStats.updateStatsDisplay(stats, isFromCache);
        }
    },

    // Helper function to parse formatted numbers back to integers
    parseFormattedNumber: function(formattedStr) {
        // Delegate to stats module
        return window.SniparrStats ? window.SniparrStats.parseFormattedNumber(formattedStr) : 0;
    },

    animateNumber: function(element, start, end) {
        // Delegate to stats module
        if (window.SniparrStats) {
            window.SniparrStats.animateNumber(element, start, end);
        }
    },
    
    // Format large numbers with appropriate suffixes (K, M, B, T)  
    formatLargeNumber: function(num) {
        // Delegate to stats module
        return window.SniparrStats ? window.SniparrStats.formatLargeNumber(num) : num.toString();
    },

    resetMediaStats: function(appType = null) {
        // Delegate to stats module
        if (window.SniparrStats) {
            window.SniparrStats.resetMediaStats(appType);
        }
    },
    
    // Utility functions
    showNotification: function(message, type) {
        // Delegate to notifications module
        if (window.SniparrNotifications) {
            window.SniparrNotifications.showNotification(message, type);
        }
    },
    
    capitalizeFirst: function(string) {
        // Delegate to helpers module
        return window.SniparrHelpers ? window.SniparrHelpers.capitalizeFirst(string) : string.charAt(0).toUpperCase() + string.slice(1);
    },

    // Load current version from version.txt
    // Load current version from version.txt
    loadCurrentVersion: function() {
        if (window.SniparrVersion) {
            window.SniparrVersion.loadCurrentVersion();
        }
    },

    // Load latest version from GitHub releases
    loadLatestVersion: function() {
        if (window.SniparrVersion) {
            window.SniparrVersion.loadLatestVersion();
        }
    },
    
    // Load latest beta version from GitHub tags
    loadBetaVersion: function() {
        if (window.SniparrVersion) {
            window.SniparrVersion.loadBetaVersion();
        }
    },

    // Load GitHub star count
    loadGitHubStarCount: function() {
        if (window.SniparrVersion) {
            window.SniparrVersion.loadGitHubStarCount();
        }
    },

    // Update home connection status
    updateHomeConnectionStatus: function() {
        console.log('[sniparrUI] Updating home connection statuses...');
        // This function should ideally call checkAppConnection for all relevant apps
        // or use the stored configuredApps status if checkAppConnection updates it.
        this.checkAppConnections(); // Re-check all connections after a save might be simplest
    },
    
    // Load stateful management info
    loadStatefulInfo: function(attempts = 0, skipCache = false) {
        if (window.SniparrStateful) {
            window.SniparrStateful.loadStatefulInfo(attempts, skipCache);
        }
    },
    
    // Format date nicely with time, day, and relative time indication
    formatDateNicely: function(date) {
        return window.SniparrStateful ? window.SniparrStateful.formatDateNicely(date) : date.toLocaleString();
    },
    
    // Helper function to get the user's configured timezone from settings
    getUserTimezone: function() {
        return window.SniparrHelpers ? window.SniparrHelpers.getUserTimezone() : 'UTC';
    },
    
    // Reset stateful management - clear all processed IDs
    resetStatefulManagement: function() {
        if (window.SniparrStateful) {
            window.SniparrStateful.resetStatefulManagement();
        }
    },
    
    // Update stateful management expiration based on hours input
    updateStatefulExpirationOnUI: function() {
        const hoursInput = document.getElementById('stateful_management_hours');
        if (!hoursInput) return;
        
        const hours = parseInt(hoursInput.value) || 72;
        
        // Show updating indicator
        const expiresDateEl = document.getElementById('stateful_expires_date');
        const initialStateEl = document.getElementById('stateful_initial_state');
        
        if (expiresDateEl) {
            expiresDateEl.textContent = 'Updating...';
        }
        
        const url = './api/stateful/update-expiration';
        const cleanedUrl = this.cleanUrlString(url);
        
        SniparrUtils.fetchWithTimeout(cleanedUrl, {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ hours: hours }),
            cache: 'no-cache'
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status} ${response.statusText}`);
            }
            return response.json();
        })
        .then(data => {
            if (data.success) {
                console.log('[sniparrUI] Stateful expiration updated successfully:', data);
                
                // Get updated info to show proper dates
                this.loadStatefulInfo();
                
                // Show a notification
                this.showNotification(`Updated expiration to ${hours} hours (${(hours/24).toFixed(1)} days)`, 'success');
            } else {
                throw new Error(data.message || 'Unknown error updating expiration');
            }
        })
        .catch(error => {
             console.error('Error updating stateful expiration:', error);
             this.showNotification(`Failed to update expiration: ${error.message}`, 'error');
             // Reset the UI
             if (expiresDateEl) {
                 expiresDateEl.textContent = 'Error updating';
             }
             
             // Try to reload original data
             setTimeout(() => this.loadStatefulInfo(), 1000);
        });
    },

    // Add the updateStatefulExpiration method
    updateStatefulExpiration: function(hours) {
        if (!hours || typeof hours !== 'number' || hours <= 0) {
            console.error('[sniparrUI] Invalid hours value for updateStatefulExpiration:', hours);
            return;
        }
        
        console.log(`[sniparrUI] Directly updating stateful expiration to ${hours} hours`);
        
        // Make a direct API call to update the stateful expiration
        SniparrUtils.fetchWithTimeout('./api/stateful/update-expiration', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ hours: hours })
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            console.log('[sniparrUI] Stateful expiration updated successfully:', data);
            // Update the expiration date display
            const expiresDateEl = document.getElementById('stateful_expires_date');
            if (expiresDateEl && data.expires_date) {
                expiresDateEl.textContent = data.expires_date;
            }
        })
        .catch(error => {
            console.error('[sniparrUI] Error updating stateful expiration:', error);
        });
    },
    
    // Add global event handler and method to track saved settings across all apps
    // Auto-save enabled - unsaved changes handlers removed
    
    // Add a proper hasFormChanges function to compare form values with original values
    hasFormChanges: function(app) {
        // If we don't have original settings or current app settings, we can't compare
        if (!this.originalSettings || !this.originalSettings[app]) {
            return false;
        }
        
        // Get current settings from the form
        const currentSettings = this.getFormSettings(app);
        
        // For complex objects like instances, we need to stringify them for comparison
        const originalJSON = JSON.stringify(this.originalSettings[app]);
        const currentJSON = JSON.stringify(currentSettings);
        
        return originalJSON !== currentJSON;
    },
    
    // Apply timezone change immediately
    applyTimezoneChange: function(timezone) {
        if (window.SniparrSettings && typeof window.SniparrSettings.applyTimezoneChange === 'function') {
            window.SniparrSettings.applyTimezoneChange(timezone);
        }
    },

    // Apply authentication mode change immediately
    applyAuthModeChange: function(authMode) {
        if (window.SniparrSettings && typeof window.SniparrSettings.applyAuthModeChange === 'function') {
            window.SniparrSettings.applyAuthModeChange(authMode);
        }
    },

    // Apply update checking change immediately
    applyUpdateCheckingChange: function(enabled) {
        if (window.SniparrSettings && typeof window.SniparrSettings.applyUpdateCheckingChange === 'function') {
            window.SniparrSettings.applyUpdateCheckingChange(enabled);
        }
    },

    applyShowTrendingChange: function(enabled) {
        if (window.SniparrSettings && typeof window.SniparrSettings.applyShowTrendingChange === 'function') {
            window.SniparrSettings.applyShowTrendingChange(enabled);
        }
    },

    // Refresh time displays after timezone change
    refreshTimeDisplays: function() {
        if (window.SniparrStateful) {
            window.SniparrStateful.refreshTimeDisplays();
        }
    },
    
    // Reset the app cycle for a specific app
    resetAppCycle: function(app, button) {
        // Make sure we have the app and button elements
        if (!app || !button) {
            console.error('[sniparrUI] Missing app or button for resetAppCycle');
            return;
        }
        
        // First, disable the button to prevent multiple clicks
        button.disabled = true;
        button.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Resetting...';
        
        // Per-instance reset for *arr apps (card has data-instance-name)
        const instanceName = button.getAttribute('data-instance-name');
        let endpoint = `./api/cycle/reset/${app}`;
        if (instanceName && app !== 'swaparr') {
            endpoint += '?instance_name=' + encodeURIComponent(instanceName);
        }
        
        SniparrUtils.fetchWithTimeout(endpoint, {
            method: 'POST'
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`Failed to reset ${app} cycle`);
            }
            return response.json();
        })
        .then(data => {
            this.showNotification(`Successfully reset ${this.capitalizeFirst(app)} cycle`, 'success');
            console.log(`[sniparrUI] Reset ${app} cycle response:`, data);
            
            // Re-enable the button with original text
            button.disabled = false;
            button.innerHTML = `<i class="fas fa-sync-alt"></i> Reset`;
        })
        .catch(error => {
            console.error(`[sniparrUI] Error resetting ${app} cycle:`, error);
            this.showNotification(`Error resetting ${this.capitalizeFirst(app)} cycle: ${error.message}`, 'error');
            
            // Re-enable the button with original text
            button.disabled = false;
            button.innerHTML = `<i class="fas fa-sync-alt"></i> Reset`;
        });
    },

    showDashboard: function() {
        if (window.SniparrDOM) {
            window.SniparrDOM.showDashboard();
        }
    },

    applyFilterToSingleEntry: function(logEntry, selectedLevel) {
        if (window.SniparrLogs) {
            window.SniparrLogs.applyFilterToSingleEntry(logEntry, selectedLevel);
        }
    },

    filterLogsByLevel: function(selectedLevel) {
        if (window.SniparrLogs) {
            window.SniparrLogs.filterLogsByLevel(selectedLevel);
        }
    },
    
    // Helper method to detect JSON fragments that shouldn't be displayed as log entries
    isJsonFragment: function(logString) {
        if (!logString || typeof logString !== 'string') return false;
        
        const trimmed = logString.trim();
        
        // Check for common JSON fragment patterns
        const jsonPatterns = [
            /^"[^"]*":\s*"[^"]*",?$/,           // "key": "value",
            /^"[^"]*":\s*\d+,?$/,                // "key": 123,
            /^"[^"]*":\s*true|false,?$/,         // "key": true,
            /^"[^"]*":\s*null,?$/,               // "key": null,
            /^"[^"]*":\s*\[[^\]]*\],?$/,         // "key": [...],
            /^"[^"]*":\s*\{[^}]*\},?$/,          // "key": {...},
            /^\s*\{?\s*$/,                       // Just opening brace or whitespace
            /^\s*\}?,?\s*$/,                     // Just closing brace
            /^\s*\[?\s*$/,                       // Just opening bracket
            /^\s*\]?,?\s*$/,                     // Just closing bracket
            /^,?\s*$/,                           // Just comma or whitespace
            /^[^"]*':\s*[^,]*,.*':/,          // Mid-object fragments like "g_items': 1, 'hunt_upgrade_items': 0"
            /^[a-zA-Z_][a-zA-Z0-9_]*':\s*\d+,/,  // Property names starting without quotes
            /^[a-zA-Z_][a-zA-Z0-9_]*':\s*True|False,/, // Boolean properties without opening quotes
            /^[a-zA-Z_][a-zA-Z0-9_]*':\s*'[^']*',/, // String properties without opening quotes
            /.*':\s*\d+,.*':\s*\d+,/,            // Multiple numeric properties in sequence
            /.*':\s*True,.*':\s*False,/,         // Multiple boolean properties in sequence
            /.*':\s*'[^']*',.*':\s*'[^']*',/,    // Multiple string properties in sequence
            /^"[^"]*":\s*\[$/,                   // JSON key with opening bracket: "global": [
            /^[a-zA-Z_][a-zA-Z0-9_\s]*:\s*\[$/,  // Property key with opening bracket: global: [
            /^[a-zA-Z_][a-zA-Z0-9_\s]*:\s*\{$/,  // Property key with opening brace: config: {
            /^[a-zA-Z_]+\s+(Mode|Setting|Config|Option):\s*(True|False|\d+)$/i, // Config fragments: "ug Mode: False"
            /^[a-zA-Z_]+\s*Mode:\s*(True|False)$/i, // Mode fragments: "Debug Mode: False"
            /^[a-zA-Z_]+\s*Setting:\s*.*$/i,     // Setting fragments
            /^[a-zA-Z_]+\s*Config:\s*.*$/i       // Config fragments
        ];
        
        return jsonPatterns.some(pattern => pattern.test(trimmed));
    },
    
    // Helper method to detect other invalid log lines
    isInvalidLogLine: function(logString) {
        if (!logString || typeof logString !== 'string') return true;
        
        const trimmed = logString.trim();
        
        // Skip empty lines or lines with only whitespace
        if (trimmed.length === 0) return true;
        
        // Skip lines that are clearly not log entries
        if (trimmed.length < 10) return true; // Too short to be a meaningful log
        
        // Skip lines that look like HTTP headers or other metadata
        if (/^(HTTP\/|Content-|Connection:|Host:|User-Agent:)/i.test(trimmed)) return true;
        
        // Skip partial words or fragments that don't form complete sentences
        if (/^[a-zA-Z]{1,5}\s+(Mode|Setting|Config|Debug|Info|Error|Warning):/i.test(trimmed)) return true;
        
        // Skip single words that are clearly fragments
        if (/^[a-zA-Z]{1,8}$/i.test(trimmed)) return true;
        
        // Skip lines that start with partial words and contain colons (config fragments)
        if (/^[a-z]{1,8}\s*[A-Z]/i.test(trimmed) && trimmed.includes(':')) return true;
        
        return false;
    },
    
    // Load instance-specific state management information
    loadInstanceStateInfo: function(appType, instanceIndex) {
        if (window.SniparrStateful) {
            window.SniparrStateful.loadInstanceStateInfo(appType, instanceIndex);
        }
    },
    
    // Update the instance state management display
    updateInstanceStateDisplay: function(appType, instanceIndex, summaryData, instanceName, customHours) {
        if (window.SniparrStateful) {
            window.SniparrStateful.updateInstanceStateDisplay(appType, instanceIndex, summaryData, instanceName, customHours);
        }
    },

    // Refresh state management timezone displays when timezone changes
    refreshStateManagementTimezone: function() {
        if (window.SniparrStateful) {
            window.SniparrStateful.refreshStateManagementTimezone();
        }
    },

    // Reload state management displays after timezone change
    reloadStateManagementDisplays: function() {
        if (window.SniparrStateful) {
            window.SniparrStateful.reloadStateManagementDisplays();
        }
    },

    // Load state management data for a specific instance
    loadStateManagementForInstance: function(appType, instanceIndex, instanceName) {
        if (window.SniparrStateful) {
            window.SniparrStateful.loadStateManagementForInstance(appType, instanceIndex, instanceName);
        }
    },

    setupMovieHuntNavigation: function() {
        if (window.SniparrNavigation && window.SniparrNavigation.setupMovieHuntNavigation) {
            window.SniparrNavigation.setupMovieHuntNavigation();
        }
    },

    setupTVHuntNavigation: function() {
        if (window.SniparrNavigation && window.SniparrNavigation.setupTVHuntNavigation) {
            window.SniparrNavigation.setupTVHuntNavigation();
        }
    },

    setupNzbHuntNavigation: function() {
        if (window.SniparrNavigation && window.SniparrNavigation.setupNzbHuntNavigation) {
            window.SniparrNavigation.setupNzbHuntNavigation();
        }
    },

    updateAppsSidebarActive: function() {
        if (window.SniparrNavigation) {
            window.SniparrNavigation.updateAppsSidebarActive();
        }
    },

    updateSettingsSidebarActive: function() {
        if (window.SniparrNavigation) {
            window.SniparrNavigation.updateSettingsSidebarActive();
        }
    },

    setupAppsNavigation: function() {
        if (window.SniparrNavigation) {
            window.SniparrNavigation.setupAppsNavigation();
        }
    },

    setupSettingsNavigation: function() {
        if (window.SniparrNavigation) {
            window.SniparrNavigation.setupSettingsNavigation();
        }
    },

    setupSystemNavigation: function() {
        if (window.SniparrNavigation && window.SniparrNavigation.setupSystemTabs) {
            window.SniparrNavigation.setupSystemTabs();
        }
    },

    initializeLogsSettings: function() {
        if (window.SniparrInit) {
            window.SniparrInit.initializeLogsSettings();
        }
    },

    initializeSettings: function() {
        if (window.SniparrInit) {
            window.SniparrInit.initializeSettings();
        }
    },

    initializeNotifications: function() {
        if (window.SniparrInit) {
            window.SniparrInit.initializeNotifications();
        }
    },

    initializeBackupRestore: function() {
        if (window.SniparrInit) {
            window.SniparrInit.initializeBackupRestore();
        }
    },

    initializeProwlarr: function() {
        if (window.SniparrInit) {
            window.SniparrInit.initializeProwlarr();
        }
    },

    initializeUser: function() {
        if (window.SniparrInit) {
            window.SniparrInit.initializeUser();
        }
    },

    initializeSwaparr: function() {
        if (window.SniparrInit) {
            window.SniparrInit.initializeSwaparr();
        }
    },

    loadSwaparrApps: function() {
        if (window.SniparrSwaparr) {
            window.SniparrSwaparr.loadSwaparrApps();
        }
    },

    setupProwlarrStatusPolling: function() { if (window.SniparrProwlarr) window.SniparrProwlarr.setupProwlarrStatusPolling(); },
    setupIndexerHuntHome: function() { if (window.SniparrIndexerHuntHome) window.SniparrIndexerHuntHome.setup(); },


};

// Note: redirectToSwaparr function removed - Swaparr now has its own dedicated section

// Initialize when document is ready
document.addEventListener('DOMContentLoaded', function() {
    // Initialize TMDB image cache first
    if (typeof tmdbImageCache !== 'undefined') {
        tmdbImageCache.init().catch(error => {
            console.error('[app.js] Failed to initialize TMDB image cache:', error);
        });
    }
    
    sniparrUI.init();
    
    // Initialize our enhanced UI features
    if (typeof StatsTooltips !== 'undefined') {
        StatsTooltips.init();
    }
    
    if (typeof CardHoverEffects !== 'undefined') {
        CardHoverEffects.init();
    }
    
    if (typeof CircularProgress !== 'undefined') {
        CircularProgress.init();
    }
    
    if (typeof BackgroundPattern !== 'undefined') {
        BackgroundPattern.init();
    }
    
    // Initialize per-instance reset button listeners
    if (typeof SettingsForms !== 'undefined' && typeof SettingsForms.setupInstanceResetListeners === 'function') {
        SettingsForms.setupInstanceResetListeners();
    }
    
    // Initialize UserModule when available (guard against duplicate construction)
    if (typeof UserModule !== 'undefined' && !window.userModule) {
        console.log('[sniparrUI] UserModule available, initializing...');
        window.userModule = new UserModule();
    }
});

// Expose sniparrUI to the global scope for access by app modules
window.sniparrUI = sniparrUI;

// Expose state management timezone refresh function globally for settings forms
window.refreshStateManagementTimezone = function() {
    if (window.sniparrUI && typeof window.sniparrUI.refreshStateManagementTimezone === 'function') {
        window.sniparrUI.refreshStateManagementTimezone();
    } else {
        console.warn('[sniparrUI] refreshStateManagementTimezone function not available');
    }
};
