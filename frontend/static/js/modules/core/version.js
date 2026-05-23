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
