
/* === modules/core/utils.js === */
/**
 * Sniparr - Utility Functions
 * Shared functions for use across the application
 */

// ── CSRF token helper ───────────────────────────────────────────────
// Reads the sniparr_csrf cookie that the server sets on login.
// The cookie is NOT HttpOnly so JS can read it here.
function _sniparrCsrfToken() {
    var match = document.cookie.match(/(?:^|;\s*)sniparr_csrf=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : null;
}

var _CSRF_METHODS = { POST: 1, PUT: 1, PATCH: 1, DELETE: 1 };

// ── Global fetch interceptor ────────────────────────────────────────
// 1. Injects X-CSRF-Token on all state-changing requests to same origin.
// 2. Redirects to login on any 401 from an internal API call.
(function() {
    if (window._sniparrFetchPatched) return;
    window._sniparrFetchPatched = true;
    var _origFetch = window.fetch;
    window.fetch = function(url, opts) {
        if (window._sniparrRedirectingToLogin) {
            return new Promise(function() {});
        }

        // Inject CSRF header for state-changing same-origin requests.
        var method = ((opts && opts.method) || 'GET').toUpperCase();
        if (_CSRF_METHODS[method]) {
            var urlStr = (typeof url === 'string') ? url : (url && url.url) || '';
            var isSameOrigin = !urlStr.startsWith('http') || urlStr.startsWith(window.location.origin);
            if (isSameOrigin) {
                var token = _sniparrCsrfToken();
                if (token) {
                    opts = opts ? Object.assign({}, opts) : {};
                    opts.headers = Object.assign({}, opts.headers, { 'X-CSRF-Token': token });
                }
            }
        }

        return _origFetch.call(this, url, opts).then(function(response) {
            if (response.status === 401) {
                var urlStr = (typeof url === 'string') ? url : (url && url.url) || '';
                var isApi = urlStr.indexOf('/api/') !== -1;
                var onLogin = window.location.pathname.indexOf('/login') !== -1;
                var onSetup = window.location.pathname.indexOf('/setup') !== -1;
                if (isApi && !onLogin && !onSetup && !window._sniparrRedirectingToLogin) {
                    window._sniparrRedirectingToLogin = true;
                    window.location.href = (window.SNIPARR_BASE_URL || window.SNIPARR_BASE_URL || '') + '/login';
                    return new Promise(function() {});
                }
            }
            return response;
        });
    };
})();

const SniparrUtils = {
    /**
     * Fetch with timeout (120s). Per-instance API timeouts are in app instances.
     * @param {string} url - The URL to fetch
     * @param {Object} options - Fetch options
     * @returns {Promise} - Fetch promise with timeout handling
     */
    fetchWithTimeout: function(url, options = {}) {
        // API timeout for fetch. Per-instance timeouts are in app instances.
        const apiTimeout = 120000; // 120 seconds in milliseconds
        
        // Create abort controller for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), apiTimeout);
        
        // Merge options with signal from AbortController
        // Only include credentials for internal API calls (not external URLs)
        const fetchOptions = {
            ...options,
            signal: controller.signal
        };
        
        // Add credentials only for internal API calls
        if (url && typeof url === 'string' && !url.startsWith('http') && !url.startsWith('//')) {
            fetchOptions.credentials = 'include';
        }
        
        // Process URL to handle base URL for reverse proxy subpaths
        // Always use absolute same-origin URL to avoid "Failed to fetch" on localhost/venv
        let processedUrl = url;
        
        // Only process internal API requests (not external URLs)
        if (url && typeof url === 'string' && !url.startsWith('http') && !url.startsWith('//')) {
            const baseUrl = window.SNIPARR_BASE_URL || '';
            let pathPart;
            if (baseUrl && !url.startsWith(baseUrl)) {
                let cleanPath = url.replace(/^\.\//, '');
                pathPart = cleanPath.startsWith('/') ? cleanPath : '/' + cleanPath;
                pathPart = baseUrl + pathPart;
            } else {
                pathPart = url;
            }
            // Build absolute URL using current origin (fixes localhost fetch failures)
            processedUrl = (typeof window !== 'undefined' && window.location && window.location.origin)
                ? (window.location.origin + (pathPart.startsWith('/') ? pathPart : '/' + pathPart))
                : pathPart;
        }
        
        return fetch(processedUrl, fetchOptions)
            .then(response => {
                clearTimeout(timeoutId);
                return response;
            })
            .catch(error => {
                clearTimeout(timeoutId);
                // Customize the error if it was a timeout
                if (error.name === 'AbortError') {
                    throw new Error(`Request timeout after ${apiTimeout / 1000} seconds`);
                }
                throw error;
            });
    },
    
    /**
     * API timeout in seconds for internal fetches. Per-instance timeouts are in app instances.
     * @returns {number} - API timeout in seconds
     */
    getApiTimeout: function() {
        return 120;
    },

    /**
     * Format date nicely for display
     * @param {Date|string} date - The date to format
     * @returns {string} - Formatted date string
     */
    formatDate: function (date) {
        if (!date) return "Never";
        
        const dateObj = typeof date === 'string' ? new Date(date) : date;
        if (isNaN(dateObj.getTime())) return "Invalid Date";

        const options = {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hour12: true,
        };

        return dateObj.toLocaleString("en-US", options);
    },

    /**
     * Convert seconds to readable format (e.g., "1 hour, 30 minutes")
     * @param {number} seconds - Total seconds
     * @returns {string} - Readable duration string
     */
    convertSecondsToReadable: function (seconds) {
        if (!seconds || seconds <= 0) return "0 seconds";

        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const remainingSeconds = seconds % 60;

        const parts = [];
        if (hours > 0) parts.push(`${hours} hour${hours > 1 ? "s" : ""}`);
        if (minutes > 0) parts.push(`${minutes} minute${minutes > 1 ? "s" : ""}`);
        if (remainingSeconds > 0 && hours === 0)
            parts.push(
                `${remainingSeconds} second${remainingSeconds > 1 ? "s" : ""}`
            );

        return parts.join(", ") || "0 seconds";
    },

    /**
     * Get a UI preference from the server-side general settings.
     * Uses sniparrUI.originalSettings.general as the source.
     */
    getUIPreference: function(key, defaultValue) {
        if (!window.sniparrUI || !window.sniparrUI.originalSettings || !window.sniparrUI.originalSettings.general) {
            return defaultValue;
        }
        const prefs = window.sniparrUI.originalSettings.general.ui_preferences || {};
        const value = prefs[key];
        return (value !== undefined) ? value : defaultValue;
    },

    /**
     * Set a UI preference in the server-side general settings.
     * Merges with existing preferences and auto-saves.
     */
    setUIPreference: function(key, value) {
        if (!window.sniparrUI || !window.sniparrUI.originalSettings || !window.sniparrUI.originalSettings.general) {
            console.warn('[SniparrUtils] Cannot set UI preference: sniparrUI.originalSettings not ready');
            return;
        }
        
        const prefs = window.sniparrUI.originalSettings.general.ui_preferences || {};
        prefs[key] = value;
        window.sniparrUI.originalSettings.general.ui_preferences = prefs;
        
        // Use FetchWithTimeout to save just the preferences (server merges them)
        this.fetchWithTimeout('./api/settings/general', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ui_preferences: prefs })
        }).catch(err => console.error('[SniparrUtils] Failed to save UI preference:', err));
    }
};

