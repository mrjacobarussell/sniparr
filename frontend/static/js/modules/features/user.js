class UserModule {
    constructor() {
        this.initializeEventListeners();
        this.loadUserData();
    }

    initializeEventListeners() {
        // Username change
        document.getElementById('saveUsername').addEventListener('click', () => this.saveUsername());
        
        // Password change
        document.getElementById('savePassword').addEventListener('click', () => this.savePassword());
        
        // Two-Factor Authentication
        document.getElementById('enableTwoFactor').addEventListener('click', () => this.enableTwoFactor());
        document.getElementById('verifyTwoFactor').addEventListener('click', () => this.verifyTwoFactor());
        document.getElementById('disableTwoFactor').addEventListener('click', () => this.disableTwoFactor());
        
        // Recovery Key
        document.getElementById('generateRecoveryKey').addEventListener('click', () => this.generateRecoveryKey());
        document.getElementById('copyRecoveryKey').addEventListener('click', () => this.copyRecoveryKey());

        // Copy buttons for secret keys
        document.querySelectorAll('.copy-button').forEach(button => {
            if (button.id !== 'copyRecoveryKey') {
                button.addEventListener('click', (e) => this.copySecretKey(e));
            }
        });
    }

    async loadUserData() {
        try {
            // Load user info
            const userResponse = await fetch('./api/user/info', { credentials: 'include' });
            if (!userResponse.ok) throw new Error('Failed to fetch user data');
            
            const userData = await userResponse.json();
            
            // Update username
            document.getElementById('currentUsername').textContent = userData.username || 'Unknown';
            
            // Update 2FA status
            this.update2FAStatus(userData.is_2fa_enabled);

        } catch (error) {
            console.error('Error loading user data:', error);
        }
    }

    async saveUsername() {
        const newUsername = document.getElementById('newUsername').value.trim();
        const currentPassword = document.getElementById('currentPasswordForUsernameChange').value;
        const statusElement = document.getElementById('usernameStatus');

        if (!newUsername || !currentPassword) {
            this.showStatus(statusElement, 'Please fill in all fields', 'error');
            return;
        }

        try {
            const response = await fetch('./api/user/change-username', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    username: newUsername,
                    password: currentPassword
                })
            });

            const result = await response.json();

            if (response.ok) {
                this.showStatus(statusElement, 'Username updated successfully!', 'success');
                document.getElementById('currentUsername').textContent = newUsername;
                document.getElementById('newUsername').value = '';
                document.getElementById('currentPasswordForUsernameChange').value = '';
            } else {
                this.showStatus(statusElement, result.error || 'Failed to update username', 'error');
            }
        } catch (error) {
            this.showStatus(statusElement, 'Error updating username', 'error');
        }
    }

    async savePassword() {
        const currentPassword = document.getElementById('currentPassword').value;
        const newPassword = document.getElementById('newPassword').value;
        const confirmPassword = document.getElementById('confirmPassword').value;
        const statusElement = document.getElementById('passwordStatus');

        if (!currentPassword || !newPassword || !confirmPassword) {
            this.showStatus(statusElement, 'Please fill in all fields', 'error');
            return;
        }

        if (newPassword !== confirmPassword) {
            this.showStatus(statusElement, 'New passwords do not match', 'error');
            return;
        }

        if (newPassword.length < 6) {
            this.showStatus(statusElement, 'Password must be at least 6 characters long', 'error');
            return;
        }

        try {
            const response = await fetch('./api/user/change-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    current_password: currentPassword,
                    new_password: newPassword
                })
            });

            const result = await response.json();

            if (response.ok) {
                this.showStatus(statusElement, 'Password updated successfully!', 'success');
                document.getElementById('currentPassword').value = '';
                document.getElementById('newPassword').value = '';
                document.getElementById('confirmPassword').value = '';
            } else {
                this.showStatus(statusElement, result.error || 'Failed to update password', 'error');
            }
        } catch (error) {
            this.showStatus(statusElement, 'Error updating password', 'error');
        }
    }

    async enableTwoFactor() {
        try {
            const response = await fetch('./api/user/2fa/setup', { 
                method: 'POST',
                credentials: 'include'
            });
            const result = await response.json();

            if (response.ok) {
                document.getElementById('qrCode').src = result.qr_code_url;
                document.getElementById('secretKey').textContent = result.secret;
                
                document.getElementById('enableTwoFactorSection').style.display = 'none';
                document.getElementById('setupTwoFactorSection').style.display = 'block';
            } else {
                console.error('Failed to setup 2FA:', result.error);
            }
        } catch (error) {
            console.error('Error setting up 2FA:', error);
        }
    }

    async verifyTwoFactor() {
        const code = document.getElementById('verificationCode').value.trim();
        const statusElement = document.getElementById('verifyStatus');

        if (!code || code.length !== 6) {
            this.showStatus(statusElement, 'Please enter a valid 6-digit code', 'error');
            return;
        }

        try {
            const response = await fetch('./api/user/2fa/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ code })
            });

            const result = await response.json();

            if (response.ok) {
                this.showStatus(statusElement, '2FA enabled successfully!', 'success');
                setTimeout(() => {
                    this.update2FAStatus(true);
                    document.getElementById('verificationCode').value = '';
                }, 1500);
            } else {
                this.showStatus(statusElement, result.error || 'Invalid verification code', 'error');
            }
        } catch (error) {
            this.showStatus(statusElement, 'Error verifying 2FA code', 'error');
        }
    }

    async disableTwoFactor() {
        const password = document.getElementById('currentPasswordFor2FADisable').value;
        const otpCode = document.getElementById('otpCodeFor2FADisable').value.trim();
        const statusElement = document.getElementById('disableStatus');

        if (!password || !otpCode) {
            this.showStatus(statusElement, 'Please fill in all fields', 'error');
            return;
        }

        try {
            const response = await fetch('./api/user/2fa/disable', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    password: password,
                    code: otpCode
                })
            });

            const result = await response.json();

            if (response.ok) {
                this.showStatus(statusElement, '2FA disabled successfully!', 'success');
                setTimeout(() => {
                    this.update2FAStatus(false);
                    document.getElementById('currentPasswordFor2FADisable').value = '';
                    document.getElementById('otpCodeFor2FADisable').value = '';
                }, 1500);
            } else {
                this.showStatus(statusElement, result.error || 'Failed to disable 2FA', 'error');
            }
        } catch (error) {
            this.showStatus(statusElement, 'Error disabling 2FA', 'error');
        }
    }

    async generateRecoveryKey() {
        const password = document.getElementById('currentPasswordForRecovery').value;
        const twoFactorCode = document.getElementById('recoveryTwoFactorCode').value.trim();
        const statusElement = document.getElementById('recoveryStatus');

        if (!password) {
            this.showStatus(statusElement, 'Please enter your current password', 'error');
            return;
        }

        // Check if 2FA is enabled and require code
        const twoFactorElement = document.getElementById('twoFactorEnabled');
        const twoFactorEnabled = twoFactorElement && twoFactorElement.textContent.trim() === 'Enabled';
        if (twoFactorEnabled && !twoFactorCode) {
            this.showStatus(statusElement, 'Please enter your 2FA code', 'error');
            return;
        }

        try {
            const requestBody = { password };
            if (twoFactorEnabled) {
                requestBody.two_factor_code = twoFactorCode;
            }

            const response = await fetch('./auth/recovery-key/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });

            const result = await response.json();

            if (response.ok) {
                document.getElementById('recoveryKeyValue').textContent = result.recovery_key;
                document.getElementById('recoveryKeyDisplay').style.display = 'block';
                this.showStatus(statusElement, 'Recovery key generated successfully!', 'success');
                
                // Clear form
                document.getElementById('currentPasswordForRecovery').value = '';
                document.getElementById('recoveryTwoFactorCode').value = '';
                
                // Auto-hide after 5 minutes
                setTimeout(() => {
                    document.getElementById('recoveryKeyDisplay').style.display = 'none';
                }, 300000);
            } else {
                this.showStatus(statusElement, result.error || 'Failed to generate recovery key', 'error');
            }
        } catch (error) {
            this.showStatus(statusElement, 'Error generating recovery key', 'error');
        }
    }

    _copyToClipboard(text, button) {
        function showCopied() {
            var originalText = button.textContent;
            button.textContent = 'Copied!';
            button.classList.add('copied');
            setTimeout(function() {
                button.textContent = originalText;
                button.classList.remove('copied');
            }, 2000);
        }
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(text).then(showCopied).catch(function() {
                fallbackCopy(text, showCopied);
            });
        } else {
            fallbackCopy(text, showCopied);
        }
        function fallbackCopy(val, onSuccess) {
            var ta = document.createElement('textarea');
            ta.value = val;
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); if (onSuccess) onSuccess(); } catch (e) {}
            document.body.removeChild(ta);
        }
    }

    copyRecoveryKey() {
        var recoveryKey = document.getElementById('recoveryKeyValue').textContent;
        var button = document.getElementById('copyRecoveryKey');
        this._copyToClipboard(recoveryKey, button);
    }

    copySecretKey(event) {
        var secretKey = document.getElementById('secretKey').textContent;
        var button = event.target;
        this._copyToClipboard(secretKey, button);
    }

    update2FAStatus(enabled) {
        const statusBadge = document.getElementById('twoFactorEnabled');
        const enableSection = document.getElementById('enableTwoFactorSection');
        const setupSection = document.getElementById('setupTwoFactorSection');
        const disableSection = document.getElementById('disableTwoFactorSection');
        const recoverySection = document.getElementById('recoveryTwoFactorSection');

        statusBadge.style.display = 'inline-block';

        if (enabled) {
            statusBadge.textContent = 'Enabled';
            statusBadge.className = 'status-badge enabled';
            
            enableSection.style.display = 'none';
            setupSection.style.display = 'none';
            disableSection.style.display = 'block';
            recoverySection.style.display = 'block';
        } else {
            statusBadge.textContent = 'Disabled';
            statusBadge.className = 'status-badge disabled';
            
            enableSection.style.display = 'block';
            setupSection.style.display = 'none';
            disableSection.style.display = 'none';
            recoverySection.style.display = 'none';
        }
    }

    showStatus(element, message, type) {
        // Cancel any previous hide timeout for this element
        if (element._statusTimeout) {
            clearTimeout(element._statusTimeout);
        }
        element.textContent = message;
        element.className = `status-message ${type}`;
        element.style.display = 'block';
        
        element._statusTimeout = setTimeout(() => {
            element.style.display = 'none';
            element._statusTimeout = null;
        }, 5000);
    }
}

// Export for use in main application
window.UserModule = UserModule; 