// If running in Node.js environment
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SniparrUtils;
}


/* === modules/core/helpers.js === */
/**
 * Utility Helpers Module
 * Common utility functions used across the application
 */

window.SniparrHelpers = {
    capitalizeFirst: function(string) {
        return string.charAt(0).toUpperCase() + string.slice(1);
    },

    cleanUrlString: function(url) {
        if (!url) return '';
        // Remove trailing slashes
        return url.replace(/\/+$/, '');
    },

    formatDateNicely: function(date) {
        if (!date) return 'N/A';
        
        const options = {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        };
        
        return new Date(date).toLocaleString('en-US', options);
    },

    getUserTimezone: function() {
        try {
            return Intl.DateTimeFormat().resolvedOptions().timeZone;
        } catch (e) {
            console.warn('Could not determine user timezone, using UTC');
            return 'UTC';
        }
    },

    parseLogTimestamp: function(logEntry) {
        if (!logEntry) return null;
        
        // Try to extract timestamp from various log formats
        const timestampPatterns = [
            /^\[([\d\-T:.]+)\]/,  // [2024-01-01T12:00:00.000]
            /^([\d\-T:.]+)\s/,     // 2024-01-01T12:00:00.000
            /^\[(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\]/  // [2024-01-01 12:00:00]
        ];
        
        for (const pattern of timestampPatterns) {
            const match = logEntry.match(pattern);
            if (match) {
                const timestamp = new Date(match[1]);
                if (!isNaN(timestamp.getTime())) {
                    return timestamp;
                }
            }
        }
        
        return null;
    },

    isJsonFragment: function(logString) {
        if (!logString || typeof logString !== 'string') return false;
        
        const trimmed = logString.trim();
        
        // Check for JSON object/array patterns
        if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
            (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
            try {
                JSON.parse(trimmed);
                return true;
            } catch (e) {
                return false;
            }
        }
        
        // Check for partial JSON patterns
        const jsonPatterns = [
            /^\s*[{[]/,           // Starts with { or [
            /[}\]]\s*$/,          // Ends with } or ]
            /:\s*[{[]/,           // Contains ": {" or ": ["
            /":\s*"[^"]*"\s*,/    // Contains key-value pairs
        ];
        
        return jsonPatterns.some(pattern => pattern.test(trimmed));
    },

    isInvalidLogLine: function(logString) {
        if (!logString || typeof logString !== 'string') return true;
        
        const trimmed = logString.trim();
        
        // Check for empty or whitespace-only
        if (trimmed.length === 0) return true;
        
        // Check for JSON fragments
        if (this.isJsonFragment(trimmed)) return true;
        
        // Check for common invalid patterns
        const invalidPatterns = [
            /^[\s\{\}\[\],:"]+$/,  // Only JSON syntax characters
            /^null$/i,              // Just "null"
            /^undefined$/i,         // Just "undefined"
            /^[\d.]+$/             // Just numbers
        ];
        
        return invalidPatterns.some(pattern => pattern.test(trimmed));
    },

    getConnectionErrorMessage: function(status) {
        const errorMessages = {
            0: 'Network error - Unable to reach server',
            400: 'Bad Request - Invalid API request',
            401: 'Unauthorized - Invalid API key',
            403: 'Forbidden - Access denied',
            404: 'Not Found - API endpoint not available',
            500: 'Internal Server Error',
            502: 'Bad Gateway - Server is unavailable',
            503: 'Service Unavailable - Server is temporarily down',
            504: 'Gateway Timeout - Server took too long to respond'
        };
        
        return errorMessages[status] || `HTTP Error ${status}`;
    },

    disconnectAllEventSources: function() {
        if (window.sniparrUI && window.sniparrUI.eventSources) {
            Object.keys(window.sniparrUI.eventSources).forEach(key => {
                const source = window.sniparrUI.eventSources[key];
                if (source && typeof source.close === 'function') {
                    source.close();
                }
            });
            window.sniparrUI.eventSources = {};
        }
    }
};


/* === modules/core/dom.js === */
/**
 * DOM Module
 * Handles element caching and low-level DOM utilities
 */

window.SniparrDOM = {
    cacheElements: function(ui) {
        if (!ui || !ui.elements) return;
        
        const elements = ui.elements;
        
        // Navigation
        elements.navItems = document.querySelectorAll('.nav-item');
        elements.homeNav = document.getElementById('homeNav');
        elements.logsNav = document.getElementById('logsNav');
        elements.huntManagerNav = document.getElementById('huntManagerNav');
        elements.settingsNav = document.getElementById('settingsNav');
        elements.userNav = document.getElementById('userNav');
        
        // Sections
        elements.sections = document.querySelectorAll('.content-section');
        elements.homeSection = document.getElementById('homeSection');
        elements.logsSection = document.getElementById('logsSection');
        elements.huntManagerSection = document.getElementById('huntManagerSection');
        elements.settingsSection = document.getElementById('settingsSection');
        elements.settingsLogsSection = document.getElementById('settingsLogsSection');
        elements.schedulingSection = document.getElementById('schedulingSection');
        
        // History dropdown elements
        elements.historyOptions = document.querySelectorAll('.history-option');
        elements.currentHistoryApp = document.getElementById('current-history-app');
        elements.historyDropdownBtn = document.querySelector('.history-dropdown-btn');
        elements.historyDropdownContent = document.querySelector('.history-dropdown-content');
        elements.historyPlaceholderText = document.getElementById('history-placeholder-text');
        
        // Settings dropdown elements
        elements.settingsOptions = document.querySelectorAll('.settings-option');
        elements.currentSettingsApp = document.getElementById('current-settings-app');
        elements.settingsDropdownBtn = document.querySelector('.settings-dropdown-btn');
        elements.settingsDropdownContent = document.querySelector('.settings-dropdown-content');
        
        elements.appSettingsPanels = document.querySelectorAll('.app-settings-panel');
        
        // Status elements
        elements.sonarrHomeStatus = document.getElementById('sonarrHomeStatus');
        elements.radarrHomeStatus = document.getElementById('radarrHomeStatus');
        elements.lidarrHomeStatus = document.getElementById('lidarrHomeStatus');
        elements.readarrHomeStatus = document.getElementById('readarrHomeStatus');
        elements.whisparrHomeStatus = document.getElementById('whisparrHomeStatus');
        elements.erosHomeStatus = document.getElementById('erosHomeStatus');
        // Actions
        elements.startHuntButton = document.getElementById('startHuntButton');
        elements.stopHuntButton = document.getElementById('stopHuntButton');
        
        // Logout
        elements.logoutLink = document.getElementById('logoutLink');
    },

    showDashboard: function() {
        // Make the dashboard grid visible after initialization to prevent FOUC
        const dashboardGrid = document.querySelector('.dashboard-grid');
        if (dashboardGrid) {
            dashboardGrid.style.opacity = '1';
            console.log('[SniparrDOM] Dashboard made visible after initialization');
        } else {
            console.warn('[SniparrDOM] Dashboard grid not found');
        }
    }
};


/* === modules/core/notifications.js === */
/**
 * Notifications Module
 * Handles UI notifications and alerts
 */

window.SniparrNotifications = {
    showNotification: function(message, type = 'info') {
        // Create a notification element
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        
        // Add to the document
        document.body.appendChild(notification);
        
        // Ensure any existing notification is removed first to prevent stacking
        const existingNotifications = document.querySelectorAll('.notification');
        existingNotifications.forEach(n => {
            if (n !== notification) {
                n.classList.remove('show');
                setTimeout(() => n.remove(), 300);
            }
        });
        
        // Fade in
        setTimeout(() => {
            notification.classList.add('show');
        }, 10);
        
        // Remove after a delay
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => {
                notification.remove();
            }, 300);
        }, 3000);
    }
};


/* === modules/core/confirm-modal.js === */
/**
 * Global confirm modal - purple/blue style. Replaces native confirm() for deletes & unsaved-changes.
 * Usage:
 *   SniparrConfirm.show({
 *       title: 'Delete ...',
 *       message: '...',
 *       confirmLabel: 'Delete',
 *       cancelLabel: 'Cancel',      // optional — relabels the cancel button
 *       onConfirm: function() { … },
 *       onCancel:  function() { … } // optional — called when cancel / X / backdrop / Escape
 *   });
 */
(function() {
    'use strict';

    function ensureModalInBody() {
        var modal = document.getElementById('sniparr-confirm-modal');
        if (modal && modal.parentNode !== document.body) {
            document.body.appendChild(modal);
        }
        return modal;
    }

    function closeModal() {
        var modal = document.getElementById('sniparr-confirm-modal');
        if (modal) modal.style.display = 'none';
        document.body.classList.remove('sniparr-confirm-modal-open');
    }

    window.SniparrConfirm = {
        show: function(options) {
            var opts = options || {};
            var title        = opts.title != null ? String(opts.title) : 'Confirm';
            var message      = opts.message != null ? String(opts.message) : '';
            var confirmLabel = opts.confirmLabel != null ? String(opts.confirmLabel) : 'OK';
            var cancelLabel  = opts.cancelLabel != null ? String(opts.cancelLabel) : 'Cancel';
            var onConfirm    = typeof opts.onConfirm === 'function' ? opts.onConfirm : function() {};
            var onCancel     = typeof opts.onCancel  === 'function' ? opts.onCancel  : function() {};

            var modal = ensureModalInBody();
            if (!modal) return;

            // --- populate text ------------------------------------------------
            var titleEl    = document.getElementById('sniparr-confirm-modal-title');
            var messageEl  = document.getElementById('sniparr-confirm-modal-message');
            var confirmBtn = document.getElementById('sniparr-confirm-modal-confirm');
            var cancelBtn  = document.getElementById('sniparr-confirm-modal-cancel');

            if (titleEl)    titleEl.textContent = title;
            if (messageEl)  messageEl.textContent = message;
            if (confirmBtn) confirmBtn.textContent = confirmLabel;
            if (cancelBtn)  cancelBtn.textContent  = cancelLabel;

            // --- bind handlers fresh every time -------------------------------
            // This avoids any stale-closure issues from a one-time initOnce().
            var handled = false;               // guard against double-fire

            function doCancel() {
                if (handled) return;
                handled = true;
                closeModal();
                onCancel();
            }

            function doConfirm() {
                if (handled) return;
                handled = true;
                closeModal();
                onConfirm();
            }

            var backdrop = document.getElementById('sniparr-confirm-modal-backdrop');
            var closeBtn = document.getElementById('sniparr-confirm-modal-close');

            if (backdrop)   backdrop.onclick = doCancel;
            if (closeBtn)   closeBtn.onclick = doCancel;
            if (cancelBtn)  cancelBtn.onclick = doCancel;
            if (confirmBtn) confirmBtn.onclick = doConfirm;

            // Escape key
            function onKeyDown(e) {
                if (e.key === 'Escape' && modal.style.display === 'flex') {
                    document.removeEventListener('keydown', onKeyDown);
                    doCancel();
                }
            }
            document.addEventListener('keydown', onKeyDown);

            // --- show ---------------------------------------------------------
            modal.style.display = 'flex';
            document.body.classList.add('sniparr-confirm-modal-open');
        }
    };
})();


/* === modules/core/navigation.js === */
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


/* === modules/core/theme.js === */
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


/* === modules/core/version.js === */
/**
 * Version & Info Module
 * Handles version checking, GitHub stars, and user info display
 */

window.SniparrVersion = {
    loadCurrentVersion: function() {
        SniparrUtils.fetchWithTimeout('./version.txt')
            .then(response => {
                if (!response.ok) {
                    throw new Error('Failed to load version.txt');
                }
                return response.text();
            })
            .then(version => {
                // Store in localStorage for sidebar footer display
                try {
                    const versionInfo = localStorage.getItem('sniparr-version-info') || '{}';
                    const parsedInfo = JSON.parse(versionInfo);
                    parsedInfo.currentVersion = version.trim();
                    localStorage.setItem('sniparr-version-info', JSON.stringify(parsedInfo));
                } catch (e) {
                    console.error('Error saving current version to localStorage:', e);
                }
            })
            .catch(error => {
                console.error('Error loading current version:', error);
            });
    },

    loadLatestVersion: function() {
        SniparrUtils.fetchWithTimeout('https://api.github.com/repos/mrjacobarussell/sniparr/releases/latest')
            .then(response => {
                if (!response.ok) {
                    if (response.status === 403) {
                        console.warn('GitHub API rate limit likely exceeded.');
                        throw new Error('Rate limited');
                    }
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                if (data && data.tag_name) {
                    // Store in localStorage for sidebar footer display
                    try {
                        const versionInfo = localStorage.getItem('sniparr-version-info') || '{}';
                        const parsedInfo = JSON.parse(versionInfo);
                        parsedInfo.latestVersion = data.tag_name;
                        localStorage.setItem('sniparr-version-info', JSON.stringify(parsedInfo));
                    } catch (e) {
                        console.error('Error saving latest version to localStorage:', e);
                    }
                }
            })
            .catch(error => {
                console.error('Error loading latest version from GitHub:', error);
            });
    },
    
    loadBetaVersion: function() {
        SniparrUtils.fetchWithTimeout('https://api.github.com/repos/mrjacobarussell/sniparr/tags?per_page=100')
            .then(response => {
                if (!response.ok) {
                    if (response.status === 403) {
                        console.warn('GitHub API rate limit likely exceeded.');
                        throw new Error('Rate limited');
                    }
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                const betaVersionElement = document.getElementById('beta-version-value');
                
                if (betaVersionElement && data && Array.isArray(data) && data.length > 0) {
                    // Find the first tag that starts with B (case insensitive)
                    const betaTag = data.find(tag => tag.name.toUpperCase().startsWith('B'));
                    
                    if (betaTag) {
                        betaVersionElement.textContent = betaTag.name;
                        try {
                            const versionInfo = localStorage.getItem('sniparr-version-info') || '{}';
                            const parsedInfo = JSON.parse(versionInfo);
                            parsedInfo.betaVersion = betaTag.name;
                            localStorage.setItem('sniparr-version-info', JSON.stringify(parsedInfo));
                        } catch (e) {
                            console.error('Error saving beta version to localStorage:', e);
                        }
                    } else {
                        betaVersionElement.textContent = 'None';
                    }
                } else if (betaVersionElement) {
                    betaVersionElement.textContent = 'N/A';
                }
            })
            .catch(error => {
                console.error('Error loading beta version from GitHub:', error);
                const betaVersionElement = document.getElementById('beta-version-value');
                if (betaVersionElement) {
                    betaVersionElement.textContent = error.message === 'Rate limited' ? 'Rate Limited' : 'Error';
                }
            });
    },

    loadGitHubStarCount: function() {
        const starsElement = document.getElementById('github-stars-value');
        if (!starsElement) return;
        
        // Try to load from cache first
        const cachedData = localStorage.getItem('sniparr-github-stars');
        if (cachedData) {
            try {
                const parsed = JSON.parse(cachedData);
                if (parsed.stars !== undefined) {
                    starsElement.textContent = parsed.stars.toLocaleString();
                    // If cache is recent (less than 1 hour), skip API call
                    const cacheAge = Date.now() - (parsed.timestamp || 0);
                    if (cacheAge < 3600000) {
                        return;
                    }
                }
            } catch (e) {
                console.warn('Invalid cached star data, will fetch fresh');
                localStorage.removeItem('sniparr-github-stars');
            }
        }
        
        // Set loading state
        starsElement.textContent = 'Loading...';
        
        SniparrUtils.fetchWithTimeout('https://api.github.com/repos/mrjacobarussell/sniparr')
            .then(response => {
                if (!response.ok) {
                    if (response.status === 403) {
                        throw new Error('Rate limited');
                    }
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                if (data.stargazers_count !== undefined) {
                    const stars = data.stargazers_count;
                    starsElement.textContent = stars.toLocaleString();
                    
                    // Cache the result
                    localStorage.setItem('sniparr-github-stars', JSON.stringify({
                        stars: stars,
                        timestamp: Date.now()
                    }));
                } else {
                    starsElement.textContent = 'N/A';
                }
            })
            .catch(error => {
                console.error('Error loading GitHub stars:', error);
                starsElement.textContent = error.message === 'Rate limited' ? 'Rate Limited' : 'Error';
            });
    },

    loadUsername: function() {
        SniparrUtils.fetchWithTimeout('./api/user/info')
            .then(response => {
                if (!response.ok) {
                    throw new Error('Failed to fetch user info');
                }
                return response.json();
            })
            .then(data => {
                const usernameElement = document.getElementById('username');
                if (usernameElement && data.username) {
                    usernameElement.textContent = data.username;
                    // Store username in localStorage for reference
                    localStorage.setItem('sniparr-username', data.username);
                }
                
                // Check local access bypass status after loading username
                if (window.SniparrAuth) {
                    window.SniparrAuth.checkLocalAccessBypassStatus();
                }
            })
            .catch(error => {
                console.error('Error loading username:', error);
                
                // Still check local access bypass status even if username loading failed
                if (window.SniparrAuth) {
                    window.SniparrAuth.checkLocalAccessBypassStatus();
                }
            });
    }
};


/* === modules/core/auth.js === */
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


/* === modules/core/ui-handlers.js === */
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


/* === modules/core/initialization.js === */
/**
 * Initialization Module
 * Handles dynamic loading and initialization of UI sections
 */

window.SniparrInit = {
    initializeLogsSettings: function() {
        console.log('[SniparrInit] initializeLogsSettings called');
        const container = document.getElementById('logsSettingsContainer');
        if (!container) return;
        
        const currentContent = container.innerHTML.trim();
        if (currentContent !== '' && !currentContent.includes('<!-- Content will be loaded here -->')) return;
        
        container.innerHTML = '<div class="loading-spinner" style="text-align: center; padding: 20px;"><i class="fas fa-circle-notch fa-spin"></i> Loading settings...</div>';
        
        SniparrUtils.fetchWithTimeout('./api/settings')
            .then(response => response.json())
            .then(settings => {
                if (window.sniparrUI) window.sniparrUI.originalSettings.general = settings.general;
                const generalSettings = settings.general || {};
                
                if (window.SettingsForms && typeof window.SettingsForms.generateLogsSettingsForm === 'function') {
                    container.innerHTML = '';
                    window.SettingsForms.generateLogsSettingsForm(container, generalSettings);
                } else {
                    container.innerHTML = '<p class="error-message">Error loading form generator.</p>';
                }
            })
            .catch(error => {
                console.error('[SniparrInit] Error loading settings for logs:', error);
                container.innerHTML = `<p class="error-message">Error: ${error.message}</p>`;
            });
    },

    initializeSettings: function() {
        console.log('[SniparrInit] initializeSettings called');
        const generalSettings = document.getElementById('generalSettings');
        if (!generalSettings) return;

        const currentContent = generalSettings.innerHTML.trim();
        if (currentContent !== '' && !currentContent.includes('<!-- Content will be loaded here -->')) return;

        fetch('./api/settings')
            .then(response => response.json())
            .then(settings => {
                if (window.sniparrUI) window.sniparrUI.originalSettings.general = settings.general;
                if (typeof SettingsForms !== 'undefined' && SettingsForms.generateGeneralForm) {
                    SettingsForms.generateGeneralForm(generalSettings, settings.general || {});
                } else {
                    generalSettings.innerHTML = '<p>Error: Settings forms not loaded</p>';
                }
            })
            .catch(error => {
                console.error('[SniparrInit] Error loading settings:', error);
                generalSettings.innerHTML = '<p>Error loading settings</p>';
            });
    },

    initializeNotifications: function() {
        console.log('[SniparrInit] initializeNotifications called');
        // New notification system initializes itself via generateNotificationsForm
        // which is called by the settings loader, or we can trigger it directly.
        if (typeof SettingsForms !== 'undefined' && SettingsForms.generateNotificationsForm) {
            var container = document.getElementById('notificationsSection');
            if (container) {
                SettingsForms.generateNotificationsForm(container, {});
            }
        }
    },

    initializeBackupRestore: function() {
        console.log('[SniparrInit] initializeBackupRestore called');
        if (typeof BackupRestore !== 'undefined') {
            BackupRestore.initialize();
        }
    },

    initializeProwlarr: function() {
        console.log('[SniparrInit] initializeProwlarr called');
        const prowlarrContainer = document.getElementById('prowlarrContainer');
        if (!prowlarrContainer) return;
        
        const currentContent = prowlarrContainer.innerHTML.trim();
        if (currentContent !== '' && !currentContent.includes('<!-- Prowlarr content will be loaded here -->')) return;

        fetch('./api/settings')
            .then(response => response.json())
            .then(settings => {
                if (window.sniparrUI) window.sniparrUI.originalSettings.prowlarr = settings.prowlarr;
                if (typeof SettingsForms !== 'undefined' && SettingsForms.generateProwlarrForm) {
                    SettingsForms.generateProwlarrForm(prowlarrContainer, settings.prowlarr || {});
                } else {
                    prowlarrContainer.innerHTML = '<p>Error: Prowlarr forms not loaded</p>';
                }
            })
            .catch(error => {
                console.error('[SniparrInit] Error loading prowlarr settings:', error);
                prowlarrContainer.innerHTML = '<p>Error loading prowlarr settings</p>';
            });
    },

    initializeUser: function() {
        console.log('[SniparrInit] initializeUser called');
        if (typeof UserModule !== 'undefined') {
            if (!window.userModule) {
                window.userModule = new UserModule();
            }
        }
    },

    initializeSwaparr: function() {
        console.log('[SniparrInit] initializeSwaparr called');
        const swaparrContainer = document.getElementById('swaparrContainer');
        if (!swaparrContainer) return;
        
        const currentContent = swaparrContainer.innerHTML.trim();
        if (currentContent !== '' && !currentContent.includes('<!-- Swaparr settings content will be shown here -->')) return;

        fetch('./api/swaparr/settings')
            .then(response => response.json())
            .then(settings => {
                if (window.sniparrUI) window.sniparrUI.originalSettings.swaparr = settings;
                if (typeof SettingsForms !== 'undefined' && SettingsForms.generateSwaparrForm) {
                    SettingsForms.generateSwaparrForm(swaparrContainer, settings || {});
                    if (window.sniparrUI && window.sniparrUI.loadSwaparrApps) window.sniparrUI.loadSwaparrApps();
                } else {
                    swaparrContainer.innerHTML = '<p>Error: Swaparr forms not loaded</p>';
                }
            })
            .catch(error => {
                console.error('[SniparrInit] Error loading Swaparr settings:', error);
                swaparrContainer.innerHTML = '<p>Error loading Swaparr settings</p>';
            });
    }
};
