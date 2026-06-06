
/* === modules/features/indexer-hunt.js === */
/**
 * Indexer Hunt — Centralized indexer management module.
 * Full-page editor (no modal), card grid list.
 */
(function() {
    'use strict';

    var _indexers = [];
    var _presets = [];
    var _editingId = null;
    var _initialized = false;

    var IH = window.IndexerHunt = {};

    // ── Initialization ────────────────────────────────────────────────

    function _updateSetupWizardBanner() {
        var banner = document.getElementById('indexer-setup-wizard-continue-banner');
        var callout = document.getElementById('indexer-instance-setup-callout');
        // Show if user navigated here from the setup wizard.
        // Don't remove the flag — it needs to persist across re-renders during the wizard flow.
        var fromWizard = false;
        try { fromWizard = sessionStorage.getItem('setup-wizard-active-nav') === '1'; } catch (e) {}
        if (banner) banner.style.display = fromWizard ? 'flex' : 'none';
        if (callout) callout.style.display = fromWizard ? 'flex' : 'none';
    }

    // ── Instance indexer status checklist ────────────────────────────
    function _refreshIndexerInstanceStatus() {
        var gridEl = document.getElementById('indexer-instance-status-grid');
        var statusArea = document.getElementById('indexer-instance-status-area');
        if (!gridEl) return;
        gridEl.innerHTML = '<div style="padding: 12px; color: #94a3b8;"><i class="fas fa-spinner fa-spin"></i> Checking instances...</div>';
        var ts = '?t=' + Date.now();
        Promise.all([
            fetch('./api/movie-snipe/instances' + ts, { cache: 'no-store' }).then(function(r) { return r.json(); }),
            fetch('./api/tv-snipe/instances' + ts, { cache: 'no-store' }).then(function(r) { return r.json(); })
        ]).then(function(results) {
            var movieInstances = (results[0].instances || []).map(function(i) { return { value: 'movie:' + i.id, label: 'Movie - ' + (i.name || 'Instance ' + i.id), id: i.id, type: 'movie' }; });
            var tvInstances = (results[1].instances || []).map(function(i) { return { value: 'tv:' + i.id, label: 'TV - ' + (i.name || 'Instance ' + i.id), id: i.id, type: 'tv' }; });
            var all = movieInstances.concat(tvInstances);
            if (all.length === 0) {
                gridEl.innerHTML = '';
                if (statusArea) statusArea.style.display = 'none';
                return;
            }
            var fetches = all.map(function(inst) {
                var url = inst.type === 'tv' ? './api/tv-snipe/indexers' : './api/indexers';
                url += '?instance_id=' + encodeURIComponent(inst.id) + '&t=' + Date.now();
                return fetch(url, { cache: 'no-store' }).then(function(r) { return r.json(); }).then(function(d) {
                    var indexers = d.indexers || [];
                    return { label: inst.label, value: inst.value, hasIndexers: indexers.length > 0 };
                }).catch(function() {
                    return { label: inst.label, value: inst.value, hasIndexers: false };
                });
            });
            Promise.all(fetches).then(function(statuses) {
                var allGood = statuses.every(function(s) { return s.hasIndexers; });
                // Hide the status area if all instances have indexers
                if (allGood) {
                    gridEl.innerHTML = '';
                    if (statusArea) statusArea.style.display = 'none';
                    return;
                }
                if (statusArea) statusArea.style.display = 'block';
                var html = '';
                for (var i = 0; i < statuses.length; i++) {
                    var s = statuses[i];
                    var cardClass = s.hasIndexers ? 'instance-complete' : 'instance-not-setup';
                    var iconClass = s.hasIndexers ? 'fa-check-circle' : 'fa-search-plus';
                    var badgeText = s.hasIndexers ? 'Indexers Assigned' : 'No Indexers';
                    var nameEsc = (s.label || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
                    html += '<div class="root-folders-instance-status-card ' + cardClass + '" data-value="' + (s.value || '').replace(/"/g, '&quot;') + '">' +
                        '<div class="instance-status-icon"><i class="fas ' + iconClass + '" aria-hidden="true"></i></div>' +
                        '<div class="instance-status-body">' +
                        '<div class="instance-status-name">' + nameEsc + '</div>' +
                        '<span class="instance-status-badge">' + badgeText + '</span>' +
                        '</div></div>';
                }
                gridEl.innerHTML = html;
                // Click to switch instance dropdown
                gridEl.querySelectorAll('.root-folders-instance-status-card').forEach(function(card) {
                    var val = card.getAttribute('data-value');
                    if (val) {
                        card.style.cursor = 'pointer';
                        card.addEventListener('click', function() {
                            var sel = document.getElementById('settings-indexers-instance-select');
                            if (sel && val) {
                                sel.value = val;
                                sel.dispatchEvent(new Event('change'));
                            }
                        });
                    }
                });
            });
        }).catch(function() {
            gridEl.innerHTML = '';
            if (statusArea) statusArea.style.display = 'none';
        });
    }
    // Expose for refresh after import/delete
    IH._refreshIndexerInstanceStatus = _refreshIndexerInstanceStatus;

    IH.init = function() {
        var searchInput = document.getElementById('ih-search-input');
        if (searchInput) searchInput.value = '';
        if (!_initialized) {
            _bindEvents();
            _initialized = true;
        }
        _updateSetupWizardBanner();
        var noInstEl = document.getElementById('indexer-snipe-no-instances');
        var wrapperEl = document.getElementById('indexer-snipe-content-wrapper');
        Promise.all([
            fetch('./api/movie-snipe/instances', { cache: 'no-store' }).then(function(r) { return r.json(); }),
            fetch('./api/tv-snipe/instances', { cache: 'no-store' }).then(function(r) { return r.json(); })
        ]).then(function(results) {
            var movieCount = (results[0].instances || []).length;
            var tvCount = (results[1].instances || []).length;
            if (movieCount === 0 && tvCount === 0) {
                if (noInstEl) noInstEl.style.display = '';
                if (wrapperEl) wrapperEl.style.display = 'none';
                return;
            }
            if (noInstEl) noInstEl.style.display = 'none';
            if (wrapperEl) wrapperEl.style.display = '';
            _showListView();
            _loadPresets(function() {
                _loadIndexers();
            });
            _refreshIndexerInstanceStatus();
        }).catch(function() {
            if (noInstEl) noInstEl.style.display = 'none';
            if (wrapperEl) wrapperEl.style.display = '';
            _showListView();
            _loadPresets(function() {
                _loadIndexers();
            });
            _refreshIndexerInstanceStatus();
        });
    };

    function _bindEvents() {
        _on('ih-add-btn', 'click', function() { _openEditor(null); });
        _on('ih-empty-add-btn', 'click', function() { _openEditor(null); });
        _on('ih-editor-back', 'click', function() { _showListView(); });
        _on('ih-editor-save', 'click', _saveForm);
        _on('ih-search-input', 'input', function() { _renderCards(); });
        _on('ih-form-preset', 'change', _onPresetChange);

        // "Import from Index Master" card: show select list (ih-import-panel)
        var wrapper = document.getElementById('indexer-snipe-content-wrapper');
        if (wrapper) {
            wrapper.addEventListener('click', function(e) {
                var card = e.target.closest('.add-instance-card[data-source="indexer-hunt"]');
                if (card) {
                    e.preventDefault();
                    e.stopPropagation();
                    _openIHImportPanel();
                }
            });
            // Edit/Delete on instance indexer cards (capture so we handle before other listeners)
            wrapper.addEventListener('click', _onInstanceIndexerCardClick, true);
        }
        var cancelBtn = document.getElementById('ih-import-cancel');
        if (cancelBtn) cancelBtn.addEventListener('click', _closeIHImportPanel);
        var confirmBtn = document.getElementById('ih-import-confirm');
        if (confirmBtn) confirmBtn.addEventListener('click', _confirmIHImport);
    }

    function _getInstanceIdAndMode() {
        var sel = document.getElementById('settings-indexers-instance-select');
        var val = (sel && sel.value) ? sel.value.trim() : '';
        if (!val) return { instanceId: 1, mode: 'movie' };
        var parts = val.split(':');
        if (parts.length === 2) {
            var mode = parts[0] === 'tv' ? 'tv' : 'movie';
            var id = parseInt(parts[1], 10);
            return { instanceId: isNaN(id) ? 1 : id, mode: mode };
        }
        return { instanceId: 1, mode: 'movie' };
    }

    function _openIHImportPanel() {
        var panel = document.getElementById('ih-import-panel');
        var list = document.getElementById('ih-import-list');
        var actions = document.getElementById('ih-import-actions');
        if (panel) panel.style.display = 'block';
        if (list) list.innerHTML = '<div style="color: #94a3b8; padding: 20px; text-align: center;"><i class="fas fa-spinner fa-spin"></i> Loading available indexers...</div>';
        if (actions) actions.style.display = 'none';

        var par = _getInstanceIdAndMode();
        var url = './api/indexer-snipe/available/' + par.instanceId + '?mode=' + encodeURIComponent(par.mode);

        fetch(url)
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var available = data.available || [];
                if (available.length === 0) {
                    if (list) list.innerHTML = '<div class="ih-import-empty"><i class="fas fa-check-circle" style="color: #10b981; margin-right: 6px;"></i>All Index Master indexers are already imported to this instance.</div>';
                    return;
                }
                var html = '';
                available.forEach(function(idx) {
                    var keyDisplay = idx.api_key_last4 ? '\u2022\u2022\u2022\u2022' + _esc(idx.api_key_last4) : 'No key';
                    html += '<div class="ih-import-item" data-ih-id="' + idx.id + '">'
                        + '<div class="ih-import-checkbox"><i class="fas fa-check"></i></div>'
                        + '<div class="ih-import-info">'
                            + '<div class="ih-import-name">' + _esc(idx.name) + '</div>'
                            + '<div class="ih-import-meta">'
                                + '<span><i class="fas fa-globe"></i> ' + _esc(idx.url || 'N/A') + '</span>'
                                + '<span><i class="fas fa-sort-amount-up"></i> Priority: ' + (idx.priority || 50) + '</span>'
                                + '<span><i class="fas fa-key"></i> ' + keyDisplay + '</span>'
                            + '</div>'
                        + '</div>'
                    + '</div>';
                });
                if (list) list.innerHTML = html;
                if (actions) actions.style.display = 'flex';

                var items = list.querySelectorAll('.ih-import-item');
                items.forEach(function(item) {
                    item.addEventListener('click', function() {
                        item.classList.toggle('selected');
                        _updateIHImportButton();
                    });
                });
            })
            .catch(function(err) {
                if (list) list.innerHTML = '<div class="ih-import-empty">Failed to load available indexers.</div>';
            });
    }

    function _closeIHImportPanel() {
        var panel = document.getElementById('ih-import-panel');
        if (panel) panel.style.display = 'none';
    }

    function _onInstanceIndexerCardClick(e) {
        var grid = e.target.closest('#indexer-instances-grid-unified');
        if (!grid || !grid.closest('#indexer-snipe-section')) return;
        var editBtn = e.target.closest('.btn-card.edit[data-app-type="indexer"]');
        var deleteBtn = e.target.closest('.btn-card.delete[data-app-type="indexer"]');
        if (editBtn) {
            e.preventDefault();
            e.stopPropagation();
            var card = editBtn.closest('.instance-card');
            if (!card) return;
            var index = parseInt(card.getAttribute('data-instance-index'), 10);
            if (isNaN(index)) return;
            var list = window.SettingsForms && window.SettingsForms._indexersList;
            if (!list || index < 0 || index >= list.length) return;
            if (window.SettingsForms && window.SettingsForms.openIndexerEditor) {
                window.SettingsForms.openIndexerEditor(false, index, list[index]);
            }
            return;
        }
        if (deleteBtn) {
            e.preventDefault();
            e.stopPropagation();
            var card = deleteBtn.closest('.instance-card');
            if (!card) return;
            var index = parseInt(card.getAttribute('data-instance-index'), 10);
            if (isNaN(index)) return;
            var list = window.SettingsForms && window.SettingsForms._indexersList;
            if (!list || index < 0 || index >= list.length) return;
            var indexer = list[index];
            var name = (indexer && indexer.name) ? indexer.name : 'Unnamed';
            var Forms = window.SettingsForms;
            var isTV = Forms._indexersMode === 'tv';
            var deleteId = isTV && indexer && indexer.id ? indexer.id : index;
            if (window.SniparrConfirm && window.SniparrConfirm.show) {
                window.SniparrConfirm.show({
                    title: 'Delete Indexer',
                    message: 'Are you sure you want to remove "' + name + '" from this instance? It will no longer be used for searches and will be removed from Index Master tracking for this instance.',
                    confirmLabel: 'Delete',
                    onConfirm: function() {
                        var apiBase = Forms.getIndexersApiBase();
                        var url = apiBase + '/' + encodeURIComponent(String(deleteId));
                        fetch(url, { method: 'DELETE' })
                            .then(function(r) { return r.json(); })
                            .then(function(data) {
                                if (data.success !== false) {
                                    if (window.SettingsForms && window.SettingsForms.refreshIndexersList) {
                                        window.SettingsForms.refreshIndexersList();
                                    }
                                    if (window.sniparrUI && window.sniparrUI.showNotification) {
                                        window.sniparrUI.showNotification('Indexer removed.', 'success');
                                    }
                                    _refreshIndexerInstanceStatus();
                                } else {
                                    if (window.sniparrUI && window.sniparrUI.showNotification) {
                                        window.sniparrUI.showNotification(data.error || 'Failed to remove indexer.', 'error');
                                    }
                                }
                            })
                            .catch(function() {
                                if (window.sniparrUI && window.sniparrUI.showNotification) {
                                    window.sniparrUI.showNotification('Failed to remove indexer.', 'error');
                                }
                            });
                    }
                });
            }
        }
    }

    function _updateIHImportButton() {
        var selected = document.querySelectorAll('#ih-import-list .ih-import-item.selected');
        var btn = document.getElementById('ih-import-confirm');
        if (btn) {
            btn.disabled = selected.length === 0;
            btn.innerHTML = '<i class="fas fa-download"></i> Import Selected (' + selected.length + ')';
        }
    }

    function _confirmIHImport() {
        var selected = document.querySelectorAll('#ih-import-list .ih-import-item.selected');
        if (selected.length === 0) return;

        var ids = [];
        selected.forEach(function(item) {
            ids.push(item.getAttribute('data-ih-id'));
        });
        var par = _getInstanceIdAndMode();

        var btn = document.getElementById('ih-import-confirm');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Importing...'; }

        fetch('./api/indexer-snipe/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ instance_id: par.instanceId, mode: par.mode, indexer_ids: ids }),
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.success) {
                var msg = 'Imported ' + (data.added || 0) + ' indexer(s) from Index Master.';
                if (window.sniparrUI) window.sniparrUI.showNotification(msg, 'success');
                _closeIHImportPanel();
                if (window.SettingsForms && window.SettingsForms.refreshIndexersList) {
                    window.SettingsForms.refreshIndexersList();
                }
                _refreshIndexerInstanceStatus();
            } else {
                if (window.sniparrUI) window.sniparrUI.showNotification(data.error || 'Import failed.', 'error');
            }
        })
        .catch(function(err) {
            if (window.sniparrUI) window.sniparrUI.showNotification('Import error.', 'error');
        })
        .finally(function() {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-download"></i> Import Selected'; }
        });
    }

    function _on(id, event, fn) {
        var el = document.getElementById(id);
        if (el) el.addEventListener(event, fn);
    }

    // ── View switching ─────────────────────────────────────────────────

    function _showListView() {
        var list = document.getElementById('ih-list-view');
        var editor = document.getElementById('ih-editor-view');
        if (list) list.style.display = '';
        if (editor) editor.style.display = 'none';
        _editingId = null;
    }

    function _showEditorView() {
        var list = document.getElementById('ih-list-view');
        var editor = document.getElementById('ih-editor-view');
        if (list) list.style.display = 'none';
        if (editor) editor.style.display = '';
        // Anchor editor into view so user doesn't have to scroll down
        if (editor) {
            editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }

    // ── Data loading ──────────────────────────────────────────────────

    function _loadPresets(cb) {
        fetch('./api/indexer-snipe/presets')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                _presets = data.presets || [];
                _populatePresetDropdown();
                if (cb) cb();
            })
            .catch(function() { if (cb) cb(); });
    }

    function _loadIndexers() {
        fetch('./api/indexer-snipe/indexers')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                _indexers = data.indexers || [];
                _renderCards();
            })
            .catch(function(err) {
                console.error('[IndexerHunt] Load error:', err);
            });
    }

    function _populatePresetDropdown() {
        var sel = document.getElementById('ih-form-preset');
        if (!sel) return;
        sel.innerHTML = '<option value="manual">Custom (Manual)</option>';
        _presets.forEach(function(p) {
            var opt = document.createElement('option');
            opt.value = p.key;
            opt.textContent = p.name;
            sel.appendChild(opt);
        });
    }

    // ── Card rendering ─────────────────────────────────────────────────

    function _renderCards() {
        var grid = document.getElementById('ih-card-grid');
        var empty = document.getElementById('ih-empty-state');
        if (!grid) return;

        var query = (document.getElementById('ih-search-input') || {}).value || '';
        query = query.toLowerCase().trim();

        var filtered = _indexers;
        if (query) {
            filtered = _indexers.filter(function(idx) {
                return (idx.name || '').toLowerCase().indexOf(query) !== -1 ||
                       (idx.url || '').toLowerCase().indexOf(query) !== -1 ||
                       (idx.preset || '').toLowerCase().indexOf(query) !== -1;
            });
        }

        if (filtered.length === 0 && _indexers.length === 0) {
            grid.style.display = 'none';
            if (empty) empty.style.display = '';
            var poolNotice = document.getElementById('ih-pool-notice');
            if (poolNotice) poolNotice.style.display = 'none';
            var instanceArea = document.getElementById('ih-instance-area');
            if (instanceArea) instanceArea.style.display = 'none';
            var groupBox = document.getElementById('ih-group-box');
            if (groupBox) groupBox.style.display = 'none';
            return;
        }

        grid.style.display = '';
        if (empty) empty.style.display = 'none';
        var poolNotice = document.getElementById('ih-pool-notice');
        if (poolNotice) poolNotice.style.display = '';
        var instanceArea = document.getElementById('ih-instance-area');
        if (instanceArea) instanceArea.style.display = '';
        var groupBox = document.getElementById('ih-group-box');
        if (groupBox) groupBox.style.display = '';

        var html = '';
        filtered.forEach(function(idx) {
            var enabled = idx.enabled !== false;
            var statusClass = enabled ? 'enabled' : 'disabled';
            var statusText = enabled ? 'Enabled' : 'Disabled';
            var statusIcon = enabled ? 'fa-check-circle' : 'fa-minus-circle';
            var presetLabel = _getPresetLabel(idx.preset);
            var url = idx.url || '\u2014';
            var keyDisplay = idx.api_key_last4 ? '\u2022\u2022\u2022\u2022' + _esc(idx.api_key_last4) : 'No key';
            html += '<div class="ih-card' + (enabled ? '' : ' ih-card-disabled') + '" data-id="' + _esc(idx.id) + '">'
                + '<div class="ih-card-header">'
                    + '<div class="ih-card-name"><span>' + _esc(idx.name || '') + '</span></div>'
                    + '<span class="ih-card-status ' + statusClass + '"><i class="fas ' + statusIcon + '"></i> ' + statusText + '</span>'
                + '</div>'
                + '<div class="ih-card-body">'
                    + '<div class="ih-card-detail ih-card-connection-row"><span class="ih-card-connection-status" data-connection="pending"><i class="fas fa-spinner fa-spin"></i> Checking...</span></div>'
                    + '<div class="ih-card-detail"><i class="fas fa-globe"></i><span class="ih-detail-value">' + _esc(url) + '</span></div>'
                    + '<div class="ih-card-detail"><i class="fas fa-key"></i><span class="ih-detail-value">' + keyDisplay + '</span></div>'
                    + '<div class="ih-card-detail" style="gap: 8px;">'
                        + '<span class="ih-card-priority-badge"><i class="fas fa-sort-amount-up" style="font-size:0.7rem;"></i> ' + (idx.priority || 50) + '</span>'
                        + '<span class="ih-card-preset-badge">' + _esc(presetLabel) + '</span>'
                    + '</div>'
                + '</div>'
                + '<div class="ih-card-footer">'
                    + '<button class="ih-card-btn test" onclick="IndexerHunt.testIndexer(\'' + _esc(idx.id) + '\')" title="Test"><i class="fas fa-plug"></i> Test</button>'
                    + '<button class="ih-card-btn edit" onclick="IndexerHunt.editIndexer(\'' + _esc(idx.id) + '\')" title="Edit"><i class="fas fa-edit"></i> Edit</button>'
                    + '<button class="ih-card-btn delete" onclick="IndexerHunt.deleteIndexer(\'' + _esc(idx.id) + '\', \'' + _esc(idx.name) + '\')" title="Delete"><i class="fas fa-trash"></i></button>'
                + '</div>'
            + '</div>';
        });

        // Add card at the end
        html += '<div class="ih-add-card" id="ih-add-card-inline">'
            + '<div class="ih-add-icon"><i class="fas fa-plus-circle"></i></div>'
            + '<div class="ih-add-text">Add Indexer</div>'
        + '</div>';

        grid.innerHTML = html;

        var addCard = document.getElementById('ih-add-card-inline');
        if (addCard) addCard.addEventListener('click', function() { _openEditor(null); });

        // Test each indexer connection and update card status (like app settings)
        _testIndexerCardsConnectionStatus(filtered);
    }

    function _testIndexerCardsConnectionStatus(indexerList) {
        if (!indexerList || indexerList.length === 0) return;
        fetch('./api/indexer-snipe/status')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var statuses = data.statuses || {};
                indexerList.forEach(function(idx) {
                    var card = document.querySelector('.ih-card[data-id="' + idx.id + '"]');
                    var statusEl = card ? card.querySelector('.ih-card-connection-status') : null;
                    if (!statusEl) return;
                    var info = statuses[idx.id];
                    if (!info) {
                        statusEl.setAttribute('data-connection', 'pending');
                        statusEl.innerHTML = '<i class="fas fa-clock"></i> Pending';
                        statusEl.classList.add('ih-card-connection-pending');
                        statusEl.classList.remove('ih-card-connection-ok', 'ih-card-connection-fail');
                        return;
                    }
                    if (info.status === 'connected') {
                        statusEl.setAttribute('data-connection', 'connected');
                        var timeAgo = info.last_checked ? _timeAgo(info.last_checked) : '';
                        var label = 'Connected';
                        if (timeAgo) label += ' \u00b7 ' + timeAgo;
                        statusEl.innerHTML = '<i class="fas fa-check-circle"></i> ' + label;
                        statusEl.classList.add('ih-card-connection-ok');
                        statusEl.classList.remove('ih-card-connection-fail', 'ih-card-connection-pending');
                    } else if (info.status === 'disabled') {
                        statusEl.setAttribute('data-connection', 'disabled');
                        statusEl.innerHTML = '<i class="fas fa-minus-circle"></i> Disabled';
                        statusEl.classList.remove('ih-card-connection-ok', 'ih-card-connection-fail', 'ih-card-connection-pending');
                    } else {
                        statusEl.setAttribute('data-connection', 'error');
                        statusEl.innerHTML = '<i class="fas fa-times-circle"></i> Failed';
                        statusEl.classList.add('ih-card-connection-fail');
                        statusEl.classList.remove('ih-card-connection-ok', 'ih-card-connection-pending');
                    }
                });
            })
            .catch(function() {
                // On error fetching status, leave cards as pending
            });
    }

    function _timeAgo(utcStr) {
        try {
            var checked = new Date(utcStr + 'Z');
            var now = new Date();
            var diffMs = now - checked;
            if (diffMs < 0) return '';
            var mins = Math.floor(diffMs / 60000);
            if (mins < 1) return 'just now';
            if (mins < 60) return mins + 'm ago';
            var hrs = Math.floor(mins / 60);
            if (hrs < 24) return hrs + 'h ago';
            return Math.floor(hrs / 24) + 'd ago';
        } catch(e) { return ''; }
    }

    function _getPresetLabel(preset) {
        if (!preset || preset === 'manual') return 'Custom';
        for (var i = 0; i < _presets.length; i++) {
            if (_presets[i].key === preset) return _presets[i].name;
        }
        return preset;
    }

    // ── Editor (full page) ─────────────────────────────────────────────

    function _openEditor(existingIdx) {
        _editingId = existingIdx ? existingIdx.id : null;

        var breadcrumb = document.getElementById('ih-editor-breadcrumb-name');
        if (breadcrumb) breadcrumb.textContent = _editingId ? 'Edit Indexer' : 'Add Indexer';

        var presetSel = document.getElementById('ih-form-preset');
        var nameEl = document.getElementById('ih-form-name');
        var urlEl = document.getElementById('ih-form-url');
        var apiPathEl = document.getElementById('ih-form-api-path');
        var apiKeyEl = document.getElementById('ih-form-api-key');
        var priorityEl = document.getElementById('ih-form-priority');
        var protocolEl = document.getElementById('ih-form-protocol');

        if (existingIdx) {
            if (presetSel) { presetSel.value = existingIdx.preset || 'manual'; presetSel.disabled = true; }
            if (nameEl) nameEl.value = existingIdx.name || '';
            if (urlEl) { urlEl.value = existingIdx.url || ''; urlEl.readOnly = existingIdx.preset !== 'manual'; }
            if (apiPathEl) { apiPathEl.value = existingIdx.api_path || '/api'; apiPathEl.readOnly = existingIdx.preset !== 'manual'; }
            if (apiKeyEl) apiKeyEl.value = '';
            if (apiKeyEl) apiKeyEl.placeholder = existingIdx.api_key_last4 ? 'Leave blank to keep (\u2022\u2022\u2022\u2022' + existingIdx.api_key_last4 + ')' : 'Enter API key';
            if (priorityEl) priorityEl.value = existingIdx.priority || 50;
            if (protocolEl) protocolEl.value = existingIdx.protocol || 'usenet';
        } else {
            if (presetSel) { presetSel.value = 'manual'; presetSel.disabled = false; }
            if (nameEl) nameEl.value = '';
            if (urlEl) { urlEl.value = ''; urlEl.readOnly = false; }
            if (apiPathEl) { apiPathEl.value = '/api'; apiPathEl.readOnly = false; }
            if (apiKeyEl) { apiKeyEl.value = ''; apiKeyEl.placeholder = 'Enter API key'; }
            if (priorityEl) priorityEl.value = 50;
            if (protocolEl) protocolEl.value = 'usenet';
        }

        _showEditorView();

        // Auto-test connection when URL or API key changes
        var statusContainer = document.getElementById('ih-connection-status-container');
        if (statusContainer) statusContainer.style.display = 'flex';
        if (!window._ihConnectionListenersBound) {
            window._ihConnectionListenersBound = true;
            var urlEl2 = document.getElementById('ih-form-url');
            var apiPathEl2 = document.getElementById('ih-form-api-path');
            var apiKeyEl2 = document.getElementById('ih-form-api-key');
            var debounceTimer;
            var runStatus = function() {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(function() { _updateConnectionStatusFromForm(); }, 500);
            };
            if (urlEl2) { urlEl2.addEventListener('input', runStatus); urlEl2.addEventListener('blur', runStatus); }
            if (apiPathEl2) { apiPathEl2.addEventListener('input', runStatus); apiPathEl2.addEventListener('blur', runStatus); }
            if (apiKeyEl2) { apiKeyEl2.addEventListener('input', runStatus); apiKeyEl2.addEventListener('blur', runStatus); }
        }
        setTimeout(function() { _updateConnectionStatusFromForm(); }, 100);
    }

    function _updateConnectionStatusFromForm() {
        var container = document.getElementById('ih-connection-status-container');
        if (!container) return;
        var urlEl = document.getElementById('ih-form-url');
        var apiPathEl = document.getElementById('ih-form-api-path');
        var apiKeyEl = document.getElementById('ih-form-api-key');
        var url = urlEl ? urlEl.value.trim() : '';
        var apiPath = apiPathEl ? (apiPathEl.value.trim() || '/api') : '/api';
        var apiKey = apiKeyEl ? apiKeyEl.value.trim() : '';
        var hasSavedKey = _editingId && _indexers.length;
        if (hasSavedKey) {
            var existing = null;
            _indexers.forEach(function(i) { if (i.id === _editingId) existing = i; });
            hasSavedKey = !!(existing && existing.api_key_last4);
        }
        if (url.length <= 10 && apiKey.length < 10) {
            container.innerHTML = '<div class="connection-status" style="background: rgba(148,163,184,0.1); color: #94a3b8; border: 1px solid rgba(148,163,184,0.2);"><i class="fas fa-info-circle"></i><span>Enter URL and API Key</span></div>';
            return;
        }
        if (url.length <= 10) {
            container.innerHTML = '<div class="connection-status" style="background: rgba(251,191,36,0.1); color: #fbbf24; border: 1px solid rgba(251,191,36,0.2);"><i class="fas fa-exclamation-triangle"></i><span>Missing URL</span></div>';
            return;
        }
        if (apiKey.length < 10 && !hasSavedKey) {
            container.innerHTML = '<div class="connection-status" style="background: rgba(251,191,36,0.1); color: #fbbf24; border: 1px solid rgba(251,191,36,0.2);"><i class="fas fa-exclamation-triangle"></i><span>Missing API Key</span></div>';
            return;
        }
        if (apiKey.length < 10 && hasSavedKey) {
            container.innerHTML = '<div class="connection-status" style="background: rgba(148,163,184,0.1); color: #94a3b8; border: 1px solid rgba(148,163,184,0.2);"><i class="fas fa-check-circle"></i><span>API key saved. Leave blank to keep.</span></div>';
            return;
        }
        container.innerHTML = '<div class="connection-status checking"><i class="fas fa-spinner fa-spin"></i><span>Checking...</span></div>';
        var presetEl = document.getElementById('ih-form-preset');
        var preset = presetEl ? presetEl.value : 'manual';
        var body = { preset: preset, url: url, api_path: apiPath, api_key: apiKey };
        fetch('./api/indexer-snipe/validate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.valid) {
                var msg = 'Connected';
                if (data.response_time_ms != null) msg += ' (' + data.response_time_ms + 'ms)';
                container.innerHTML = '<div class="connection-status success"><i class="fas fa-check-circle"></i><span>' + _esc(msg) + '</span></div>';
            } else {
                container.innerHTML = '<div class="connection-status error"><i class="fas fa-times-circle"></i><span>' + _esc(data.message || 'Connection failed') + '</span></div>';
            }
        })
        .catch(function(err) {
            container.innerHTML = '<div class="connection-status error"><i class="fas fa-times-circle"></i><span>' + _esc(String(err && err.message ? err.message : 'Connection failed')) + '</span></div>';
        });
    }

    function _onPresetChange() {
        var sel = document.getElementById('ih-form-preset');
        var preset = sel ? sel.value : 'manual';
        var isManual = preset === 'manual';

        var nameEl = document.getElementById('ih-form-name');
        var urlEl = document.getElementById('ih-form-url');
        var apiPathEl = document.getElementById('ih-form-api-path');

        if (!isManual) {
            var p = null;
            _presets.forEach(function(pr) { if (pr.key === preset) p = pr; });
            if (p) {
                if (nameEl) nameEl.value = p.name;
                if (urlEl) urlEl.value = p.url;
                if (apiPathEl) apiPathEl.value = p.api_path || '/api';
            }
        }
        if (urlEl) urlEl.readOnly = !isManual;
        if (apiPathEl) apiPathEl.readOnly = !isManual;
    }

    function _saveForm() {
        var nameEl = document.getElementById('ih-form-name');
        var presetEl = document.getElementById('ih-form-preset');
        var urlEl = document.getElementById('ih-form-url');
        var apiPathEl = document.getElementById('ih-form-api-path');
        var apiKeyEl = document.getElementById('ih-form-api-key');
        var priorityEl = document.getElementById('ih-form-priority');
        var protocolEl = document.getElementById('ih-form-protocol');

        var body = {
            name: (nameEl ? nameEl.value : '').trim(),
            preset: presetEl ? presetEl.value : 'manual',
            url: (urlEl ? urlEl.value : '').trim(),
            api_path: (apiPathEl ? apiPathEl.value : '/api').trim(),
            api_key: (apiKeyEl ? apiKeyEl.value : '').trim(),
            priority: parseInt(priorityEl ? priorityEl.value : '50', 10) || 50,
            enabled: true,
            protocol: protocolEl ? protocolEl.value : 'usenet',
        };

        if (!body.name) {
            if (window.sniparrUI) window.sniparrUI.showNotification('Name is required.', 'error');
            return;
        }

        var method = _editingId ? 'PUT' : 'POST';
        var url = _editingId ? './api/indexer-snipe/indexers/' + _editingId : './api/indexer-snipe/indexers';

        fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.success) {
                var msg = _editingId ? 'Indexer updated.' : 'Indexer added.';
                if (data.linked_instances_updated > 0) {
                    msg += ' Updated in ' + data.linked_instances_updated + ' Movie Snipe instance(s).';
                }
                if (window.sniparrUI) window.sniparrUI.showNotification(msg, 'success');
                var searchInput = document.getElementById('ih-search-input');
                if (searchInput) searchInput.value = '';
                _loadIndexers();
                _showListView();
            } else {
                if (window.sniparrUI) window.sniparrUI.showNotification(data.error || 'Failed to save.', 'error');
            }
        })
        .catch(function(err) {
            if (window.sniparrUI) window.sniparrUI.showNotification('Error: ' + err, 'error');
        });
    }

    // ── Public actions ────────────────────────────────────────────────

    IH.editIndexer = function(id) {
        var idx = null;
        _indexers.forEach(function(i) { if (i.id === id) idx = i; });
        if (idx) _openEditor(idx);
    };

    IH.testIndexer = function(id) {
        var card = document.querySelector('.ih-card[data-id="' + id + '"]');
        var statusEl = card ? card.querySelector('.ih-card-connection-status') : null;
        if (statusEl) {
            statusEl.setAttribute('data-connection', 'checking');
            statusEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Testing...';
            statusEl.classList.remove('ih-card-connection-ok', 'ih-card-connection-fail', 'ih-card-connection-pending');
        }
        fetch('./api/indexer-snipe/indexers/' + id + '/test', { method: 'POST' })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data.valid) {
                    if (window.sniparrUI) window.sniparrUI.showNotification('Connection OK (' + (data.response_time_ms || 0) + 'ms)', 'success');
                    if (statusEl) {
                        statusEl.setAttribute('data-connection', 'connected');
                        statusEl.innerHTML = '<i class="fas fa-check-circle"></i> Connected \u00b7 just now';
                        statusEl.classList.add('ih-card-connection-ok');
                        statusEl.classList.remove('ih-card-connection-fail', 'ih-card-connection-pending');
                    }
                } else {
                    if (window.sniparrUI) window.sniparrUI.showNotification(data.message || 'Test failed.', 'error');
                    if (statusEl) {
                        statusEl.setAttribute('data-connection', 'error');
                        statusEl.innerHTML = '<i class="fas fa-times-circle"></i> Failed';
                        statusEl.classList.add('ih-card-connection-fail');
                        statusEl.classList.remove('ih-card-connection-ok', 'ih-card-connection-pending');
                    }
                }
            })
            .catch(function(err) {
                if (window.sniparrUI) window.sniparrUI.showNotification('Error: ' + err, 'error');
            });
    };

    IH.deleteIndexer = function(id, name) {
        fetch('./api/indexer-snipe/linked-instances/' + id)
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var linked = data.linked || [];
                var msg = 'Are you sure you want to delete "' + name + '"?';
                if (linked.length > 0) {
                    msg += '\n\nThis will also remove it from ' + linked.length + ' linked instance(s).';
                }
                window.SniparrConfirm.show({
                    title: 'Delete Indexer',
                    message: msg,
                    confirmLabel: 'Delete',
                    onConfirm: function() {
                        fetch('./api/indexer-snipe/indexers/' + id, { method: 'DELETE' })
                            .then(function(r) { return r.json(); })
                            .then(function(res) {
                                if (res.success) {
                                    _loadIndexers();
                                    var notice = '"' + name + '" deleted.';
                                    if (res.instances_cleaned > 0) {
                                        notice += ' Removed from ' + res.instances_cleaned + ' instance(s).';
                                    }
                                    if (window.sniparrUI) window.sniparrUI.showNotification(notice, 'success');
                                    _refreshIndexerInstanceStatus();
                                } else {
                                    if (window.sniparrUI) window.sniparrUI.showNotification(res.error || 'Delete failed.', 'error');
                                }
                            });
                    }
                });
            });
    };

    function _esc(s) {
        if (!s) return '';
        var d = document.createElement('div');
        d.appendChild(document.createTextNode(s));
        return d.innerHTML;
    }

    document.addEventListener('sniparr:instances-changed', function() {
        if (document.getElementById('indexer-snipe-content-wrapper') && window.sniparrUI && window.sniparrUI.currentSection === 'indexer-hunt') {
            IH.init();
        }
    });
    document.addEventListener('sniparr:tv-snipe-instances-changed', function() {
        if (document.getElementById('indexer-snipe-content-wrapper') && window.sniparrUI && window.sniparrUI.currentSection === 'indexer-hunt') {
            IH.init();
        }
    });

})();


/* === modules/features/indexer-hunt-home.js === */
/**
 * Indexer Hunt — Home Page Card
 * Shows indexer list + aggregate statistics on the Home dashboard.
 * Only visible when at least one Indexer Hunt indexer is configured.
 * Mirrors the Prowlarr home card design exactly.
 */
window.SniparrIndexerHuntHome = {
    _pollInterval: null,

    /* ── Bootstrap ─────────────────────────────────────────────── */
    setup: function() {
        this.load();

        // Refresh every 5 minutes (same cadence as Prowlarr stats)
        if (!this._pollInterval) {
            var self = this;
            this._pollInterval = setInterval(function() {
                if (window.sniparrUI && window.sniparrUI.currentSection === 'home') {
                    self.load();
                }
            }, 5 * 60 * 1000);
        }
    },

    /* ── Main loader ───────────────────────────────────────────── */
    load: function() {
        var card = document.getElementById('indexerHuntStatusCard');
        if (!card) return;
        if (window.sniparrUI && window.sniparrUI._enableMediaHunt === false) {
            card.style.display = 'none';
            return;
        }

        var self = this;

        // 1. Fetch indexers list — also tells us whether the card should show
        SniparrUtils.fetchWithTimeout('./api/indexer-snipe/indexers')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var indexers = data.indexers || [];
                if (indexers.length === 0) {
                    card.style.display = 'none';
                    return;
                }

                card.style.display = 'block';

                // Connection badge
                var badge = document.getElementById('ihHomeConnectionStatus');
                if (badge) {
                    var enabledCount = indexers.filter(function(i) { return i.enabled !== false; }).length;
                    badge.textContent = '🟢 ' + enabledCount + ' Indexer' + (enabledCount !== 1 ? 's' : '') + ' Active';
                    badge.className = 'status-badge connected';
                }

                // Render indexer list (left sub-card)
                self._renderIndexerList(indexers);

                // 2. Fetch aggregate stats (right sub-card)
                self._loadStats();
            })
            .catch(function() {
                card.style.display = 'none';
            });
    },

    /* ── Left sub-card: indexer list ───────────────────────────── */
    _renderIndexerList: function(indexers) {
        var list = document.getElementById('ih-home-indexers-list');
        if (!list) return;

        if (!indexers || indexers.length === 0) {
            list.innerHTML = '<div class="loading-text">No indexers configured</div>';
            return;
        }

        // Sort alphabetically
        indexers.sort(function(a, b) {
            var na = (a.name || '').toLowerCase();
            var nb = (b.name || '').toLowerCase();
            return na < nb ? -1 : na > nb ? 1 : 0;
        });

        var html = indexers.map(function(idx) {
            var enabled = idx.enabled !== false;
            var statusClass = enabled ? 'active' : 'failed';
            var statusText  = enabled ? 'Active' : 'Disabled';
            var displayName = (idx.name || 'Unnamed').replace(/</g, '&lt;').replace(/>/g, '&gt;');

            return '<div class="indexer-item">' +
                '<span class="indexer-name">' + displayName + '</span>' +
                '<span class="indexer-status ' + statusClass + '">' + statusText + '</span>' +
                '</div>';
        }).join('');

        list.innerHTML = html;
    },

    /* ── Right sub-card: aggregate stats ──────────────────────── */
    _loadStats: function() {
        var content = document.getElementById('ih-home-statistics-content');
        if (!content) return;

        var fmt = function(n) {
            var v = Number(n || 0);
            return Number.isFinite(v) ? String(Math.round(v)) : '0';
        };

        SniparrUtils.fetchWithTimeout('./api/indexer-snipe/stats')
            .then(function(r) { return r.json(); })
            .then(function(stats) {
                var queries    = fmt(stats.total_queries);
                var grabs      = fmt(stats.total_grabs);
                var failures   = fmt(stats.total_failures);
                var avgMs      = Number(stats.avg_response_ms || 0);
                var failRate   = Number(stats.failure_rate || 0);

                content.innerHTML =
                    '<div class="stat-card">' +
                        '<div class="stat-label">QUERIES (24H)</div>' +
                        '<div class="stat-value success">' + queries + '</div>' +
                    '</div>' +
                    '<div class="stat-card">' +
                        '<div class="stat-label">GRABS (24H)</div>' +
                        '<div class="stat-value success">' + grabs + '</div>' +
                    '</div>' +
                    '<div class="stat-card">' +
                        '<div class="stat-label">AVG RESPONSE</div>' +
                        '<div class="stat-value success">' + (avgMs > 0 ? avgMs.toFixed(0) + 'ms' : 'N/A') + '</div>' +
                    '</div>' +
                    '<div class="stat-card">' +
                        '<div class="stat-label">FAILURE RATE</div>' +
                        '<div class="stat-value' + (failRate > 10 ? ' error' : ' success') + '">' + failRate.toFixed(1) + '%</div>' +
                    '</div>' +
                    '<div class="stat-card">' +
                        '<div class="stat-label">FAILURES (24H)</div>' +
                        '<div class="stat-value' + (Number(failures) > 0 ? ' error' : ' success') + '">' + failures + '</div>' +
                    '</div>';
            })
            .catch(function() {
                content.innerHTML = '<div class="loading-text" style="color: #ef4444;">Failed to load stats</div>';
            });
    }
};


/* === modules/features/indexer-hunt-stats.js === */
/**
 * Indexer Hunt — Stats page module.
 * Displays aggregate and per-indexer statistics.
 */
(function() {
    'use strict';

    var Stats = window.IndexerHuntStats = {};

    Stats.init = function() {
        var noInstEl = document.getElementById('indexer-snipe-stats-no-instances');
        var wrapperEl = document.getElementById('indexer-snipe-stats-content-wrapper');
        var noIdxEl = document.getElementById('indexer-snipe-stats-no-indexers');
        var noCliEl = document.getElementById('indexer-snipe-stats-no-clients');
        Promise.all([
            fetch('./api/movie-snipe/instances', { cache: 'no-store' }).then(function(r) { return r.json(); }),
            fetch('./api/tv-snipe/instances', { cache: 'no-store' }).then(function(r) { return r.json(); }),
            fetch('./api/indexer-snipe/indexers', { cache: 'no-store' }).then(function(r) { return r.json(); }),
            fetch('./api/movie-snipe/has-clients', { cache: 'no-store' }).then(function(r) { return r.json(); })
        ]).then(function(results) {
            var movieCount = (results[0].instances || []).length;
            var tvCount = (results[1].instances || []).length;
            var indexerCount = (results[2].indexers || []).length;
            var hasClients = results[3].has_clients === true;
            if (movieCount === 0 && tvCount === 0) {
                if (noInstEl) noInstEl.style.display = '';
                if (noIdxEl) noIdxEl.style.display = 'none';
                if (noCliEl) noCliEl.style.display = 'none';
                if (wrapperEl) wrapperEl.style.display = 'none';
                return;
            }
            if (indexerCount === 0) {
                if (noInstEl) noInstEl.style.display = 'none';
                if (noIdxEl) noIdxEl.style.display = '';
                if (noCliEl) noCliEl.style.display = 'none';
                if (wrapperEl) wrapperEl.style.display = 'none';
                return;
            }
            if (!hasClients) {
                if (noInstEl) noInstEl.style.display = 'none';
                if (noIdxEl) noIdxEl.style.display = 'none';
                if (noCliEl) noCliEl.style.display = '';
                if (wrapperEl) wrapperEl.style.display = 'none';
                return;
            }
            if (noInstEl) noInstEl.style.display = 'none';
            if (noIdxEl) noIdxEl.style.display = 'none';
            if (noCliEl) noCliEl.style.display = 'none';
            if (wrapperEl) wrapperEl.style.display = '';
            _loadAggregateStats();
            _loadPerIndexerStats();
        }).catch(function() {
            if (noInstEl) noInstEl.style.display = 'none';
            if (noIdxEl) noIdxEl.style.display = 'none';
            if (noCliEl) noCliEl.style.display = 'none';
            if (wrapperEl) wrapperEl.style.display = '';
            _loadAggregateStats();
            _loadPerIndexerStats();
        });
    };

    function _loadAggregateStats() {
        fetch('./api/indexer-snipe/stats')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                _setVal('ih-stat-queries', data.total_queries || 0);
                _setVal('ih-stat-grabs', data.total_grabs || 0);
                _setVal('ih-stat-failures', data.total_failures || 0);
                var respEl = document.getElementById('ih-stat-response');
                if (respEl) respEl.innerHTML = (data.avg_response_ms || 0) + '<span class="ih-stat-unit">ms</span>';
                var rateEl = document.getElementById('ih-stat-failure-rate');
                if (rateEl) rateEl.innerHTML = (data.failure_rate || 0) + '<span class="ih-stat-unit">%</span>';
            })
            .catch(function(err) {
                console.error('[IndexerHuntStats] Aggregate load error:', err);
            });
    }

    function _loadPerIndexerStats() {
        fetch('./api/indexer-snipe/stats/per-indexer')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var indexers = data.indexers || [];
                var tbody = document.getElementById('ih-stats-table-body');
                var tableWrap = document.getElementById('ih-stats-table-wrap');
                var empty = document.getElementById('ih-stats-empty');
                if (!tbody) return;

                if (indexers.length === 0) {
                    if (tableWrap) tableWrap.style.display = 'none';
                    if (empty) empty.style.display = 'block';
                    return;
                }

                if (tableWrap) tableWrap.style.display = '';
                if (empty) empty.style.display = 'none';

                var html = '';
                indexers.forEach(function(idx) {
                    var statusHtml = idx.enabled
                        ? '<span class="ih-card-status enabled" style="font-size:0.7rem;"><i class="fas fa-check-circle"></i> Enabled</span>'
                        : '<span class="ih-card-status disabled" style="font-size:0.7rem;"><i class="fas fa-minus-circle"></i> Disabled</span>';
                    html += '<tr>'
                        + '<td><strong>' + _esc(idx.name) + '</strong></td>'
                        + '<td><span class="ih-card-priority-badge">' + (idx.priority || 50) + '</span></td>'
                        + '<td>' + (idx.searches || 0) + '</td>'
                        + '<td>' + (idx.grabs || 0) + '</td>'
                        + '<td>' + (idx.failures || 0) + '</td>'
                        + '<td>' + (idx.avg_response_ms || 0) + 'ms</td>'
                        + '<td>' + (idx.failure_rate || 0) + '%</td>'
                        + '<td>' + statusHtml + '</td>'
                        + '</tr>';
                });
                tbody.innerHTML = html;
            })
            .catch(function(err) {
                console.error('[IndexerHuntStats] Per-indexer load error:', err);
            });
    }

    function _setVal(id, val) {
        var el = document.getElementById(id);
        if (el) el.textContent = val;
    }

    function _esc(s) {
        if (!s) return '';
        var d = document.createElement('div');
        d.appendChild(document.createTextNode(s));
        return d.innerHTML;
    }

    document.addEventListener('sniparr:instances-changed', function() {
        if (document.getElementById('indexer-snipe-stats-content-wrapper') && window.sniparrUI && window.sniparrUI.currentSection === 'indexer-snipe-stats') {
            Stats.init();
        }
    });
    document.addEventListener('sniparr:tv-snipe-instances-changed', function() {
        if (document.getElementById('indexer-snipe-stats-content-wrapper') && window.sniparrUI && window.sniparrUI.currentSection === 'indexer-snipe-stats') {
            Stats.init();
        }
    });

})();


/* === modules/features/indexer-hunt-history.js === */
/**
 * Indexer Hunt — History page module.
 * Displays paginated event history with filters.
 */
(function() {
    'use strict';

    var History = window.IndexerHuntHistory = {};
    var _currentPage = 1;
    var _totalPages = 1;
    var _initialized = false;

    History.init = function() {
        if (!_initialized) {
            _bindEvents();
            _loadIndexerFilter();
            _initialized = true;
        }
        var noInstEl = document.getElementById('indexer-snipe-history-no-instances');
        var wrapperEl = document.getElementById('indexer-snipe-history-content-wrapper');
        var noIdxEl = document.getElementById('indexer-snipe-history-no-indexers');
        var noCliEl = document.getElementById('indexer-snipe-history-no-clients');
        Promise.all([
            fetch('./api/movie-snipe/instances', { cache: 'no-store' }).then(function(r) { return r.json(); }),
            fetch('./api/tv-snipe/instances', { cache: 'no-store' }).then(function(r) { return r.json(); }),
            fetch('./api/indexer-snipe/indexers', { cache: 'no-store' }).then(function(r) { return r.json(); }),
            fetch('./api/movie-snipe/has-clients', { cache: 'no-store' }).then(function(r) { return r.json(); })
        ]).then(function(results) {
            var movieCount = (results[0].instances || []).length;
            var tvCount = (results[1].instances || []).length;
            var indexerCount = (results[2].indexers || []).length;
            var hasClients = results[3].has_clients === true;
            if (movieCount === 0 && tvCount === 0) {
                if (noInstEl) noInstEl.style.display = '';
                if (noIdxEl) noIdxEl.style.display = 'none';
                if (noCliEl) noCliEl.style.display = 'none';
                if (wrapperEl) wrapperEl.style.display = 'none';
                return;
            }
            if (indexerCount === 0) {
                if (noInstEl) noInstEl.style.display = 'none';
                if (noIdxEl) noIdxEl.style.display = '';
                if (noCliEl) noCliEl.style.display = 'none';
                if (wrapperEl) wrapperEl.style.display = 'none';
                return;
            }
            if (!hasClients) {
                if (noInstEl) noInstEl.style.display = 'none';
                if (noIdxEl) noIdxEl.style.display = 'none';
                if (noCliEl) noCliEl.style.display = '';
                if (wrapperEl) wrapperEl.style.display = 'none';
                return;
            }
            if (noInstEl) noInstEl.style.display = 'none';
            if (noIdxEl) noIdxEl.style.display = 'none';
            if (noCliEl) noCliEl.style.display = 'none';
            if (wrapperEl) wrapperEl.style.display = '';
            _currentPage = 1;
            _loadHistory();
        }).catch(function() {
            if (noInstEl) noInstEl.style.display = 'none';
            if (noIdxEl) noIdxEl.style.display = 'none';
            if (noCliEl) noCliEl.style.display = 'none';
            if (wrapperEl) wrapperEl.style.display = '';
            _currentPage = 1;
            _loadHistory();
        });
    };

    function _bindEvents() {
        var typeFilter = document.getElementById('ih-history-type-filter');
        if (typeFilter) typeFilter.addEventListener('change', function() { _currentPage = 1; _loadHistory(); });

        var indexerFilter = document.getElementById('ih-history-indexer-filter');
        if (indexerFilter) indexerFilter.addEventListener('change', function() { _currentPage = 1; _loadHistory(); });

        var prevBtn = document.getElementById('ih-history-prev-btn');
        if (prevBtn) prevBtn.addEventListener('click', function() {
            if (_currentPage > 1) { _currentPage--; _loadHistory(); }
        });

        var nextBtn = document.getElementById('ih-history-next-btn');
        if (nextBtn) nextBtn.addEventListener('click', function() {
            if (_currentPage < _totalPages) { _currentPage++; _loadHistory(); }
        });

        var clearBtn = document.getElementById('ih-history-clear-btn');
        if (clearBtn) clearBtn.addEventListener('click', function() {
            window.SniparrConfirm.show({
                title: 'Clear History',
                message: 'Are you sure you want to clear all Index Master history and stats? This cannot be undone.',
                confirmLabel: 'Clear',
                onConfirm: function() {
                    fetch('./api/indexer-snipe/history', { method: 'DELETE' })
                        .then(function(r) { return r.json(); })
                        .then(function(data) {
                            if (data.success) {
                                _currentPage = 1;
                                _loadHistory();
                                if (window.sniparrUI) window.sniparrUI.showNotification('History cleared.', 'success');
                            }
                        });
                }
            });
        });
    }

    function _loadIndexerFilter() {
        fetch('./api/indexer-snipe/indexers')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var sel = document.getElementById('ih-history-indexer-filter');
                if (!sel) return;
                var firstOpt = sel.querySelector('option[value=""]');
                sel.innerHTML = '';
                if (firstOpt) sel.appendChild(firstOpt);
                else {
                    var opt = document.createElement('option');
                    opt.value = '';
                    opt.textContent = 'All Indexers';
                    sel.appendChild(opt);
                }
                (data.indexers || []).forEach(function(idx) {
                    var opt = document.createElement('option');
                    opt.value = idx.id;
                    opt.textContent = idx.name;
                    sel.appendChild(opt);
                });
            });
    }

    function _loadHistory() {
        var typeFilter = document.getElementById('ih-history-type-filter');
        var indexerFilter = document.getElementById('ih-history-indexer-filter');
        var eventType = typeFilter ? typeFilter.value : '';
        var indexerId = indexerFilter ? indexerFilter.value : '';

        var params = 'page=' + _currentPage + '&page_size=50';
        if (eventType) params += '&event_type=' + encodeURIComponent(eventType);
        if (indexerId) params += '&indexer_id=' + encodeURIComponent(indexerId);

        fetch('./api/indexer-snipe/history?' + params)
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var items = data.items || [];
                _totalPages = data.total_pages || 1;
                _currentPage = data.page || 1;
                _renderTable(items);
                _updatePagination(data.total || 0);
            })
            .catch(function(err) {
                console.error('[IndexerHuntHistory] Load error:', err);
            });
    }

    function _renderTable(items) {
        var tbody = document.getElementById('ih-history-table-body');
        var tableWrap = document.getElementById('ih-history-table-wrap');
        var empty = document.getElementById('ih-history-empty');
        if (!tbody) return;

        if (items.length === 0) {
            tbody.innerHTML = '';
            if (tableWrap) tableWrap.style.display = 'none';
            if (empty) empty.style.display = 'block';
            return;
        }

        if (tableWrap) tableWrap.style.display = '';
        if (empty) empty.style.display = 'none';

        var html = '';
        items.forEach(function(ev) {
            var date = ev.created_at || '';
            try {
                var d = new Date(date);
                if (!isNaN(d.getTime())) {
                    date = d.toLocaleString();
                }
            } catch(e) {}

            var rawType = ev.event_type || 'unknown';
            var typeLabels = { search: 'Search', grab: 'Grab', failure: 'Failure', test: 'Connection Test', health_check: 'Hourly Check' };
            var typeLabel = typeLabels[rawType] || rawType;
            var typeClass = 'ih-event-' + rawType;
            var typeBadge = '<span class="ih-event-badge ' + typeClass + '">' + _esc(typeLabel) + '</span>';
            var statusIcon = ev.success
                ? '<i class="fas fa-check-circle" style="color: #10b981;"></i>'
                : '<i class="fas fa-times-circle" style="color: #ef4444;"></i>';

            html += '<tr>'
                + '<td style="white-space: nowrap; font-size: 0.85rem; color: #94a3b8;">' + _esc(date) + '</td>'
                + '<td>' + typeBadge + '</td>'
                + '<td>' + _esc(ev.indexer_name || '\u2014') + '</td>'
                + '<td>' + _esc(ev.query || '\u2014') + '</td>'
                + '<td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">'
                + (ev.result_title
                    ? '<span title="' + _esc(ev.result_title).replace(/"/g, '&quot;') + '" style="cursor: default;">'
                      + (rawType === 'grab' ? 'Fetched' : 'Found')
                      + '</span>'
                    : '\u2014')
                + '</td>'
                + '<td>' + (ev.response_time_ms || 0) + 'ms</td>'
                + '<td>' + statusIcon + '</td>'
                + '</tr>';
        });
        tbody.innerHTML = html;
    }

    function _updatePagination(total) {
        var pagination = document.getElementById('ih-history-pagination');
        var pageInfo = document.getElementById('ih-history-page-info');
        var prevBtn = document.getElementById('ih-history-prev-btn');
        var nextBtn = document.getElementById('ih-history-next-btn');

        if (total <= 50) {
            if (pagination) pagination.style.display = 'none';
            return;
        }

        if (pagination) pagination.style.display = 'flex';
        if (pageInfo) pageInfo.textContent = 'Page ' + _currentPage + ' of ' + _totalPages;
        if (prevBtn) prevBtn.disabled = _currentPage <= 1;
        if (nextBtn) nextBtn.disabled = _currentPage >= _totalPages;
    }

    function _esc(s) {
        if (!s) return '';
        var d = document.createElement('div');
        d.appendChild(document.createTextNode(s));
        return d.innerHTML;
    }

    document.addEventListener('sniparr:instances-changed', function() {
        if (document.getElementById('indexer-snipe-history-content-wrapper') && window.sniparrUI && window.sniparrUI.currentSection === 'indexer-snipe-history') {
            History.init();
        }
    });
    document.addEventListener('sniparr:tv-snipe-instances-changed', function() {
        if (document.getElementById('indexer-snipe-history-content-wrapper') && window.sniparrUI && window.sniparrUI.currentSection === 'indexer-snipe-history') {
            History.init();
        }
    });

})();


/* === modules/features/apps/sonarr.js === */
// Sonarr-specific functionality

(function(app) {
    if (!app) {
        console.error("Sniparr App core is not loaded!");
        return;
    }

    const sonarrModule = {
        elements: {},

        init: function() {
            // Cache elements specific to Sonarr settings
            this.cacheElements();
            // Setup event listeners specific to Sonarr settings
            this.setupEventListeners();
            // Initial population of the form is handled by app.js
        },

        cacheElements: function() {
            // Cache elements used by Sonarr settings form
            this.elements.apiUrlInput = document.getElementById('sonarr_api_url');
            this.elements.apiKeyInput = document.getElementById('sonarr_api_key');
            this.elements.huntMissingItemsInput = document.getElementById('sonarr-hunt-missing-items');
            this.elements.huntUpgradeItemsInput = document.getElementById('sonarr-hunt-upgrade-items');
            this.elements.sleepDurationInput = document.getElementById('sonarr_sleep_duration');
            this.elements.sleepDurationHoursSpan = document.getElementById('sonarr_sleep_duration_hours');
            this.elements.monitoredOnlyInput = document.getElementById('sonarr_monitored_only');
            this.elements.skipFutureEpisodesInput = document.getElementById('sonarr_skip_future_episodes');
            this.elements.skipSeriesRefreshInput = document.getElementById('sonarr_skip_series_refresh');
            this.elements.randomMissingInput = document.getElementById('sonarr_random_missing'); 
            this.elements.randomUpgradesInput = document.getElementById('sonarr_random_upgrades'); 
            this.elements.debugModeInput = document.getElementById('sonarr_debug_mode'); 
            this.elements.apiTimeoutInput = document.getElementById('sonarr_api_timeout'); 
            this.elements.commandWaitDelayInput = document.getElementById('sonarr_command_wait_delay'); 
            this.elements.commandWaitAttemptsInput = document.getElementById('sonarr_command_wait_attempts'); 
            this.elements.minimumDownloadQueueSizeInput = document.getElementById('sonarr_minimum_download_queue_size'); 
            // Add other Sonarr-specific elements if any
        },

        setupEventListeners: function() {
            // Add event listeners for Sonarr-specific controls if needed
            // Example: If there were unique interactions for Sonarr settings
            // Most change detection is now handled centrally by app.js

            // Update sleep duration display on input change
            if (this.elements.sleepDurationInput) {
                this.elements.sleepDurationInput.addEventListener('input', () => {
                    this.updateSleepDurationDisplay();
                    // Central change detection handles the rest
                });
            }
        },

        updateSleepDurationDisplay: function() {
            // Use the central utility function for updating duration display
            if (this.elements.sleepDurationInput && this.elements.sleepDurationHoursSpan) {
                const seconds = parseInt(this.elements.sleepDurationInput.value) || 900;
                app.updateDurationDisplay(seconds, this.elements.sleepDurationHoursSpan);
            }
        },

        // REMOVED: loadSettings function (handled by app.js)

        // REMOVED: checkForChanges function (handled by app.js)

        // REMOVED: updateSaveButtonState function (handled by app.js)

        // REMOVED: getSettingsPayload function (handled by app.js)

        // REMOVED: saveSettings function (handled by app.js)

        // REMOVED: Overriding of app.saveSettings
    };

    // Initialize Sonarr module
    sonarrModule.init();

    // Add the Sonarr module to the app for reference if needed elsewhere
    app.sonarrModule = sonarrModule;

})(window.sniparrUI); // Use the new global object name


/* === modules/features/apps/radarr.js === */
// Radarr-specific functionality

(function(app) {
    if (!app) {
        console.error("Sniparr App core is not loaded!");
        return;
    }

    const radarrModule = {
        elements: {},

        init: function() {
            console.log('[Radarr Module] Initializing...');
            this.cacheElements();
            this.setupEventListeners();
        },

        cacheElements: function() {
            // Cache elements specific to the Radarr settings form
            this.elements.apiUrlInput = document.getElementById('radarr_api_url');
            this.elements.apiKeyInput = document.getElementById('radarr_api_key');
            this.elements.huntMissingMoviesInput = document.getElementById('hunt_missing_movies');
            this.elements.huntUpgradeMoviesInput = document.getElementById('hunt_upgrade_movies');
            this.elements.sleepDurationInput = document.getElementById('radarr_sleep_duration');
            this.elements.sleepDurationHoursSpan = document.getElementById('radarr_sleep_duration_hours');
            this.elements.stateResetIntervalInput = document.getElementById('radarr_state_reset_interval_hours');
            this.elements.monitoredOnlyInput = document.getElementById('radarr_monitored_only');
            this.elements.skipFutureReleasesInput = document.getElementById('skip_future_releases'); // Note: ID might be shared
            this.elements.skipMovieRefreshInput = document.getElementById('skip_movie_refresh');
            this.elements.randomMissingInput = document.getElementById('radarr_random_missing');
            this.elements.randomUpgradesInput = document.getElementById('radarr_random_upgrades');
            this.elements.debugModeInput = document.getElementById('radarr_debug_mode');
            this.elements.apiTimeoutInput = document.getElementById('radarr_api_timeout');
            this.elements.commandWaitDelayInput = document.getElementById('radarr_command_wait_delay');
            this.elements.commandWaitAttemptsInput = document.getElementById('radarr_command_wait_attempts');
            this.elements.minimumDownloadQueueSizeInput = document.getElementById('radarr_minimum_download_queue_size');
            // Add any other Radarr-specific elements
        },

        setupEventListeners: function() {
            // Keep listeners ONLY for elements with specific UI updates beyond simple value changes
            if (this.elements.sleepDurationInput) {
                this.elements.sleepDurationInput.addEventListener('input', () => {
                    this.updateSleepDurationDisplay();
                    // No need to call checkForChanges here, handled by delegation
                });
            }
            // Remove other input listeners previously used for checkForChanges
        },

        updateSleepDurationDisplay: function() {
            // This function remains as it updates a specific UI element
            if (this.elements.sleepDurationInput && this.elements.sleepDurationHoursSpan) {
                const seconds = parseInt(this.elements.sleepDurationInput.value) || 900;
                // Assuming app.updateDurationDisplay exists and is accessible
                if (app && typeof app.updateDurationDisplay === 'function') {
                     app.updateDurationDisplay(seconds, this.elements.sleepDurationHoursSpan);
                } else {
                    console.warn("app.updateDurationDisplay not found, sleep duration text might not update.");
                }
            }
        }
    };

    // Initialize Radarr module
    document.addEventListener('DOMContentLoaded', () => {
        if (document.getElementById('radarrSettings')) {
            radarrModule.init();
            if (app) {
                app.radarrModule = radarrModule;
            }
        }
    });

})(window.sniparrUI); // Pass the global UI object


/* === modules/features/apps/lidarr.js === */
// Lidarr-specific functionality

(function(app) {
    if (!app) {
        console.error("Sniparr App core is not loaded!");
        return;
    }

    const lidarrModule = {
        elements: {
            apiUrlInput: document.getElementById('lidarr_api_url'),
            apiKeyInput: document.getElementById('lidarr_api_key'),
            connectionTestButton: document.getElementById('test-lidarr-connection'),
            huntMissingModeSelect: document.getElementById('hunt_missing_mode'),
            huntMissingItemsInput: document.getElementById('hunt_missing_items'),
            huntUpgradeItemsInput: document.getElementById('hunt_upgrade_items'),
            sleepDurationInput: document.getElementById('lidarr_sleep_duration'),
            sleepDurationHoursSpan: document.getElementById('lidarr_sleep_duration_hours'),
            stateResetIntervalInput: document.getElementById('lidarr_state_reset_interval_hours'),
            monitoredOnlyInput: document.getElementById('lidarr_monitored_only'),
            skipFutureReleasesInput: document.getElementById('lidarr_skip_future_releases'),
            skipArtistRefreshInput: document.getElementById('skip_artist_refresh'),
            randomMissingInput: document.getElementById('lidarr_random_missing'),
            randomUpgradesInput: document.getElementById('lidarr_random_upgrades'),
            debugModeInput: document.getElementById('lidarr_debug_mode'),
            apiTimeoutInput: document.getElementById('lidarr_api_timeout'),
            commandWaitDelayInput: document.getElementById('lidarr_command_wait_delay'),
            commandWaitAttemptsInput: document.getElementById('lidarr_command_wait_attempts'),
            minimumDownloadQueueSizeInput: document.getElementById('lidarr_minimum_download_queue_size')
        },

        init: function() {
            console.log('[Lidarr Module] Initializing...');
            // Cache elements specific to the Lidarr settings form
            this.elements = {
                apiUrlInput: document.getElementById('lidarr_api_url'),
                apiKeyInput: document.getElementById('lidarr_api_key'),
                connectionTestButton: document.getElementById('test-lidarr-connection'),
                huntMissingModeSelect: document.getElementById('hunt_missing_mode'),
                huntMissingItemsInput: document.getElementById('hunt_missing_items'),
                huntUpgradeItemsInput: document.getElementById('hunt_upgrade_items'),
                // ...other element references
            };

            // Add event listeners
            this.addEventListeners();
        },

        addEventListeners() {
            // Add connection test button click handler
            if (this.elements.connectionTestButton) {
                this.elements.connectionTestButton.addEventListener('click', this.testConnection.bind(this));
            }
            
            // Add event listener to update help text when missing mode changes
            if (this.elements.huntMissingModeSelect) {
                this.elements.huntMissingModeSelect.addEventListener('change', this.updateHuntMissingModeHelp.bind(this));
                // Initial update
                this.updateHuntMissingModeHelp();
            }
        },
        
        // Update help text based on selected missing mode
        updateHuntMissingModeHelp() {
            const mode = this.elements.huntMissingModeSelect.value;
            const helpText = document.querySelector('#hunt_missing_items + .setting-help');
            
            if (helpText) {
                if (mode === 'artist') {
                    helpText.textContent = "Number of artists with missing albums to search per cycle (0 to disable)";
                } else if (mode === 'album') {
                    helpText.textContent = "Number of specific albums to search per cycle (0 to disable)";
                }
            }
        },

        updateSleepDurationDisplay: function() {
            // This function remains as it updates a specific UI element
            if (this.elements.sleepDurationInput && this.elements.sleepDurationHoursSpan) {
                const seconds = parseInt(this.elements.sleepDurationInput.value) || 900;
                // Assuming app.updateDurationDisplay exists and is accessible
                if (app && typeof app.updateDurationDisplay === 'function') {
                     app.updateDurationDisplay(seconds, this.elements.sleepDurationHoursSpan);
                } else {
                    console.warn("app.updateDurationDisplay not found, sleep duration text might not update.");
                }
            }
        }
    };

    // Initialize Lidarr module when DOM content is loaded and if lidarrSettings exists
    document.addEventListener('DOMContentLoaded', () => {
        if (document.getElementById('lidarrSettings')) {
            lidarrModule.init();
            if (app) {
                app.lidarrModule = lidarrModule;
            }
        }
    });

})(window.sniparrUI); // Pass the global UI object


/* === modules/features/apps/readarr.js === */
// Readarr-specific functionality

(function(app) {
    if (!app) {
        console.error("Sniparr App core is not loaded!");
        return;
    }

    const readarrModule = {
        elements: {},

        init: function() {
            console.log('[Readarr Module] Initializing...');
            this.cacheElements();
            this.setupEventListeners();
        },

        cacheElements: function() {
            // Cache elements specific to the Readarr settings form
            this.elements.apiUrlInput = document.getElementById('readarr_api_url');
            this.elements.apiKeyInput = document.getElementById('readarr_api_key');
            this.elements.huntMissingBooksInput = document.getElementById('hunt_missing_books');
            this.elements.huntUpgradeBooksInput = document.getElementById('hunt_upgrade_books');
            this.elements.sleepDurationInput = document.getElementById('readarr_sleep_duration');
            this.elements.sleepDurationHoursSpan = document.getElementById('readarr_sleep_duration_hours');
            this.elements.stateResetIntervalInput = document.getElementById('readarr_state_reset_interval_hours');
            this.elements.monitoredOnlyInput = document.getElementById('readarr_monitored_only');
            this.elements.skipFutureReleasesInput = document.getElementById('readarr_skip_future_releases');
            this.elements.skipAuthorRefreshInput = document.getElementById('skip_author_refresh');
            this.elements.randomMissingInput = document.getElementById('readarr_random_missing');
            this.elements.randomUpgradesInput = document.getElementById('readarr_random_upgrades');
            this.elements.debugModeInput = document.getElementById('readarr_debug_mode');
            this.elements.apiTimeoutInput = document.getElementById('readarr_api_timeout');
            this.elements.commandWaitDelayInput = document.getElementById('readarr_command_wait_delay');
            this.elements.commandWaitAttemptsInput = document.getElementById('readarr_command_wait_attempts');
            this.elements.minimumDownloadQueueSizeInput = document.getElementById('readarr_minimum_download_queue_size');
            // Add any other Readarr-specific elements
        },

        setupEventListeners: function() {
            // Keep listeners ONLY for elements with specific UI updates beyond simple value changes
            if (this.elements.sleepDurationInput) {
                this.elements.sleepDurationInput.addEventListener('input', () => {
                    this.updateSleepDurationDisplay();
                    // No need to call checkForChanges here, handled by delegation
                });
            }
            // Remove other input listeners previously used for checkForChanges
        },

        updateSleepDurationDisplay: function() {
            // This function remains as it updates a specific UI element
            if (this.elements.sleepDurationInput && this.elements.sleepDurationHoursSpan) {
                const seconds = parseInt(this.elements.sleepDurationInput.value) || 900;
                // Assuming app.updateDurationDisplay exists and is accessible
                if (app && typeof app.updateDurationDisplay === 'function') {
                     app.updateDurationDisplay(seconds, this.elements.sleepDurationHoursSpan);
                } else {
                    console.warn("app.updateDurationDisplay not found, sleep duration text might not update.");
                }
            }
        }
    };

    // Initialize Readarr module
    document.addEventListener('DOMContentLoaded', () => {
        if (document.getElementById('readarrSettings')) {
            readarrModule.init();
            if (app) {
                app.readarrModule = readarrModule;
            }
        }
    });

})(window.sniparrUI); // Pass the global UI object


/* === modules/features/apps/whisparr.js === */
/**
 * Whisparr.js - Handles Whisparr settings and interactions in the Sniparr UI
 */

document.addEventListener("DOMContentLoaded", function() {
    // Don't call setupWhisparrForm here, app.js will call it when the tab is active
    // setupWhisparrForm(); 
    // setupWhisparrLogs(); // Assuming logs are handled by the main logs section
    // setupClearProcessedButtons('whisparr'); // Assuming this is handled elsewhere or not needed immediately
});

/**
 * Setup Whisparr settings form and connection test
 * This function is now called by app.js when the Whisparr settings tab is shown.
 */
function setupWhisparrForm() {
    // Use querySelector within the active panel to be safe, though IDs should be unique
    const panel = document.getElementById('whisparrSettings'); 
    if (!panel) {
        console.warn("[whisparr.js] Whisparr settings panel not found.");
        return;
    }

    const testWhisparrButton = panel.querySelector('#test-whisparr-button');
    const whisparrStatusIndicator = panel.querySelector('#whisparr-connection-status');
    const whisparrVersionDisplay = panel.querySelector('#whisparr-version');
    const apiUrlInput = panel.querySelector('#whisparr_api_url');
    const apiKeyInput = panel.querySelector('#whisparr_api_key');

    // Check if elements exist and if listener already attached to prevent duplicates
    if (!testWhisparrButton || testWhisparrButton.dataset.listenerAttached === 'true') {
         console.log("[whisparr.js] Test button not found or listener already attached.");
        return;
    }
     console.log("[whisparr.js] Setting up Whisparr form listeners.");
     testWhisparrButton.dataset.listenerAttached = 'true'; // Mark as attached

    // Test connection button
    testWhisparrButton.addEventListener('click', function() {
        // Temporarily suppress change detection to prevent the unsaved changes dialog
        window._suppressUnsavedChangesDialog = true;
        
        const apiUrl = apiUrlInput ? apiUrlInput.value.trim() : '';
        const apiKey = apiKeyInput ? apiKeyInput.value.trim() : '';
        
        if (!apiUrl || !apiKey) {
            // Reset suppression flag
            window._suppressUnsavedChangesDialog = false;
            
            // Use the main UI notification system if available
            if (typeof sniparrUI !== 'undefined' && sniparrUI.showNotification) {
                sniparrUI.showNotification('Please enter both API URL and API Key for Whisparr', 'error');
            } else {
                if (window.sniparrUI && window.sniparrUI.showNotification) window.sniparrUI.showNotification('Please enter both API URL and API Key for Whisparr', 'error');
                else alert('Please enter both API URL and API Key for Whisparr');
            }
            return;
        }
        
        testWhisparrButton.disabled = true;
        if (whisparrStatusIndicator) {
            whisparrStatusIndicator.className = 'connection-status pending';
            whisparrStatusIndicator.textContent = 'Testing...';
        }
        
        // Direct connection test - let the backend handle version checking
        SniparrUtils.fetchWithTimeout('./api/whisparr/test-connection', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                api_url: apiUrl,
                api_key: apiKey
            })
        })
        .then(response => response.json())
        .then(data => {
            if (whisparrStatusIndicator) {
                if (data.success) {
                    whisparrStatusIndicator.className = 'connection-status success';
                    whisparrStatusIndicator.textContent = 'Connected';
                    if (typeof sniparrUI !== 'undefined' && sniparrUI.showNotification) {
                         sniparrUI.showNotification('Successfully connected to Whisparr V2', 'success');
                    }
                    getWhisparrVersion(); // Fetch version after successful connection
                } else {
                    whisparrStatusIndicator.className = 'connection-status failure';
                    whisparrStatusIndicator.textContent = 'Failed';
                     if (typeof sniparrUI !== 'undefined' && sniparrUI.showNotification) {
                        sniparrUI.showNotification('Connection to Whisparr failed: ' + data.message, 'error');
                    }
                }
            }
        })
        .catch(error => {
            if (whisparrStatusIndicator) {
                whisparrStatusIndicator.className = 'connection-status failure';
                whisparrStatusIndicator.textContent = 'Error';
            }
            if (typeof sniparrUI !== 'undefined' && sniparrUI.showNotification) {
                sniparrUI.showNotification('Error testing Whisparr connection: ' + error, 'error');
            }
        })
        .finally(() => {
            if (testWhisparrButton.disabled) {
                testWhisparrButton.disabled = false;
            }
            
            // Reset suppression flag after a short delay
            setTimeout(() => {
                window._suppressUnsavedChangesDialog = false;
            }, 500);
        });
    });

    // Get Whisparr version if connection details are present and version display exists
    // Only perform auto-check if we haven't already fetched the version
    if (apiUrlInput && apiKeyInput && whisparrVersionDisplay && 
        apiUrlInput.value && apiKeyInput.value && 
        (!whisparrVersionDisplay.textContent || whisparrVersionDisplay.textContent === 'Unknown')) {
        
        // Set a flag to prevent automatic version checks from triggering unsaved changes
        const wasSettingsChanged = typeof sniparrUI !== 'undefined' ? sniparrUI.settingsChanged : false;
        
        getWhisparrVersion();
        
        // Restore the original settingsChanged state after the version check
        if (typeof sniparrUI !== 'undefined' && sniparrUI.settingsChanged !== wasSettingsChanged) {
            setTimeout(() => {
                sniparrUI.settingsChanged = wasSettingsChanged;
                console.log("[whisparr.js] Restored settingsChanged state after version check");
                
                // If there are no actual changes, update the save button state
                if (!wasSettingsChanged && typeof sniparrUI.updateSaveResetButtonState === 'function') {
                    sniparrUI.updateSaveResetButtonState(false);
                }
            }, 100);
        }
    }

    // Function to get Whisparr version
    function getWhisparrVersion() {
        if (!whisparrVersionDisplay) return; // Check if element exists

        const wasSettingsChanged = typeof sniparrUI !== 'undefined' ? sniparrUI.settingsChanged : false;
        
        SniparrUtils.fetchWithTimeout('./api/whisparr/get-versions')
            .then(response => {
                if (!response.ok) {
                    throw new Error('Failed to fetch Whisparr version');
                }
                return response.json();
            })
            .then(data => {
                if (data.success && data.version) {
                    // Temporarily store the textContent so we can detect if it actually changes
                    const oldContent = whisparrVersionDisplay.textContent;
                    const newContent = `v${data.version}`;
                    
                    if (oldContent !== newContent) {
                        whisparrVersionDisplay.textContent = newContent; // Prepend 'v'
                        
                        // Restore settings changed state to prevent triggering the dialog
                        if (typeof sniparrUI !== 'undefined') {
                            setTimeout(() => {
                                sniparrUI.settingsChanged = wasSettingsChanged;
                                
                                // If there are no actual changes, update the save button state
                                if (!wasSettingsChanged && typeof sniparrUI.updateSaveResetButtonState === 'function') {
                                    sniparrUI.updateSaveResetButtonState(false);
                                }
                            }, 50);
                        }
                    }
                } else {
                    whisparrVersionDisplay.textContent = 'Unknown';
                }
            })
            .catch(error => {
                whisparrVersionDisplay.textContent = 'Error';
                console.error('Error fetching Whisparr version:', error);
            })
            .finally(() => {
                // Final safety check to restore settings state
                if (typeof sniparrUI !== 'undefined' && sniparrUI.settingsChanged !== wasSettingsChanged) {
                    setTimeout(() => {
                        sniparrUI.settingsChanged = wasSettingsChanged;
                        // If there are no actual changes, update the save button state
                        if (!wasSettingsChanged && typeof sniparrUI.updateSaveResetButtonState === 'function') {
                            sniparrUI.updateSaveResetButtonState(false);
                        }
                    }, 100);
                }
            });
    }
}



/* === modules/features/apps/eros.js === */
/**
 * Eros.js - Handles Eros settings and interactions in the Sniparr UI
 */

document.addEventListener('DOMContentLoaded', function() {
    // Don't call setupErosForm here, app.js will call it when the tab is active
    // setupErosForm(); 
    // setupErosLogs(); // Assuming logs are handled by the main logs section
    // setupClearProcessedButtons('eros'); // Assuming this is handled elsewhere or not needed immediately
});

/**
 * Setup Eros settings form and connection test
 * This function is now called by app.js when the Eros settings tab is shown.
 */
function setupErosForm() {
    console.log("[eros.js] Setting up Eros form...");
    const panel = document.getElementById('erosSettings'); 
    if (!panel) {
        console.warn("[eros.js] Eros settings panel not found.");
        return;
    }
  
    const testErosButton = panel.querySelector('#test-eros-button');
    const erosStatusIndicator = panel.querySelector('#eros-connection-status');
    const erosVersionDisplay = panel.querySelector('#eros-version');
    const apiUrlInput = panel.querySelector('#eros_api_url');
    const apiKeyInput = panel.querySelector('#eros_api_key');
    
    // Check if event listener is already attached (prevents duplicate handlers)
    if (!testErosButton || testErosButton.dataset.listenerAttached === 'true') {
         console.log("[eros.js] Test button not found or listener already attached.");
         return;
    }
     console.log("[eros.js] Setting up Eros form listeners.");
     testErosButton.dataset.listenerAttached = 'true'; // Mark as attached
    
    // Add event listener for connection test
    testErosButton.addEventListener('click', function() {
        console.log("[eros.js] Testing Eros connection...");
        
        // Temporarily suppress change detection to prevent the unsaved changes dialog
        window._suppressUnsavedChangesDialog = true;
        
        // Basic validation
        if (!apiUrlInput.value || !apiKeyInput.value) {
            // Reset suppression flag
            window._suppressUnsavedChangesDialog = false;
            
            if (typeof sniparrUI !== 'undefined') {
                sniparrUI.showNotification('Please enter both API URL and API Key for Eros', 'error');
            } else {
                if (window.sniparrUI && window.sniparrUI.showNotification) window.sniparrUI.showNotification('Please enter both API URL and API Key for Eros', 'error');
                else alert('Please enter both API URL and API Key for Eros');
            }
            return;
        }
        
        // Disable button during test and show pending status
        testErosButton.disabled = true;
        if (erosStatusIndicator) {
            erosStatusIndicator.className = 'connection-status pending';
            erosStatusIndicator.textContent = 'Testing...';
        }
        
        // Call API to test connection
        SniparrUtils.fetchWithTimeout('./api/eros/test-connection', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                api_url: apiUrlInput.value,
                api_key: apiKeyInput.value,
                api_timeout: 30
            })
        }, 30000) // 30 second timeout
        .then(response => response.json())
        .then(data => {
            // Enable the button again
            testErosButton.disabled = false;
            
            // Reset suppression flag after a short delay
            setTimeout(() => {
                window._suppressUnsavedChangesDialog = false;
            }, 500);
            
            if (erosStatusIndicator) {
                if (data.success) {
                    erosStatusIndicator.className = 'connection-status success';
                    erosStatusIndicator.textContent = 'Connected';
                    if (typeof sniparrUI !== 'undefined') {
                         sniparrUI.showNotification('Successfully connected to Eros', 'success');
                    }
                    getErosVersion(); // Fetch version after successful connection
                } else {
                    erosStatusIndicator.className = 'connection-status failure';
                    erosStatusIndicator.textContent = 'Failed';
                    if (typeof sniparrUI !== 'undefined') {
                        sniparrUI.showNotification(data.message || 'Failed to connect to Eros', 'error');
                    } else {
                        if (window.sniparrUI && window.sniparrUI.showNotification) window.sniparrUI.showNotification(data.message || 'Failed to connect to Eros', 'error');
                        else alert(data.message || 'Failed to connect to Eros');
                    }
                }
            }
        })
        .catch(error => {
            console.error('[eros.js] Error testing connection:', error);
            testErosButton.disabled = false;
            
            // Reset suppression flag
            window._suppressUnsavedChangesDialog = false;
            
            if (erosStatusIndicator) {
                erosStatusIndicator.className = 'connection-status failure';
                erosStatusIndicator.textContent = 'Error';
            }
            
            if (typeof sniparrUI !== 'undefined') {
                sniparrUI.showNotification('Error testing connection: ' + error.message, 'error');
            } else {
                if (window.sniparrUI && window.sniparrUI.showNotification) window.sniparrUI.showNotification('Error testing connection: ' + error.message, 'error');
                else alert('Error testing connection: ' + error.message);
            }
        });
    });
    
    // Initialize form state and fetch data
    refreshErosStatusAndVersion();
}

/**
 * Get the Eros software version from the instance.
 * This is separate from the API test.
 */
function getErosVersion() {
    const panel = document.getElementById('erosSettings');
    if (!panel) return;
    
    const versionDisplay = panel.querySelector('#eros-version');
    if (!versionDisplay) return;
    
    // Try to get the API settings from the form
    const apiUrlInput = panel.querySelector('#eros_api_url');
    const apiKeyInput = panel.querySelector('#eros_api_key');
    
    if (!apiUrlInput || !apiUrlInput.value || !apiKeyInput || !apiKeyInput.value) {
        versionDisplay.textContent = 'N/A';
        return;
    }
    
    // Endpoint to get version info - using the test endpoint since it returns version
    SniparrUtils.fetchWithTimeout('./api/eros/test-connection', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            api_url: apiUrlInput.value,
            api_key: apiKeyInput.value,
            api_timeout: 10
        })
    }, 10000)
    .then(response => response.json())
    .then(data => {
        if (data.success && data.version) {
            versionDisplay.textContent = 'v' + data.version;
        } else {
            versionDisplay.textContent = 'Unknown';
        }
    })
    .catch(error => {
        console.error('[eros.js] Error fetching version:', error);
        versionDisplay.textContent = 'Error';
    });
}

/**
 * Refresh the connection status and version display for Eros.
 */
function refreshErosStatusAndVersion() {
    // Try to get current connection status from the server
    SniparrUtils.fetchWithTimeout('./api/eros/status')
        .then(response => response.json())
        .then(data => {
            const panel = document.getElementById('erosSettings');
            if (!panel) return;
            
            const statusIndicator = panel.querySelector('#eros-connection-status');
            if (statusIndicator) {
                if (data.connected) {
                    statusIndicator.className = 'connection-status success';
                    statusIndicator.textContent = 'Connected';
                    getErosVersion(); // Try to get version if connected
                } else if (data.configured) {
                    statusIndicator.className = 'connection-status failure';
                    statusIndicator.textContent = 'Not Connected';
                } else {
                    statusIndicator.className = 'connection-status pending';
                    statusIndicator.textContent = 'Not Configured';
                }
            }
        })
        .catch(error => {
            console.error('[eros.js] Error checking status:', error);
        });
}

// Mark functions as global if needed by other parts of the application
window.setupErosForm = setupErosForm;
window.getErosVersion = getErosVersion;
window.refreshErosStatusAndVersion = refreshErosStatusAndVersion;


/* === modules/features/apps/swaparr-view.js === */
// Enhanced Swaparr-specific functionality

(function(app) {
    if (!app) {
        console.error("Sniparr App core is not loaded!");
        return;
    }

    const swaparrModule = {
        elements: {},
        isTableView: true, // Default to table view for Swaparr logs
        hasRenderedAnyContent: false, // Track if we've rendered any content
        
        // Store data for display with enhanced structure
        logData: {
            config: {
                platform: '',
                maxStrikes: 3,
                scanInterval: '10m',
                maxDownloadTime: '2h',
                ignoreAboveSize: '25 GB',
                dryRun: false,
                removeFromClient: true
            },
            downloads: [],  // Will store download status records
            statistics: {   // Enhanced statistics tracking
                session: {
                    total_processed: 0,
                    strikes_added: 0,
                    downloads_removed: 0,
                    items_ignored: 0,
                    api_calls_made: 0,
                    errors_encountered: 0,
                    apps_processed: [],
                    last_update: null
                },
                apps: {} // Per-app statistics
            },
            rawLogs: []     // Store raw logs for backup display
        },

        init: function() {
            console.log('[Swaparr Module] Initializing enhanced Swaparr module...');
            this.setupLogProcessor();
            this.setupEventListeners();
            
            // Try to load initial statistics
            this.loadStatistics();
        },

        setupEventListeners: function() {
            // Add a listener for when the log tab changes to Swaparr
            const swaparrTab = document.querySelector('.log-tab[data-app="swaparr"]');
            if (swaparrTab) {
                swaparrTab.addEventListener('click', () => {
                    console.log('[Swaparr Module] Swaparr tab clicked');
                    // Small delay to ensure everything is ready
                    setTimeout(() => {
                        this.ensureContentRendered();
                    }, 200);
                });
            }
        },

        setupLogProcessor: function() {
            // Setup a listener for custom event from sniparrUI's log processing
            document.addEventListener('swaparrLogReceived', (event) => {
                console.log('[Swaparr Module] Received log event:', event.detail.logData.substring(0, 100) + '...');
                this.processLogLine(event.detail.logData);
            });
        },

        loadStatistics: function() {
            // Load statistics from the API
            SniparrUtils.fetchWithTimeout('./api/swaparr/status')
                .then(response => response.json())
                .then(data => {
                    if (data.session_statistics) {
                        this.logData.statistics.session = data.session_statistics;
                    }
                    if (data.app_statistics) {
                        this.logData.statistics.apps = data.app_statistics;
                    }
                    if (data.settings) {
                        this.updateConfigFromSettings(data.settings);
                    }
                    
                    console.log('[Swaparr Module] Loaded statistics from API');
                    
                    // Re-render if we're viewing Swaparr
                    if (app.currentLogApp === 'swaparr') {
                        this.ensureContentRendered();
                    }
                })
                .catch(error => {
                    console.warn('[Swaparr Module] Could not load statistics:', error);
                });
        },

        updateConfigFromSettings: function(settings) {
            this.logData.config.maxStrikes = settings.max_strikes || 3;
            this.logData.config.maxDownloadTime = settings.max_download_time || '2h';
            this.logData.config.ignoreAboveSize = settings.ignore_above_size || '25GB';
            this.logData.config.dryRun = settings.dry_run || false;
            this.logData.config.removeFromClient = settings.remove_from_client !== false;
        },

        processLogLine: function(logLine) {
            // Always store raw logs for backup display
            this.logData.rawLogs.push(logLine);
            
            // Limit raw logs storage to prevent memory issues
            if (this.logData.rawLogs.length > 500) {
                this.logData.rawLogs.shift();
            }
            
            // Process log lines specific to Swaparr
            if (!logLine) return;

            // Check if this looks like a Swaparr config line and extract information
            if (logLine.includes('Platform:') && logLine.includes('Max strikes:')) {
                this.extractConfigInfo(logLine);
                this.renderConfigPanel();
                return;
            }
            
            // Look for enhanced strike-related logs from system
            if (logLine.includes('Added strike') || 
                logLine.includes('Max strikes reached') || 
                logLine.includes('removing download') ||
                logLine.includes('Would have removed') ||
                logLine.includes('Successfully removed') ||
                logLine.includes('Re-removed previously removed') ||
                logLine.includes('Session stats')) {
                
                this.processStrikeLog(logLine);
                return;
            }

            // Check for session statistics updates
            if (logLine.includes('Session stats - Strikes:')) {
                this.extractSessionStats(logLine);
                this.renderStatisticsPanel();
                return;
            }

            // Check if this is a table header/separator line
            if (logLine.includes('strikes') && logLine.includes('status') && logLine.includes('name') && logLine.includes('size') && logLine.includes('eta')) {
                // This is the header line, we can ignore it or use it to confirm table format
                return;
            }

            // Try to match enhanced download info line
            const downloadLinePattern = /(\d+\/\d+)\s+(\w+)\s+(.+?)\s+(\d+(?:\.\d+)?)\s*(\w+)\s+([\ddhms\s]+|Infinite)/;
            const match = logLine.match(downloadLinePattern);
            
            if (match) {
                // Extract download information
                const downloadInfo = {
                    strikes: match[1],
                    status: match[2],
                    name: match[3],
                    size: match[4] + ' ' + match[5],
                    eta: match[6],
                    timestamp: new Date().toISOString()
                };
                
                // Update or add to our list of downloads
                this.updateDownloadsList(downloadInfo);
                this.renderTableView();
            }
            
            // If we're viewing the Swaparr tab, always ensure content is rendered
            if (app.currentLogApp === 'swaparr') {
                this.ensureContentRendered();
            }
        },

        extractSessionStats: function(logLine) {
            // Extract session statistics from log line
            // Format: "Session stats - Strikes: X, Removed: Y, Ignored: Z, API calls: W"
            const strikes = logLine.match(/Strikes: (\d+)/);
            const removed = logLine.match(/Removed: (\d+)/);
            const ignored = logLine.match(/Ignored: (\d+)/);
            const apiCalls = logLine.match(/API calls: (\d+)/);
            
            if (strikes) this.logData.statistics.session.strikes_added = parseInt(strikes[1]);
            if (removed) this.logData.statistics.session.downloads_removed = parseInt(removed[1]);
            if (ignored) this.logData.statistics.session.items_ignored = parseInt(ignored[1]);
            if (apiCalls) this.logData.statistics.session.api_calls_made = parseInt(apiCalls[1]);
            
            this.logData.statistics.session.last_update = new Date().toISOString();
        },
        
        // Process enhanced strike-related logs from system logs
        processStrikeLog: function(logLine) {
            // Try to extract download name and strike info
            let downloadName = '';
            let strikes = '1/3'; // Default value
            let status = 'Striked';
            
            // Extract download name and update statistics
            if (logLine.includes('Added strike')) {
                const match = logLine.match(/Added strike \((\d+)\/(\d+)\) to (.+?) - Reason:/);
                if (match) {
                    strikes = `${match[1]}/${match[2]}`;
                    downloadName = match[3];
                    status = 'Striked';
                    this.logData.statistics.session.strikes_added++;
                }
            } else if (logLine.includes('Max strikes reached')) {
                const match = logLine.match(/Max strikes reached for (.+?), removing download/);
                if (match) {
                    downloadName = match[1];
                    status = 'Removing';
                }
            } else if (logLine.includes('Successfully removed')) {
                const match = logLine.match(/Successfully removed (.+?) after (\d+) strikes/);
                if (match) {
                    downloadName = match[1];
                    status = 'Removed';
                    strikes = `${match[2]}/3`;
                    this.logData.statistics.session.downloads_removed++;
                }
            } else if (logLine.includes('Would have removed')) {
                const match = logLine.match(/Would have removed (.+?) after (\d+) strikes/);
                if (match) {
                    downloadName = match[1];
                    status = 'Pending Removal (Dry Run)';
                    strikes = `${match[2]}/3`;
                }
            } else if (logLine.includes('Re-removed previously removed')) {
                const match = logLine.match(/Re-removed previously removed download: (.+)/);
                if (match) {
                    downloadName = match[1];
                    status = 'Re-removed';
                    this.logData.statistics.session.downloads_removed++;
                }
            }
            
            if (downloadName) {
                // Create a download info object with partial information
                const downloadInfo = {
                    strikes: strikes,
                    status: status,
                    name: downloadName,
                    size: 'Unknown',
                    eta: 'Unknown',
                    timestamp: new Date().toISOString()
                };
                
                // Update downloads list
                this.updateDownloadsList(downloadInfo);
                this.renderTableView();
                this.renderStatisticsPanel(); // Update statistics display
            }
        },

        extractConfigInfo: function(logLine) {
            // Extract the config data from the log line
            const platformMatch = logLine.match(/Platform:\s+(\w+)/);
            const maxStrikesMatch = logLine.match(/Max strikes:\s+(\d+)/);
            const scanIntervalMatch = logLine.match(/Scan interval:\s+(\d+\w+)/);
            const maxDownloadTimeMatch = logLine.match(/Max download time:\s+(\d+\w+)/);
            const ignoreSizeMatch = logLine.match(/Ignore above size:\s+(\d+\s*\w+)/);
            
            if (platformMatch) this.logData.config.platform = platformMatch[1];
            if (maxStrikesMatch) this.logData.config.maxStrikes = maxStrikesMatch[1];
            if (scanIntervalMatch) this.logData.config.scanInterval = scanIntervalMatch[1];
            if (maxDownloadTimeMatch) this.logData.config.maxDownloadTime = maxDownloadTimeMatch[1];
            if (ignoreSizeMatch) this.logData.config.ignoreAboveSize = ignoreSizeMatch[1];
        },

        updateDownloadsList: function(downloadInfo) {
            // Find if this download already exists in our list
            const existingIndex = this.logData.downloads.findIndex(item => 
                item.name.trim() === downloadInfo.name.trim()
            );
            
            if (existingIndex >= 0) {
                // Update existing entry but preserve timestamp if newer
                const existing = this.logData.downloads[existingIndex];
                this.logData.downloads[existingIndex] = {
                    ...downloadInfo,
                    first_seen: existing.first_seen || existing.timestamp || downloadInfo.timestamp
                };
            } else {
                // Add new entry
                downloadInfo.first_seen = downloadInfo.timestamp;
                this.logData.downloads.push(downloadInfo);
            }
            
            // Keep only the last 100 downloads to prevent memory issues
            if (this.logData.downloads.length > 100) {
                this.logData.downloads = this.logData.downloads.slice(-100);
            }
        },

        renderConfigPanel: function() {
            // Find the logs container
            const logsContainer = document.getElementById('logsContainer');
            if (!logsContainer) return;
            
            // If the user has selected swaparr logs, show the config panel at the top
            if (app.currentLogApp === 'swaparr') {
                // Check if config panel already exists
                let configPanel = document.getElementById('swaparr-config-panel');
                if (!configPanel) {
                    // Create the panel
                    configPanel = document.createElement('div');
                    configPanel.id = 'swaparr-config-panel';
                    configPanel.classList.add('swaparr-panel');
                    logsContainer.appendChild(configPanel);
                }
                
                const dryRunBadge = this.logData.config.dryRun ? 
                    '<span class="swaparr-badge swaparr-badge-warning">DRY RUN</span>' : '';
                
                // Update the panel content with enhanced information
                configPanel.innerHTML = `
                    <div class="swaparr-config">
                        <h3>
                            <i class="fas fa-exchange-alt"></i>
                            Swaparr${this.logData.config.platform ? ' — ' + this.logData.config.platform : ''}
                            ${dryRunBadge}
                        </h3>
                        <div class="swaparr-config-content">
                            <div class="config-item">
                                <i class="fas fa-exclamation-triangle"></i>
                                <span>Max strikes: <strong>${this.logData.config.maxStrikes}</strong></span>
                            </div>
                            <div class="config-item">
                                <i class="fas fa-clock"></i>
                                <span>Max download time: <strong>${this.logData.config.maxDownloadTime}</strong></span>
                            </div>
                            <div class="config-item">
                                <i class="fas fa-weight-hanging"></i>
                                <span>Ignore above: <strong>${this.logData.config.ignoreAboveSize}</strong></span>
                            </div>
                            <div class="config-item">
                                <i class="fas fa-trash-alt"></i>
                                <span>Remove from client: <strong>${this.logData.config.removeFromClient ? 'Yes' : 'No'}</strong></span>
                            </div>
                        </div>
                    </div>
                `;
                
                this.hasRenderedAnyContent = true;
            }
        },

        renderStatisticsPanel: function() {
            // Find the logs container
            const logsContainer = document.getElementById('logsContainer');
            if (!logsContainer || app.currentLogApp !== 'swaparr') return;
            
            // Check if statistics panel already exists
            let statsPanel = document.getElementById('swaparr-stats-panel');
            if (!statsPanel) {
                // Create the panel
                statsPanel = document.createElement('div');
                statsPanel.id = 'swaparr-stats-panel';
                statsPanel.classList.add('swaparr-panel');
                logsContainer.appendChild(statsPanel);
            }
            
            const stats = this.logData.statistics.session;
            const lastUpdate = stats.last_update ? 
                new Date(stats.last_update).toLocaleTimeString() : 'Never';
            
            // Generate app-specific statistics
            let appStatsHtml = '';
            for (const [appName, appStats] of Object.entries(this.logData.statistics.apps)) {
                if (appStats.error) continue;
                
                appStatsHtml += `
                    <div class="app-stat">
                        <strong>${appName.toUpperCase()}</strong>: 
                        ${appStats.currently_striked || 0} striked, 
                        ${appStats.total_removed || 0} removed
                    </div>
                `;
            }
            
            // Update the panel content
            statsPanel.innerHTML = `
                <div class="swaparr-statistics">
                    <h4><i class="fas fa-chart-line"></i> Session Statistics</h4>
                    <div class="stats-grid">
                        <div class="stat-item">
                            <i class="fas fa-tasks"></i>
                            <span class="stat-value">${stats.total_processed || 0}</span>
                            <span class="stat-label">Processed</span>
                        </div>
                        <div class="stat-item">
                            <i class="fas fa-exclamation-triangle"></i>
                            <span class="stat-value">${stats.strikes_added || 0}</span>
                            <span class="stat-label">Strikes Added</span>
                        </div>
                        <div class="stat-item">
                            <i class="fas fa-trash-alt"></i>
                            <span class="stat-value">${stats.downloads_removed || 0}</span>
                            <span class="stat-label">Removed</span>
                        </div>
                        <div class="stat-item">
                            <i class="fas fa-eye-slash"></i>
                            <span class="stat-value">${stats.items_ignored || 0}</span>
                            <span class="stat-label">Ignored</span>
                        </div>
                        <div class="stat-item">
                            <i class="fas fa-network-wired"></i>
                            <span class="stat-value">${stats.api_calls_made || 0}</span>
                            <span class="stat-label">API Calls</span>
                        </div>
                        <div class="stat-item">
                            <i class="fas fa-exclamation-circle"></i>
                            <span class="stat-value">${stats.errors_encountered || 0}</span>
                            <span class="stat-label">Errors</span>
                        </div>
                    </div>
                    <div class="stats-apps">
                        ${appStatsHtml}
                    </div>
                    <div class="stats-footer">
                        <small>Last update: ${lastUpdate}</small>
                    </div>
                </div>
            `;
            
            this.hasRenderedAnyContent = true;
        },

        renderTableView: function() {
            // Find the logs container
            const logsContainer = document.getElementById('logsContainer');
            if (!logsContainer || app.currentLogApp !== 'swaparr') return;
            
            // Check if table already exists
            let tableView = document.getElementById('swaparr-table-view');
            if (!tableView) {
                // Create the table
                tableView = document.createElement('div');
                tableView.id = 'swaparr-table-view';
                tableView.classList.add('swaparr-table');
                logsContainer.appendChild(tableView);
            }
            
            // Only render table if we have downloads to show
            if (this.logData.downloads.length > 0) {
                // Generate table HTML with enhanced styling
                let tableHTML = `
                    <div class="swaparr-table-header">
                        <h4><i class="fas fa-download"></i> Download Queue Status (${this.logData.downloads.length} items)</h4>
                    </div>
                    <table class="swaparr-downloads-table">
                        <thead>
                            <tr>
                                <th><i class="fas fa-exclamation-triangle"></i> Strikes</th>
                                <th><i class="fas fa-info-circle"></i> Status</th>
                                <th><i class="fas fa-file"></i> Name</th>
                                <th><i class="fas fa-weight-hanging"></i> Size</th>
                                <th><i class="fas fa-clock"></i> ETA</th>
                                <th><i class="fas fa-calendar-alt"></i> First Seen</th>
                            </tr>
                        </thead>
                        <tbody>
                `;
                
                // Sort downloads by timestamp (newest first)
                const sortedDownloads = [...this.logData.downloads].sort((a, b) => 
                    new Date(b.timestamp || 0) - new Date(a.timestamp || 0)
                );
                
                // Add each download as a row
                sortedDownloads.forEach(download => {
                    // Apply status-specific CSS class
                    let statusClass = download.status.toLowerCase().replace(/\s+/g, '-');
                    
                    // Normalize some status values
                    if (statusClass.includes('pending')) statusClass = 'pending';
                    if (statusClass.includes('removed')) statusClass = 'removed';
                    if (statusClass.includes('striked')) statusClass = 'striked';
                    if (statusClass.includes('normal')) statusClass = 'normal';
                    if (statusClass.includes('ignored')) statusClass = 'ignored';
                    if (statusClass.includes('dry-run')) statusClass = 'dry-run';
                    
                    const firstSeen = download.first_seen ? 
                        new Date(download.first_seen).toLocaleString() : 'Unknown';
                    
                    tableHTML += `
                        <tr class="swaparr-status-${statusClass}">
                            <td><span class="strikes-badge">${download.strikes}</span></td>
                            <td><span class="status-badge status-${statusClass}">${download.status}</span></td>
                            <td title="${download.name}">${download.name}</td>
                            <td>${download.size}</td>
                            <td>${download.eta}</td>
                            <td><small>${firstSeen}</small></td>
                        </tr>
                    `;
                });
                
                tableHTML += `
                        </tbody>
                    </table>
                `;
                
                tableView.innerHTML = tableHTML;
                this.hasRenderedAnyContent = true;
            } else {
                // Show empty state
                tableView.innerHTML = `
                    <div class="swaparr-empty-state">
                        <i class="fas fa-download"></i>
                        <h4>No Downloads Tracked</h4>
                        <p>Swaparr is monitoring download queues but hasn't found any stalled downloads yet.</p>
                    </div>
                `;
                this.hasRenderedAnyContent = true;
            }
        },
        
        // Render raw logs if we don't have structured content
        renderRawLogs: function() {
            // Only show raw logs if we have no other content
            if (this.hasRenderedAnyContent) return;
            
            const logsContainer = document.getElementById('logsContainer');
            if (!logsContainer || app.currentLogApp !== 'swaparr') return;
            
            // Start with a message
            const noDataMessage = document.createElement('div');
            noDataMessage.classList.add('swaparr-panel');
            noDataMessage.innerHTML = `
                <div class="swaparr-config">
                    <h3><i class="fas fa-exchange-alt"></i> Swaparr Logs</h3>
                    <p>Waiting for structured Swaparr data. Showing raw logs below:</p>
                </div>
            `;
            logsContainer.appendChild(noDataMessage);
            
            // Add raw logs
            for (const logLine of this.logData.rawLogs.slice(-50)) { // Show only last 50 lines
                const logEntry = document.createElement('div');
                logEntry.className = 'log-entry';
                logEntry.innerHTML = `<span class="log-message">${logLine}</span>`;
                
                // Basic level detection
                if (logLine.includes('ERROR')) logEntry.classList.add('log-error');
                else if (logLine.includes('WARN') || logLine.includes('WARNING')) logEntry.classList.add('log-warning');
                else if (logLine.includes('DEBUG')) logEntry.classList.add('log-debug');
                else logEntry.classList.add('log-info');
                
                logsContainer.appendChild(logEntry);
            }
            
            this.hasRenderedAnyContent = true;
        },
        
        // Make sure we display something in the Swaparr tab
        ensureContentRendered: function() {
            console.log('[Swaparr Module] Ensuring content is rendered, has content:', this.hasRenderedAnyContent);
            
            // Reset rendered flag
            this.hasRenderedAnyContent = false;
            
            // Check if we're viewing Swaparr tab
            if (app.currentLogApp !== 'swaparr') return;
            
            // Clear existing content
            const logsContainer = document.getElementById('logsContainer');
            if (logsContainer) {
                // Remove only Swaparr-specific content
                const swaparrElements = logsContainer.querySelectorAll('[id^="swaparr-"], .swaparr-panel, .swaparr-table, .swaparr-empty-state');
                swaparrElements.forEach(el => el.remove());
            }
            
            // First try to render structured content
            this.renderConfigPanel();
            this.renderStatisticsPanel();
            this.renderTableView();
            
            // If no structured content, show raw logs
            if (!this.hasRenderedAnyContent) {
                this.renderRawLogs();
            }
        },

        // Clear the data when switching log views
        clearData: function() {
            this.logData.downloads = [];
            // Keep raw logs and statistics for persistence
            this.hasRenderedAnyContent = false;
        }
    };

    // Initialize the module
    document.addEventListener('DOMContentLoaded', () => {
        swaparrModule.init();
        
        if (app) {
            app.swaparrModule = swaparrModule;
            
            // Setup a handler for when log tabs are changed
            document.querySelectorAll('.log-tab').forEach(tab => {
                tab.addEventListener('click', (e) => {
                    // If switching to swaparr tab, make sure we render the view
                    if (e.target.getAttribute('data-app') === 'swaparr') {
                        console.log('[Swaparr Module] Swaparr tab clicked via delegation');
                        // Small delay to allow logs to load
                        setTimeout(() => {
                            swaparrModule.ensureContentRendered();
                        }, 200);
                    }
                    // If switching away from swaparr tab, clear the visual data
                    else if (app.currentLogApp === 'swaparr') {
                        swaparrModule.clearData();
                    }
                });
            });
        }
    });

})(window.sniparrUI); // Pass the global UI object 

/* === modules/ui/stats.js === */
/**
 * Stats & Dashboard Module
 * Handles media stats, app connections, dashboard display,
 * grid/list view, live polling, and drag-and-drop reordering.
 */

window.SniparrStats = {
    isLoadingStats: false,
    _pollInterval: null,
    _currentViewMode: 'list', // 'grid' or 'list'
    _lastRenderedMode: null,  // Track which mode we last rendered

    // App metadata: order, display names, icons, accent colors
    APP_META: {
        sonarr:     { label: 'Sonarr',     icon: './static/images/app-icons/sonarr.png', accent: '#6366f1' },
        radarr:     { label: 'Radarr',     icon: './static/images/app-icons/radarr.png', accent: '#f59e0b' },
        lidarr:     { label: 'Lidarr',     icon: './static/images/app-icons/lidarr.png', accent: '#22c55e' },
        readarr:    { label: 'Readarr',    icon: './static/images/app-icons/readarr.png', accent: '#a855f7' },
        whisparr:   { label: 'Whisparr V2', icon: './static/images/app-icons/whisparr.png', accent: '#ec4899' },
        eros:       { label: 'Whisparr V3', icon: './static/images/app-icons/whisparr.png', accent: '#ec4899' },
    },
    DEFAULT_APP_ORDER: ['sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros'],

    // ─── Polling ──────────────────────────────────────────────────────
    startPolling: function() {
        this.stopPolling();
        var self = this;
        this._pollInterval = setInterval(function() {
            self.loadMediaStats(true);
        }, 15000);
    },

    stopPolling: function() {
        if (this._pollInterval) {
            clearInterval(this._pollInterval);
            this._pollInterval = null;
        }
        this._stopNzbHomePoll();
    },

    // ─── Layout Persistence ───────────────────────────────────────────
    _getLayout: function() {
        return SniparrUtils.getUIPreference('dashboard-layout', null);
    },

    _saveLayout: function(layout) {
        SniparrUtils.setUIPreference('dashboard-layout', layout);
    },

    _getGroupOrder: function() {
        var layout = this._getLayout();
        if (layout && Array.isArray(layout.groups) && layout.groups.length > 0) {
            var order = layout.groups.slice();
            this.DEFAULT_APP_ORDER.forEach(function(app) {
                if (order.indexOf(app) === -1) order.push(app);
            });
            return order;
        }
        return this.DEFAULT_APP_ORDER.slice();
    },

    _getCardOrder: function() {
        var layout = this._getLayout();
        if (layout && Array.isArray(layout.cards) && layout.cards.length > 0) {
            return layout.cards;
        }
        return null;
    },

    // Collect card order for grid mode (flat list of {app, instance} pairs)
    _collectGridOrder: function() {
        var grid = document.getElementById('app-stats-grid');
        if (!grid) return;
        var cards = grid.querySelectorAll('.app-stats-card[data-app][data-instance-name]');
        var cardOrder = [];
        cards.forEach(function(c) {
            cardOrder.push({
                app: c.getAttribute('data-app'),
                instance: c.getAttribute('data-instance-name')
            });
        });
        // Also build group order from the card order (for list mode)
        var seen = {};
        var groups = [];
        cardOrder.forEach(function(c) {
            if (!seen[c.app]) {
                seen[c.app] = true;
                groups.push(c.app);
            }
        });
        this._saveLayout({ groups: groups, cards: cardOrder });
    },

    // Collect group order for list mode
    _collectListOrder: function() {
        var grid = document.getElementById('app-stats-grid');
        if (!grid) return;
        var groupEls = grid.querySelectorAll('.app-group');
        var groups = [];
        groupEls.forEach(function(g) {
            var app = g.getAttribute('data-app');
            if (app) groups.push(app);
        });
        var layout = this._getLayout() || {};
        layout.groups = groups;
        this._saveLayout(layout);
    },

    // ─── View Mode ────────────────────────────────────────────────────
    _getViewMode: function() {
        var mode = SniparrUtils.getUIPreference('dashboard-view-mode', 'list');
        if (mode === 'list' || mode === 'grid') return mode;
        return 'list';
    },

    _setViewMode: function(mode) {
        this._currentViewMode = mode;
        SniparrUtils.setUIPreference('dashboard-view-mode', mode);
    },

    initViewToggle: function() {
        var self = this;
        var savedMode = this._getViewMode();
        var needsRerender = (this._lastRenderedMode && savedMode !== this._lastRenderedMode);
        this._currentViewMode = savedMode;

        var toggleGroup = document.getElementById('dashboard-view-toggle');
        if (!toggleGroup) return;

        // Remove old listeners by cloning
        var newToggle = toggleGroup.cloneNode(true);
        toggleGroup.parentNode.replaceChild(newToggle, toggleGroup);

        var btns = newToggle.querySelectorAll('.view-toggle-btn');
        btns.forEach(function(btn) {
            btn.classList.toggle('active', btn.getAttribute('data-view') === self._currentViewMode);
            btn.addEventListener('click', function() {
                var mode = this.getAttribute('data-view');
                if (mode === self._currentViewMode) return;
                btns.forEach(function(b) { b.classList.remove('active'); });
                this.classList.add('active');
                self._setViewMode(mode);
                self._clearDynamicContent();
                if (window.mediaStats) {
                    self.updateStatsDisplay(window.mediaStats);
                }
            });
        });

        // If the saved view mode differs from what was rendered, re-render now
        if (needsRerender && window.mediaStats) {
            this._clearDynamicContent();
            this.updateStatsDisplay(window.mediaStats);
        }
    },

    // Clear all dynamically generated content + sortable instances
    _clearDynamicContent: function() {
        // Destroy sortable instances
        if (this._sortableGrid) {
            this._sortableGrid.destroy();
            this._sortableGrid = null;
        }
        var grid = document.getElementById('app-stats-grid');
        if (!grid) return;
        // Remove all dynamic elements (app-group containers and direct app-stats-cards we created)
        var dynamicEls = grid.querySelectorAll('.app-group, .app-stats-card.dynamic-card');
        dynamicEls.forEach(function(el) { el.remove(); });
        this._lastRenderedMode = null;
    },

    // ─── Stats Loading ────────────────────────────────────────────────
    loadMediaStats: function(skipCache) {
        if (this.isLoadingStats) return;
        this.isLoadingStats = true;

        var self = this;

        if (!skipCache) {
            var cachedStats = localStorage.getItem('sniparr-stats-cache');
            if (cachedStats) {
                try {
                    var parsedStats = JSON.parse(cachedStats);
                    var cacheAge = Date.now() - (parsedStats.timestamp || 0);
                    // Use cache if less than 1 hour old for immediate UI
                    if (cacheAge < 3600000) {
                        this.updateStatsDisplay(parsedStats.stats, true);
                        // Show grid immediately from cache so it's not blank while checking connections
                        this.updateEmptyStateVisibility(true);
                    }
                } catch (e) {}
            }
        }

        var statsContainer = document.querySelector('.media-stats-container');
        if (statsContainer && !skipCache) {
            statsContainer.classList.add('stats-loading');
        }

        SniparrUtils.fetchWithTimeout('./api/stats')
            .then(function(response) {
                if (!response.ok) throw new Error('Network response was not ok');
                return response.json();
            })
            .then(function(data) {
                if (data.success && data.stats) {
                    window.mediaStats = data.stats;
                    localStorage.setItem('sniparr-stats-cache', JSON.stringify({
                        stats: data.stats,
                        timestamp: Date.now()
                    }));
                    self.updateStatsDisplay(data.stats);
                    if (statsContainer) statsContainer.classList.remove('stats-loading');
                }
            })
            .catch(function(error) {
                console.error('Error fetching statistics:', error);
                if (statsContainer) statsContainer.classList.remove('stats-loading');
            })
            .finally(function() {
                self.isLoadingStats = false;
            });

        // Also fetch NZB Sniparr home stats (separate from main stats pipeline)
        self._fetchNzbHuntHomeStats();
        self._checkNzbHuntWarning();
        self._initNzbHomePauseBtn();
    },

    // ─── Main Display Update ──────────────────────────────────────────
    updateStatsDisplay: function(stats, isFromCache) {
        // If mode changed, clear and rebuild
        if (this._lastRenderedMode && this._lastRenderedMode !== this._currentViewMode) {
            this._clearDynamicContent();
        }
        if (this._currentViewMode === 'list') {
            this._renderListView(stats, isFromCache);
        } else {
            this._renderGridView(stats, isFromCache);
        }
        this._lastRenderedMode = this._currentViewMode;
    },

    // ─── Grid View (Flat Cards with Drag Handles) ─────────────────────
    _renderGridView: function(stats, isFromCache) {
        var grid = document.getElementById('app-stats-grid');
        if (!grid) {
            grid = document.querySelector('.app-stats-grid');
            if (grid) grid.id = 'app-stats-grid';
            else return;
        }

        // Switch CSS class
        grid.classList.remove('app-stats-list');
        grid.classList.add('app-stats-grid');

        var self = this;
        var groupOrder = this._getGroupOrder();
        var savedCardOrder = this._getCardOrder();

        // Build a flat list of all cards to render: [{app, meta, inst}, ...]
        var allCards = [];
        var ui = window.sniparrUI || {};
        var thirdPartyApps = { sonarr: true, radarr: true, lidarr: true, readarr: true, whisparr: true, eros: true };
        groupOrder.forEach(function(app) {
            if (!stats[app]) return;
            if (thirdPartyApps[app] && ui._enableThirdPartyApps === false) return;
            var hasInstances = stats[app].instances && stats[app].instances.length > 0;
            var isConfigured = ui.configuredApps && ui.configuredApps[app];
            if (!hasInstances && !stats[app].hunted && !stats[app].upgraded && !isConfigured) return;

            var meta = self.APP_META[app] || { label: app, icon: '', accent: '#94a3b8' };
            var instances = hasInstances ? stats[app].instances : [];

            if (instances.length === 0) {
                allCards.push({
                    app: app,
                    meta: meta,
                    inst: {
                        hunted: stats[app].hunted || 0,
                        upgraded: stats[app].upgraded || 0,
                        found: stats[app].found || 0,
                        found_upgrade: stats[app].found_upgrade || 0,
                        api_hits: 0, api_limit: 20,
                        instance_name: meta.label,
                        api_url: ''
                    }
                });
            } else {
                instances.forEach(function(inst) {
                    allCards.push({ app: app, meta: meta, inst: inst });
                });
            }
        });

        // Apply saved card order if available
        if (savedCardOrder && savedCardOrder.length > 0) {
            allCards.sort(function(a, b) {
                var keyA = a.app + '|' + (a.inst.instance_name || '');
                var keyB = b.app + '|' + (b.inst.instance_name || '');
                var idxA = -1, idxB = -1;
                for (var i = 0; i < savedCardOrder.length; i++) {
                    var sk = savedCardOrder[i].app + '|' + (savedCardOrder[i].instance || '');
                    if (sk === keyA) idxA = i;
                    if (sk === keyB) idxB = i;
                }
                if (idxA === -1) idxA = 9999;
                if (idxB === -1) idxB = 9999;
                return idxA - idxB;
            });
        }

        // Build/update cards in DOM
        var existingCards = grid.querySelectorAll('.app-stats-card.dynamic-card');
        var existingMap = {};
        existingCards.forEach(function(c) {
            var key = c.getAttribute('data-app') + '|' + c.getAttribute('data-instance-name');
            existingMap[key] = c;
        });

        allCards.forEach(function(entry, idx) {
            var key = entry.app + '|' + (entry.inst.instance_name || '');
            var card = existingMap[key];
            if (!card) {
                card = self._createCard(entry.app, entry.meta);
                card.classList.add('dynamic-card');
                card.setAttribute('data-app', entry.app);
                grid.appendChild(card);
            }
            self._updateCard(card, entry.app, entry.meta, entry.inst, isFromCache, entry.meta.label);
            // Ensure it's in the grid at the right position
            grid.appendChild(card);
            delete existingMap[key];
        });

        // Remove cards no longer in data
        Object.keys(existingMap).forEach(function(key) {
            existingMap[key].remove();
        });

        // Hide old static cards from template
        var oldCards = grid.querySelectorAll(':scope > .app-stats-card:not(.dynamic-card), :scope > .app-stats-card-wrapper, :scope > .app-group');
        oldCards.forEach(function(c) { c.style.display = 'none'; });

        // Initialize SortableJS for flat grid
        this._initGridSortable(grid);

        // Refresh cycle timers — timer elements are already baked into cards,
        // but CycleCountdown needs to know about them and populate data
        this._refreshCycleTimers();

        if (allCards.length > 0) {
            this.updateEmptyStateVisibility(true);
        }
        setTimeout(function() {
            if (typeof window.loadHourlyCapData === 'function') {
                window.loadHourlyCapData();
            }
        }, 200);
    },

    // ─── Create a Card Element (with drag handle + baked-in timer) ────
    _createCard: function(app, meta) {
        var card = document.createElement('div');
        card.className = 'app-stats-card ' + app;
        var cssClass = app.replace(/-/g, '');
        card.innerHTML =
            '<div class="card-drag-handle" title="Drag to reorder"><i class="fas fa-grip-vertical"></i></div>' +
            '<div class="status-container"><span class="status-badge"></span></div>' +
            '<div class="hourly-cap-container">' +
                '<div class="hourly-cap-status">' +
                    '<span class="hourly-cap-icon"></span>' +
                    '<span class="hourly-cap-text">API: <span>0</span> / <span>--</span></span>' +
                '</div>' +
                '<div class="api-progress-container">' +
                    '<div class="api-progress-bar"><div class="api-progress-fill" style="width: 0%;"></div></div>' +
                    '<div class="api-progress-text">API: <span>0</span> / <span>--</span></div>' +
                '</div>' +
            '</div>' +
            '<div class="app-content">' +
                '<div class="app-icon-wrapper"><img src="' + meta.icon + '" alt="" class="app-logo"></div>' +
                '<h4>' + meta.label + '</h4>' +
            '</div>' +
            '<div class="stats-numbers">' +
                '<div class="stat-box">' +
                    '<span class="stat-number">0</span>' +
                    '<span class="stat-label">Searches Triggered</span>' +
                '</div>' +
                '<div class="stat-box">' +
                    '<span class="stat-number">0</span>' +
                    '<span class="stat-label">Upgrades Triggered</span>' +
                '</div>' +
            '</div>' +
            '<div class="reset-button-container">' +
                '<div class="reset-and-timer-container">' +
                    '<button class="cycle-reset-button" data-app="' + app + '"><i class="fas fa-sync-alt"></i> Reset</button>' +
                    '<div class="cycle-timer inline-timer ' + cssClass + '" data-app-type="' + app + '">' +
                        '<i class="fas fa-clock ' + cssClass + '-icon"></i> <span class="timer-value">Loading...</span>' +
                    '</div>' +
                '</div>' +
            '</div>';
        return card;
    },

    // ─── Update a Card Element ────────────────────────────────────────
    _updateCard: function(card, app, meta, inst, isFromCache, appLabel) {
        var hunted = Math.max(0, parseInt(inst.hunted) || 0);
        var upgraded = Math.max(0, parseInt(inst.upgraded) || 0);
        var name = inst.instance_name || 'Default';
        var apiHits = Math.max(0, parseInt(inst.api_hits) || 0);
        var apiLimit = Math.max(1, parseInt(inst.api_limit) || 20);
        var apiUrl = (inst.api_url || '').trim();

        card.style.display = '';
        card.setAttribute('data-instance-name', name);
        card.setAttribute('data-app', app);

        // Title
        var h4 = card.querySelector('.app-content h4');
        if (h4) {
            var displayText = name !== appLabel ? appLabel + ' \u2013 ' + name : appLabel;
            if (apiUrl) {
                var link = h4.querySelector('.instance-name-link');
                if (!link) {
                    h4.textContent = '';
                    link = document.createElement('a');
                    link.className = 'instance-name-link';
                    link.target = '_blank';
                    link.rel = 'noopener noreferrer';
                    link.title = 'Open instance in new tab';
                    h4.appendChild(link);
                }
                link.href = apiUrl;
                link.textContent = displayText;
            } else {
                h4.textContent = displayText;
            }
        }

        var numbers = card.querySelectorAll('.stat-number');
        if (numbers[0]) {
            if (isFromCache) numbers[0].textContent = this.formatLargeNumber(hunted);
            else this.animateNumber(numbers[0], this.parseFormattedNumber(numbers[0].textContent || '0'), hunted);
        }
        if (numbers[1]) {
            if (isFromCache) numbers[1].textContent = this.formatLargeNumber(upgraded);
            else this.animateNumber(numbers[1], this.parseFormattedNumber(numbers[1].textContent || '0'), upgraded);
        }

        // Reset button instance name
        var resetBtn = card.querySelector('.cycle-reset-button[data-app]');
        if (resetBtn) resetBtn.setAttribute('data-instance-name', name);

        // API progress
        var pct = apiLimit > 0 ? (apiHits / apiLimit) * 100 : 0;
        var capSpans = card.querySelectorAll('.hourly-cap-text span');
        if (capSpans.length >= 2) { capSpans[0].textContent = apiHits; capSpans[1].textContent = apiLimit; }
        var statusEl = card.querySelector('.hourly-cap-status');
        if (statusEl) {
            statusEl.classList.remove('good', 'warning', 'danger');
            if (pct >= 100) statusEl.classList.add('danger');
            else if (pct >= 75) statusEl.classList.add('warning');
            else statusEl.classList.add('good');
        }
        var progressFill = card.querySelector('.api-progress-fill');
        if (progressFill) progressFill.style.width = Math.min(100, pct) + '%';
        var progressSpans = card.querySelectorAll('.api-progress-text span');
        if (progressSpans.length >= 2) { progressSpans[0].textContent = apiHits; progressSpans[1].textContent = apiLimit; }

        // State Management reset countdown
        var hoursUntil = inst.state_reset_hours_until;
        var stateEnabled = inst.state_reset_enabled !== false;
        var resetCountdownEl = card.querySelector('.state-reset-countdown');
        var resetContainer = card.querySelector('.reset-button-container');
        if (resetContainer) {
            if (!resetCountdownEl) {
                resetCountdownEl = document.createElement('div');
                resetCountdownEl.className = 'state-reset-countdown';
                resetContainer.appendChild(resetCountdownEl);
            }
            if (!stateEnabled) {
                resetCountdownEl.innerHTML = '<i class="fas fa-hourglass-half"></i> <span class="custom-tooltip">State Management Reset</span> Disabled';
                resetCountdownEl.style.display = '';
            } else if (hoursUntil != null && typeof hoursUntil === 'number' && hoursUntil > 0) {
                var h = Math.floor(hoursUntil);
                var label = h >= 1 ? '' + h : '<1';
                resetCountdownEl.innerHTML = '<i class="fas fa-hourglass-half"></i> <span class="custom-tooltip">State Management Reset</span> ' + label;
                resetCountdownEl.style.display = '';
            } else {
                resetCountdownEl.style.display = 'none';
            }
        }
    },

    // ─── List View (Compact Table — grouped) ──────────────────────────
    _renderListView: function(stats, isFromCache) {
        var grid = document.getElementById('app-stats-grid');
        if (!grid) {
            grid = document.querySelector('.app-stats-grid');
            if (grid) grid.id = 'app-stats-grid';
            else return;
        }

        grid.classList.remove('app-stats-grid');
        grid.classList.add('app-stats-list');

        var self = this;
        var groupOrder = this._getGroupOrder();
        var visibleApps = [];
        var ui = window.sniparrUI || {};
        var thirdPartyApps = { sonarr: true, radarr: true, lidarr: true, readarr: true, whisparr: true, eros: true };
        groupOrder.forEach(function(app) {
            if (thirdPartyApps[app] && ui._enableThirdPartyApps === false) return;
            if (stats[app] && (stats[app].instances && stats[app].instances.length > 0 ||
                stats[app].hunted > 0 || stats[app].upgraded > 0)) {
                visibleApps.push(app);
            } else if (stats[app] && ui.configuredApps && ui.configuredApps[app]) {
                visibleApps.push(app);
            }
        });

        visibleApps.forEach(function(app) {
            var meta = self.APP_META[app] || { label: app, icon: '', accent: '#94a3b8' };
            var group = grid.querySelector('.app-group[data-app="' + app + '"]');

            if (!group) {
                group = document.createElement('div');
                group.className = 'app-group';
                group.setAttribute('data-app', app);
                grid.appendChild(group);
            }

            var instances = (stats[app] && stats[app].instances) || [];
            if (instances.length === 0) {
                instances = [{
                    instance_name: meta.label,
                    hunted: (stats[app] && stats[app].hunted) || 0,
                    upgraded: (stats[app] && stats[app].upgraded) || 0,
                    found: (stats[app] && stats[app].found) || 0,
                    found_upgrade: (stats[app] && stats[app].found_upgrade) || 0,
                    api_hits: 0, api_limit: 20, api_url: ''
                }];
            }

            var html =
                '<div class="app-group-header list-header">' +
                    '<i class="fas fa-grip-vertical drag-handle group-drag-handle"></i>' +
                    '<img src="' + meta.icon + '" class="app-group-logo" alt="">' +
                    '<span class="app-group-label">' + meta.label + '</span>' +
                '</div>' +
                '<table class="app-list-table">' +
                    '<colgroup>' +
                        '<col class="col-instance">' +
                        '<col class="col-searches">' +
                        '<col class="col-upgrades">' +
                        '<col class="col-api-status">' +
                        '<col class="col-actions">' +
                    '</colgroup>' +
                    '<thead><tr>' +
                        '<th>Instance</th>' +
                        '<th class="col-searches" data-abbr="Searches">Searches</th>' +
                        '<th class="col-upgrades" data-abbr="Upgrades">Upgrades</th>' +
                        '<th>API / Status</th>' +
                        '<th></th>' +
                    '</tr></thead><tbody>';

            var cssClass = app.replace(/-/g, '');
            instances.forEach(function(inst) {
                var hunted = Math.max(0, parseInt(inst.hunted) || 0);
                var upgraded = Math.max(0, parseInt(inst.upgraded) || 0);
                var found = Math.max(0, parseInt(inst.found) || 0);
                var foundUpgrade = Math.max(0, parseInt(inst.found_upgrade) || 0);
                var apiHits = Math.max(0, parseInt(inst.api_hits) || 0);
                var apiLimit = Math.max(1, parseInt(inst.api_limit) || 20);
                var pct = apiLimit > 0 ? Math.min(100, (apiHits / apiLimit) * 100) : 0;
                var name = inst.instance_name || 'Default';

                var searchesCell = self.formatLargeNumber(hunted);
                var upgradesCell = self.formatLargeNumber(upgraded);

                html +=
                    '<tr data-instance-name="' + name + '">' +
                        '<td class="list-instance-name">' + name + '</td>' +
                        '<td class="list-stat ' + app + '">' + searchesCell + '</td>' +
                        '<td class="list-stat ' + app + '">' + upgradesCell + '</td>' +
                        '<td class="list-api-status">' +
                            '<div class="list-api-row">' +
                                '<div class="list-api-bar"><div class="list-api-fill ' + app + '" style="width:' + pct + '%;"></div></div>' +
                                '<span class="list-api-text">' + apiHits + '/' + apiLimit + '</span>' +
                            '</div>' +
                            '<div class="list-status-row">' +
                                '<div class="cycle-timer inline-timer ' + cssClass + '" data-app-type="' + app + '">' +
                                    '<i class="fas fa-clock ' + cssClass + '-icon"></i> <span class="timer-value">Loading...</span>' +
                                '</div>' +
                            '</div>' +
                        '</td>' +
                        '<td class="list-actions">' +
                            '<button class="cycle-reset-button" data-app="' + app + '" data-instance-name="' + name + '" title="Reset Cycle"><i class="fas fa-sync-alt"></i></button>' +
                        '</td>' +
                    '</tr>';
            });

            html += '</tbody></table>';
            group.innerHTML = html;
            group.style.display = '';
        });

        // Hide groups for non-visible apps
        grid.querySelectorAll('.app-group').forEach(function(g) {
            if (visibleApps.indexOf(g.getAttribute('data-app')) === -1) {
                g.style.display = 'none';
            }
        });

        // Reorder groups
        var currentGroups = Array.from(grid.querySelectorAll('.app-group'));
        var sorted = currentGroups.slice().sort(function(a, b) {
            var ia = groupOrder.indexOf(a.getAttribute('data-app'));
            var ib = groupOrder.indexOf(b.getAttribute('data-app'));
            if (ia === -1) ia = 9999;
            if (ib === -1) ib = 9999;
            return ia - ib;
        });
        sorted.forEach(function(g) { grid.appendChild(g); });

        this._initListSortable(grid);

        // Hide old static cards & dynamic grid cards
        var oldCards = grid.querySelectorAll(':scope > .app-stats-card, :scope > .app-stats-card-wrapper');
        oldCards.forEach(function(c) { c.style.display = 'none'; });

        // Refresh cycle timers — timer elements are baked into each <tr>
        this._refreshCycleTimers();

        if (visibleApps.length > 0) {
            this.updateEmptyStateVisibility(true);
        }
    },

    // ─── Refresh Cycle Timers after view render ──────────────────────
    _refreshCycleTimers: function() {
        if (typeof window.CycleCountdown === 'undefined') return;
        // Let CycleCountdown discover any new timer elements it doesn't know about
        if (window.CycleCountdown.refreshTimerElements) {
            window.CycleCountdown.refreshTimerElements();
        }
        // Force an immediate data fetch + display update so timers show current state
        if (window.CycleCountdown.refreshAllData) {
            window.CycleCountdown.refreshAllData();
        }
    },

    // ─── SortableJS for Grid (flat cards) ─────────────────────────────
    _sortableGrid: null,

    _initGridSortable: function(grid) {
        if (typeof Sortable === 'undefined') return;
        var self = this;

        if (this._sortableGrid) {
            this._sortableGrid.destroy();
            this._sortableGrid = null;
        }

        this._sortableGrid = Sortable.create(grid, {
            animation: 200,
            handle: '.card-drag-handle',
            draggable: '.app-stats-card.dynamic-card',
            ghostClass: 'sortable-ghost',
            chosenClass: 'sortable-chosen',
            filter: '.app-stats-card:not(.dynamic-card), .app-stats-card-wrapper, .app-group',
            onEnd: function() {
                self._collectGridOrder();
            }
        });
    },

    // ─── SortableJS for List (group-level drag) ───────────────────────
    _initListSortable: function(grid) {
        if (typeof Sortable === 'undefined') return;
        var self = this;

        if (this._sortableGrid) {
            this._sortableGrid.destroy();
            this._sortableGrid = null;
        }

        this._sortableGrid = Sortable.create(grid, {
            animation: 200,
            handle: '.group-drag-handle',
            draggable: '.app-group',
            ghostClass: 'sortable-ghost',
            chosenClass: 'sortable-chosen',
            onEnd: function() {
                self._collectListOrder();
            }
        });
    },

    // ─── Number Formatting / Animation ────────────────────────────────
    parseFormattedNumber: function(formattedStr) {
        if (!formattedStr || typeof formattedStr !== 'string') return 0;
        var cleanStr = formattedStr.replace(/[^\d.-]/g, '');
        var parsed = parseInt(cleanStr);
        if (formattedStr.indexOf('K') !== -1) return Math.floor(parsed * 1000);
        if (formattedStr.indexOf('M') !== -1) return Math.floor(parsed * 1000000);
        return isNaN(parsed) ? 0 : Math.max(0, parsed);
    },

    animateNumber: function(element, start, end) {
        start = Math.max(0, parseInt(start) || 0);
        end = Math.max(0, parseInt(end) || 0);
        if (start === end) { element.textContent = this.formatLargeNumber(end); return; }
        var self = this;
        var duration = 600;
        var startTime = performance.now();
        var updateNumber = function(currentTime) {
            var elapsed = currentTime - startTime;
            var progress = Math.min(elapsed / duration, 1);
            var easeOutQuad = progress * (2 - progress);
            var currentValue = Math.max(0, Math.floor(start + (end - start) * easeOutQuad));
            element.textContent = self.formatLargeNumber(currentValue);
            if (progress < 1) {
                element.animationFrame = requestAnimationFrame(updateNumber);
            } else {
                element.textContent = self.formatLargeNumber(end);
                element.animationFrame = null;
            }
        };
        element.animationFrame = requestAnimationFrame(updateNumber);
    },

    formatLargeNumber: function(num) {
        if (num < 1000) return num.toString();
        else if (num < 10000) return (num / 1000).toFixed(1) + 'K';
        else if (num < 100000) return (num / 1000).toFixed(1) + 'K';
        else if (num < 1000000) return Math.floor(num / 1000) + 'K';
        else if (num < 10000000) return (num / 1000000).toFixed(1) + 'M';
        else if (num < 100000000) return (num / 1000000).toFixed(1) + 'M';
        else if (num < 1000000000) return Math.floor(num / 1000000) + 'M';
        else if (num < 10000000000) return (num / 1000000000).toFixed(1) + 'B';
        else if (num < 100000000000) return (num / 1000000000).toFixed(1) + 'B';
        else if (num < 1000000000000) return Math.floor(num / 1000000000) + 'B';
        else return (num / 1000000000000).toFixed(1) + 'T';
    },

    // ─── Stats Reset ──────────────────────────────────────────────────
    resetMediaStats: function(appType) {
        var confirmMessage = appType
            ? 'Are you sure you want to reset all ' + (appType.charAt(0).toUpperCase() + appType.slice(1)) + ' statistics? This will clear all tracked hunted and upgraded items.'
            : 'Are you sure you want to reset ALL statistics for ALL apps? This cannot be undone.';
        var self = this;
        var doReset = function() {
            var endpoint = './api/stats/reset';
            var body = appType ? JSON.stringify({ app_type: appType }) : '{}';
            SniparrUtils.fetchWithTimeout(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: body
            })
            .then(function(response) { return response.json().then(function(data) { return { ok: response.ok, data: data }; }); })
            .then(function(result) {
                if (result.ok && result.data && result.data.success) {
                    if (window.sniparrUI && window.sniparrUI.showNotification) {
                        var msg = appType
                            ? (appType.charAt(0).toUpperCase() + appType.slice(1)) + ' statistics reset successfully'
                            : 'All statistics reset successfully';
                        window.sniparrUI.showNotification(msg, 'success');
                    }
                    self.loadMediaStats(true);
                } else {
                    var errMsg = (result.data && result.data.error) ? result.data.error : 'Failed to reset statistics';
                    if (window.sniparrUI && window.sniparrUI.showNotification) {
                        window.sniparrUI.showNotification(errMsg, 'error');
                    }
                }
            })
            .catch(function(error) {
                console.error('Error resetting statistics:', error);
                if (window.sniparrUI && window.sniparrUI.showNotification) {
                    window.sniparrUI.showNotification('Error resetting statistics', 'error');
                }
            });
        };
        if (window.SniparrConfirm && window.SniparrConfirm.show) {
            window.SniparrConfirm.show({ title: 'Reset Statistics', message: confirmMessage, confirmLabel: 'Reset', onConfirm: doReset });
        } else {
            if (!confirm(confirmMessage)) return;
            doReset();
        }
    },

    // ─── Dashboard Layout Reset ───────────────────────────────────────
    resetDashboardLayout: function() {
        SniparrUtils.setUIPreference('dashboard-layout', null);
        SniparrUtils.setUIPreference('dashboard-view-mode', 'list');
        this._currentViewMode = 'list';
        this._clearDynamicContent();
        // Reset toggle
        var toggleGroup = document.getElementById('dashboard-view-toggle');
        if (toggleGroup) {
            toggleGroup.querySelectorAll('.view-toggle-btn').forEach(function(b) {
                b.classList.toggle('active', b.getAttribute('data-view') === 'grid');
            });
        }
        if (window.mediaStats) this.updateStatsDisplay(window.mediaStats);
        if (window.sniparrUI && window.sniparrUI.showNotification) {
            window.sniparrUI.showNotification('Dashboard layout reset to defaults', 'success');
        }
    },

    // ─── App Connection Checks ────────────────────────────────────────
    checkAppConnections: function() {
        if (!window.sniparrUI) return;
        var self = this;
        var apps = ['sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros'];
        var checkPromises = apps.map(function(app) { return self.checkAppConnection(app); });
        Promise.all(checkPromises)
            .then(function() {
                window.sniparrUI.configuredAppsInitialized = true;
                self.updateEmptyStateVisibility();
            })
            .catch(function() {
                window.sniparrUI.configuredAppsInitialized = true;
                self.updateEmptyStateVisibility();
            });
    },

    checkAppConnection: function(app) {
        var self = this;
        return SniparrUtils.fetchWithTimeout('./api/status/' + app)
            .then(function(response) { return response.json(); })
            .then(function(data) {
                self.updateConnectionStatus(app, data);
                var isConfigured = data.configured === true;
                if (['sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros', 'swaparr'].indexOf(app) !== -1) {
                    isConfigured = (data.total_configured || 0) > 0;
                }
                if (window.sniparrUI) window.sniparrUI.configuredApps[app] = isConfigured;
            })
            .catch(function(error) {
                console.error('Error checking ' + app + ' connection:', error);
                self.updateConnectionStatus(app, { configured: false, connected: false });
                if (window.sniparrUI) window.sniparrUI.configuredApps[app] = false;
            });
    },

    updateConnectionStatus: function(app, statusData) {
        if (!window.sniparrUI) return;
        var statusElement = (window.sniparrUI.elements && window.sniparrUI.elements[app + 'HomeStatus']) || null;
        if (!statusElement) {
            var card = document.querySelector('.app-stats-card[data-app="' + app + '"]');
            statusElement = card ? card.querySelector('.status-container .status-badge') : null;
        }
        if (!statusElement) return;

        var isConfigured = statusData && statusData.configured === true;
        var isConnected = statusData && statusData.connected === true;
        var connectedCount = (statusData && statusData.connected_count) || 0;
        var totalConfigured = (statusData && statusData.total_configured) || 0;

        if (['sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros', 'swaparr'].indexOf(app) !== -1) {
            isConfigured = totalConfigured > 0;
            isConnected = isConfigured && connectedCount > 0;
        }

        var card = statusElement.closest('.app-stats-card');
        var statusContainer = statusElement.closest('.status-container');
        var wrapper = card ? card.closest('.app-stats-card-wrapper') : null;
        var container = wrapper || card;
        if (isConfigured) {
            if (container) container.style.display = '';
            if (wrapper) wrapper.querySelectorAll('.app-stats-card').forEach(function(c) { c.style.display = ''; });
            if (statusContainer) statusContainer.style.display = '';
        } else {
            if (container) container.style.display = 'none';
            if (card) card.style.display = 'none';
            statusElement.className = 'status-badge not-configured';
            statusElement.innerHTML = '<i class="fas fa-times-circle"></i> Not Configured';
            return;
        }

        if (['sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros', 'swaparr'].indexOf(app) !== -1) {
            statusElement.innerHTML = '<i class="fas fa-plug"></i> Connected ' + connectedCount + '/' + totalConfigured;
            statusElement.className = 'status-badge ' + (isConnected ? 'connected' : 'error');
        } else {
            if (isConnected) {
                statusElement.className = 'status-badge connected';
                statusElement.innerHTML = '<i class="fas fa-check-circle"></i> Connected';
            } else {
                statusElement.className = 'status-badge not-connected';
                statusElement.innerHTML = '<i class="fas fa-times-circle"></i> Not Connected';
            }
        }
    },

    // ─── NZB Sniparr Home Status Bar ──────────────────────────────────
    _nzbHomePollTimer: null,

    _checkNzbHuntWarning: function() {
        var banner = document.getElementById('nzb-snipe-home-warning');
        if (!banner) return;
        // Banner is visible by default in HTML; only hide when API confirms servers exist
        fetch('./api/nzb-snipe/home-stats?t=' + Date.now())
            .then(function(r) { return r.json(); })
            .then(function(data) {
                banner.style.display = (data.show_nzb_warning === true || data.has_servers !== true) ? 'flex' : 'none';
            })
            .catch(function() {
                /* keep visible on error - user has no servers until we know otherwise */
            });
        // Retry after 1.5s in case API was not ready
        setTimeout(function() {
            if (!banner) return;
            fetch('./api/nzb-snipe/home-stats?t=' + Date.now())
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    banner.style.display = (data.show_nzb_warning === true || data.has_servers !== true) ? 'flex' : 'none';
                })
                .catch(function() {});
        }, 1500);
    },

    _fetchNzbHuntHomeStats: function() {
        var card = document.getElementById('nzb-snipe-home-card');
        if (!card) return;
        var self = this;

        // First check visibility setting
        fetch('./api/nzb-snipe/home-stats?t=' + Date.now())
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (!data.visible) {
                    card.style.display = 'none';
                    self._stopNzbHomePoll();
                    return;
                }
                card.style.display = '';
                // Fetch full status for the status bar
                self._fetchNzbHuntStatus();
                // Start polling if not already
                self._startNzbHomePoll();
            })
            .catch(function() {
                if (card) card.style.display = 'none';
            });
    },

    _fetchNzbHuntStatus: function() {
        var card = document.getElementById('nzb-snipe-home-card');
        if (!card || card.style.display === 'none') return;

        fetch('./api/nzb-snipe/status?t=' + Date.now())
            .then(function(r) { return r.json(); })
            .then(function(status) {
                // Connections
                var connEl = document.getElementById('nzb-home-connections');
                if (connEl) {
                    var connStats = status.connection_stats || [];
                    var totalActive = connStats.reduce(function(s, c) { return s + (c.active || 0); }, 0);
                    var totalMax = connStats.reduce(function(s, c) { return s + (c.max || 0); }, 0);
                    connEl.textContent = totalMax > 0 ? totalActive + ' / ' + totalMax : String(totalActive);
                }
                // Speed
                var speedEl = document.getElementById('nzb-home-speed');
                if (speedEl) speedEl.textContent = status.speed_human || '0 B/s';
                // ETA
                var etaEl = document.getElementById('nzb-home-eta');
                if (etaEl) etaEl.textContent = status.eta_human || '--';
                // Remaining
                var remainEl = document.getElementById('nzb-home-remaining');
                if (remainEl) remainEl.textContent = status.remaining_human || '0 B';
                // Space
                var spaceEl = document.getElementById('nzb-home-space');
                if (spaceEl) spaceEl.textContent = status.free_space_human || '--';
                // Pause button state
                var pauseBtn = document.getElementById('nzb-home-pause-btn');
                if (pauseBtn && status.paused_global !== undefined) {
                    var icon = pauseBtn.querySelector('i');
                    if (icon) icon.className = status.paused_global ? 'fas fa-play' : 'fas fa-pause';
                    pauseBtn.title = status.paused_global ? 'Resume all downloads' : 'Pause all downloads';
                }
            })
            .catch(function(err) {
                console.error('[SniparrStats] NZB Sniparr status fetch error:', err);
            });
    },

    _startNzbHomePoll: function() {
        if (this._nzbHomePollTimer) return; // already polling
        var self = this;
        // Poll every 5 seconds for home page status
        this._nzbHomePollTimer = setInterval(function() {
            self._fetchNzbHuntStatus();
        }, 5000);
    },

    _stopNzbHomePoll: function() {
        if (this._nzbHomePollTimer) {
            clearInterval(this._nzbHomePollTimer);
            this._nzbHomePollTimer = null;
        }
    },

    _initNzbHomePauseBtn: function() {
        var btn = document.getElementById('nzb-home-pause-btn');
        if (!btn || btn._nzbBound) return;
        btn._nzbBound = true;
        btn.addEventListener('click', function() {
            var icon = btn.querySelector('i');
            var isPaused = icon && icon.classList.contains('fa-play');
            var endpoint = isPaused ? './api/nzb-snipe/queue/resume-all' : './api/nzb-snipe/queue/pause-all';
            fetch(endpoint, { method: 'POST' })
                .then(function(r) { return r.json(); })
                .then(function() {
                    // Flip the icon immediately for responsiveness
                    if (icon) {
                        icon.className = isPaused ? 'fas fa-pause' : 'fas fa-play';
                        btn.title = isPaused ? 'Pause all downloads' : 'Resume all downloads';
                    }
                })
                .catch(function() {});
        });
    },

    updateEmptyStateVisibility: function(forceShowGrid) {
        if (!window.sniparrUI) return;
        
        // If we don't have a final answer on configuration yet and aren't forcing the grid, stay quiet
        if (!window.sniparrUI.configuredAppsInitialized && !forceShowGrid) return;
        
        var anyConfigured = Object.values(window.sniparrUI.configuredApps).some(function(v) { return v === true; });
        
        // If we are forcing the grid (from cache), we assume there's something to show
        if (forceShowGrid) anyConfigured = true;
        
        var emptyState = document.getElementById('live-hunts-empty-state');
        var statsGrid = document.getElementById('app-stats-grid') || document.querySelector('.app-stats-grid');
        
        if (anyConfigured) {
            if (emptyState) emptyState.style.display = 'none';
            if (statsGrid) statsGrid.style.display = '';
        } else {
            // Only show empty state if we're CERTAIN nothing is configured
            if (window.sniparrUI.configuredAppsInitialized) {
                if (emptyState) emptyState.style.display = 'flex';
                if (statsGrid) statsGrid.style.display = 'none';
            }
        }
    }
};


/* === modules/ui/api-progress.js === */
/**
 * API Progress Bar Enhancement
 * Connects to the existing hourly-cap system to show real API usage data
 */

function updateApiProgressForCard(card, used, total) {
    const safeTotal = total > 0 ? total : 20;
    const percentage = (used / safeTotal) * 100;
    let gradient;
    if (percentage <= 35) gradient = '#22c55e';
    else if (percentage <= 50) gradient = `linear-gradient(90deg, #22c55e 0%, #22c55e ${35 * 100 / percentage}%, #f59e0b 100%)`;
    else if (percentage <= 70) gradient = `linear-gradient(90deg, #22c55e 0%, #22c55e ${35 * 100 / percentage}%, #f59e0b ${50 * 100 / percentage}%, #ea580c 100%)`;
    else gradient = `linear-gradient(90deg, #22c55e 0%, #22c55e ${35 * 100 / percentage}%, #f59e0b ${50 * 100 / percentage}%, #ea580c ${70 * 100 / percentage}%, #ef4444 100%)`;
    const progressFill = card.querySelector('.api-progress-fill');
    const spans = card.querySelectorAll('.api-progress-text span');
    const usedSpan = spans[0];
    const totalSpan = spans[1];
    if (progressFill && usedSpan && totalSpan) {
        progressFill.style.width = `${percentage}%`;
        progressFill.style.background = gradient;
        usedSpan.textContent = used;
        totalSpan.textContent = safeTotal;
    }
}

function updateApiProgress(appName, used, total) {
    const cards = document.querySelectorAll('.app-stats-card.' + appName);
    cards.forEach(card => updateApiProgressForCard(card, used, total));
}

function syncProgressBarsWithApiCounts() {
    const apps = ['sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros'];
    apps.forEach(app => {
        const cards = document.querySelectorAll('.app-stats-card.' + app);
        cards.forEach(card => {
            const countEl = card.querySelector('.hourly-cap-text span');
            const limitEl = card.querySelectorAll('.hourly-cap-text span')[1];
            if (countEl && limitEl) {
                const used = parseInt(countEl.textContent, 10) || 0;
                const total = parseInt(limitEl.textContent, 10) || 20;
                updateApiProgressForCard(card, used, total);
            }
        });
    });
}

// Initialize when page loads
document.addEventListener('DOMContentLoaded', function() {
    // Initial sync with existing API count data
    syncProgressBarsWithApiCounts();
    
    // Watch each card's count/limit (hourly-cap.js updates them); sync that card's bar when changed
    const apps = ['sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros'];
    apps.forEach(app => {
        document.querySelectorAll('.app-stats-card.' + app).forEach(card => {
            const countEl = card.querySelector('.hourly-cap-text span');
            const limitEl = card.querySelectorAll('.hourly-cap-text span')[1];
            if (!countEl || !limitEl) return;
            const sync = () => {
                const used = parseInt(countEl.textContent, 10) || 0;
                const total = parseInt(limitEl.textContent, 10) || 20;
                updateApiProgressForCard(card, used, total);
            };
            const obs = new MutationObserver(sync);
            obs.observe(countEl, { childList: true, characterData: true, subtree: true });
            obs.observe(limitEl, { childList: true, characterData: true, subtree: true });
        });
    });
    
    // Also sync every 2 minutes (same as hourly-cap.js polling)
    setInterval(syncProgressBarsWithApiCounts, 120000);
});

// Export function for external use
window.updateApiProgress = updateApiProgress;
window.syncProgressBarsWithApiCounts = syncProgressBarsWithApiCounts;

/* === modules/ui/cycle-countdown.js === */
/**
 * Cycle Countdown Timer
 * Shows countdown timers for each app's next cycle
 */

window.CycleCountdown = (function() {
    // Cache for next cycle timestamps
    const nextCycleTimes = {};
    // Active timer intervals
    const timerIntervals = {};
    // Track apps that are currently running cycles
    const runningCycles = {};
    // Track instances that have a pending reset (show "Pending Reset" until cycle ends and sleep starts)
    const pendingResets = {};
    // Per-instance cycle activity (e.g. "Season Search (360/600)" or "Processing missing") when running
    const cycleActivities = {};
    const trackedApps = ['sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'whisparr-v3', 'eros', 'swaparr'];
    
    function getBaseUrl() {
        return (window.SNIPARR_BASE_URL || '');
    }

    function buildUrl(path) {
        const base = getBaseUrl();
        path = path.replace(/^\.\//, '');
        if (!path.startsWith('/')) {
            path = '/' + path;
        }
        return base + path;
    }
    
    // Set up timer elements in the DOM
    function setupTimerElements() {
        // Create timer elements in each app status card
        trackedApps.forEach(app => {
            createTimerElement(app);
        });
    }
    
    // Initialize countdown timers for all apps
    function initialize() {
        // Clear any existing running cycle and pending reset states
        Object.keys(runningCycles).forEach(app => {
            runningCycles[app] = false;
        });
        Object.keys(pendingResets).forEach(k => { delete pendingResets[k]; });
        
        // Get references to all HTML elements
        setupTimerElements();
        
        // Set up event listeners for reset buttons
        setupResetButtonListeners();
        
        // First try to fetch from API
        fetchAllCycleData()
            .then((data) => {
                // Success - data is processed in fetchAllCycleData
            })
            .catch((error) => {
                console.warn('[CycleCountdown] Initial data fetch failed:', error.message);
                // Show waiting message in the UI if initial load fails
                displayWaitingForCycle();
            });
        
        function startRefreshInterval() {
            // Clear any existing interval
            if (dataRefreshIntervalId) {
                clearInterval(dataRefreshIntervalId);
                dataRefreshIntervalId = null;
            }
            
            // Set up API sync every 15 seconds so countdown appears soon after cycle ends (when backend sets next_cycle)
            dataRefreshIntervalId = setInterval(() => {
                // Only refresh if not already fetching
                if (!isFetchingData) {
                    fetchAllCycleData()
                        .then(() => {})
                        .catch(() => {});
                }
            }, 15000); // API sync every 15 seconds so "Starting Cycle" updates to countdown soon after sleep starts
            
        }
        
        // Start the refresh cycle
        startRefreshInterval();
    }
    
    // Simple lock to prevent concurrent fetches
    let isFetchingData = false;
    // 15-second API refresh interval (stored so cleanup can clear it)
    let dataRefreshIntervalId = null;
    // Poll when "Starting Cycle" is shown so countdown appears soon after sleep starts
    let startingCyclePollTimeout = null;
    let startingCyclePollAttempts = 0;
    const STARTING_CYCLE_POLL_INTERVAL_MS = 2000;
    const STARTING_CYCLE_POLL_MAX_ATTEMPTS = 15; // 2s * 15 = 30s max

    function startStartingCyclePolling() {
        if (startingCyclePollTimeout) return; // already polling
        startingCyclePollAttempts = 0;
        function poll() {
            startingCyclePollAttempts++;
            if (startingCyclePollAttempts > STARTING_CYCLE_POLL_MAX_ATTEMPTS) {
                startingCyclePollTimeout = null;
                return;
            }
            if (isFetchingData) {
                startingCyclePollTimeout = safeSetTimeout(poll, STARTING_CYCLE_POLL_INTERVAL_MS);
                return;
            }
            fetchAllCycleData()
                .then((data) => {
                    const stillStarting = data && Object.keys(data).some(app => {
                        const appData = data[app];
                        if (!appData) return false;
                        if (appData.instances) {
                            return Object.keys(appData.instances).some(instName => {
                                const inst = appData.instances[instName];
                                return inst && !inst.next_cycle && !inst.cyclelock;
                            });
                        }
                        return (appData.next_cycle == null && !appData.cyclelock);
                    });
                    if (stillStarting && startingCyclePollAttempts < STARTING_CYCLE_POLL_MAX_ATTEMPTS) {
                        startingCyclePollTimeout = safeSetTimeout(poll, STARTING_CYCLE_POLL_INTERVAL_MS);
                    } else {
                        startingCyclePollTimeout = null;
                    }
                })
                .catch(() => {
                    startingCyclePollTimeout = safeSetTimeout(poll, STARTING_CYCLE_POLL_INTERVAL_MS);
                });
        }
        startingCyclePollTimeout = safeSetTimeout(poll, STARTING_CYCLE_POLL_INTERVAL_MS);
    }

    // Track active reset polling intervals so we don't stack them
    const activeResetPolls = {};

    // Set up reset button click listeners (event delegation for dynamically cloned cards)
    function setupResetButtonListeners() {
        // Use event delegation on document so cloned per-instance cards also get handled
        document.addEventListener('click', function(e) {
            const button = e.target.matches('.cycle-reset-button') ? e.target : e.target.closest('.cycle-reset-button');
            if (!button) return;
            
            const app = button.getAttribute('data-app');
            const instanceName = button.getAttribute('data-instance-name') || null;
            if (app) {
                const key = stateKey(app, instanceName);
                // Set pending reset locally for instant UI feedback
                pendingResets[key] = true;
                
                // Update timer display immediately — shows "Pending Reset" (orange)
                updateTimerDisplay(app);
                
                // Fetch latest data after a short delay so API has recorded the reset
                setTimeout(function() {
                    fetchAllCycleData().catch(function() {});
                }, 500);
                
                // Start faster polling until reset is complete
                startResetPolling(app, instanceName);
            }
        });
    }
    
    // Poll more frequently after a reset until new data is available
    function startResetPolling(app, instanceName) {
        const key = stateKey(app, instanceName);
        
        // Clear any existing polling for this key
        if (activeResetPolls[key]) {
            clearInterval(activeResetPolls[key]);
            delete activeResetPolls[key];
        }
        
        let pollAttempts = 0;
        const maxPollAttempts = 90; // Poll for up to 3 minutes (90 * 2 seconds)
        
        const pollInterval = setInterval(() => {
            pollAttempts++;
            
            fetchAllCycleData()
                .then(() => {
                    // Reset is complete when backend says pending_reset is false
                    // and we have a new countdown time (cycle restarted and is sleeping)
                    const resetDone = !pendingResets[key];
                    const hasCountdown = !!nextCycleTimes[key];
                    const isRunning = !!runningCycles[key];
                    
                    if (resetDone && (hasCountdown || isRunning)) {
                        clearInterval(pollInterval);
                        delete activeResetPolls[key];
                        updateTimerDisplay(app);
                    }
                })
                .catch(() => {});
            
            if (pollAttempts >= maxPollAttempts) {
                clearInterval(pollInterval);
                delete activeResetPolls[key];
                // Clear the local pending state so normal display resumes
                pendingResets[key] = false;
                updateTimerDisplay(app);
            }
        }, 2000); // Poll every 2 seconds for fast feedback
        
        activeResetPolls[key] = pollInterval;
    }
    
    // Display initial loading message in the UI when sleep data isn't available yet
    function displayWaitingForCycle() {
        trackedApps.forEach(app => {
            if (!nextCycleTimes[app]) {
                getTimerElements(app).forEach(timerElement => {
                    const timerValue = timerElement.querySelector('.timer-value');
                    if (timerValue && (timerValue.textContent === '--:--:--' || timerValue.textContent === 'Starting Cycle')) {
                        timerValue.textContent = 'Waiting for Cycle';
                        timerValue.classList.add('refreshing-state');
                        timerValue.style.color = '#00c2ce';
                    }
                });
            }
        });
    }
    
    // Replace any "Loading..." timers with "Starting Cycle" so we never leave them stuck
    function clearStaleLoadingTimers() {
        trackedApps.forEach(app => {
            getTimerElements(app).forEach(timerElement => {
                const timerValue = timerElement.querySelector('.timer-value');
                if (timerValue && timerValue.textContent === 'Loading...') {
                    timerValue.textContent = 'Starting Cycle';
                    timerValue.classList.remove('refreshing-state');
                }
            });
        });
    }

    // Return all timer elements for an app (grid cards AND list-mode rows)
    // Excludes timers inside hidden (old static) cards.
    function getTimerElements(app) {
        var results = [];
        // Grid mode: timers inside VISIBLE .app-stats-card (dynamic-card only)
        document.querySelectorAll('.app-stats-card.dynamic-card.' + app + ' .cycle-timer').forEach(function(t) {
            results.push(t);
        });
        // Also check swaparr/eros cards that may not be dynamic
        document.querySelectorAll('.swaparr-stats-grid .app-stats-card.' + app + ' .cycle-timer').forEach(function(t) {
            if (results.indexOf(t) === -1) results.push(t);
        });
        // List mode: timers inside <tr> within a list table belonging to this app group
        document.querySelectorAll('.app-group[data-app="' + app + '"] .cycle-timer').forEach(function(t) {
            if (results.indexOf(t) === -1) results.push(t);
        });
        return results;
    }
    
    // Get instance name for a timer (from reset button or card/row in same container)
    function getInstanceNameForTimer(timerElement) {
        // Grid mode — timer is inside .app-stats-card
        const card = timerElement.closest('.app-stats-card');
        if (card) {
            const resetBtn = card.querySelector('.cycle-reset-button[data-instance-name]');
            const fromBtn = resetBtn ? resetBtn.getAttribute('data-instance-name') : null;
            const fromCard = card.getAttribute('data-instance-name');
            return fromBtn || fromCard || null;
        }
        // List mode — timer is inside a <tr> with data-instance-name
        const row = timerElement.closest('tr[data-instance-name]');
        if (row) return row.getAttribute('data-instance-name') || null;
        return null;
    }
    
    // Key for per-instance state: "app" for single-app, "app-instanceName" for *arr instances
    function stateKey(app, instanceName) {
        return instanceName ? app + '-' + instanceName : app;
    }
    
    // Create timer display element in each app stats card (supports multiple instance cards)
    function createTimerElement(app) {
        const dataApp = app;
        const cssClass = app.replace(/-/g, '');
        
        const resetButtons = document.querySelectorAll(`button.cycle-reset-button[data-app="${dataApp}"]`);
        if (!resetButtons.length) return;
        
        resetButtons.forEach(resetButton => {
            // Skip if already wrapped with a timer (grid cards with baked-in timer)
            const container = resetButton.closest('.reset-and-timer-container');
            if (container && container.querySelector('.cycle-timer')) return;
            // Skip if button is in a table cell (list mode — timer is in adjacent <td>)
            if (resetButton.closest('td')) return;
            
            const parent = resetButton.parentNode;
            const wrapper = document.createElement('div');
            wrapper.className = 'reset-and-timer-container';
            wrapper.style.display = 'flex';
            wrapper.style.justifyContent = 'space-between';
            wrapper.style.alignItems = 'center';
            wrapper.style.width = '100%';
            wrapper.style.marginTop = '8px';
            parent.insertBefore(wrapper, resetButton);
            wrapper.appendChild(resetButton);
            
            const timerElement = document.createElement('div');
            timerElement.className = 'cycle-timer inline-timer';
            timerElement.innerHTML = '<i class="fas fa-clock"></i> <span class="timer-value">Starting Cycle</span>';
            if (app === 'eros') timerElement.style.cssText = 'border-left: 2px solid #ff45b7 !important;';
            timerElement.classList.add(cssClass);
            timerElement.setAttribute('data-app-type', app);
            const timerIcon = timerElement.querySelector('i');
            if (timerIcon) timerIcon.classList.add(cssClass + '-icon');
            wrapper.appendChild(timerElement);
        });
    }
    
    // Fetch cycle times for all tracked apps
    function fetchAllCycleTimes() {
        // First try to get data for all apps at once
        fetchAllCycleData().catch(() => {
            // If that fails, fetch individually
            trackedApps.forEach(app => {
                fetchCycleTime(app);
            });
        });
    }
    
    // Fetch cycle data for all apps at once
    function fetchAllCycleData() {
        // If already fetching, don't start another fetch
        if (isFetchingData) {
            return Promise.resolve(nextCycleTimes); // Return existing data
        }
        
        // Set the lock
        isFetchingData = true;
        
        return new Promise((resolve, reject) => {
            // Use a completely relative URL approach to avoid any subpath issues
            const url = buildUrl('./api/cycle/status');
            
            fetch(url, {
                method: 'GET',
                headers: {
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache'
                }
            })
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! Status: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                // Release the lock
                isFetchingData = false;
                
                // Check if we got valid data
                if (Object.keys(data).length === 0) {
                    resolve({}); // No apps configured yet
                    return;
                }
                
                let dataProcessed = false;
                
                // Process the data for each app (per-instance for *arr, single for swaparr)
                for (const app in data) {
                    if (!trackedApps.includes(app)) continue;
                    const appData = data[app];
                    if (!appData) continue;
                    // Per-instance format: { instances: { InstanceName: { next_cycle, cyclelock, pending_reset } } }
                    if (appData.instances && typeof appData.instances === 'object') {
                        Object.keys(pendingResets).filter(function(k) { return k === app || k.startsWith(app + '-'); }).forEach(function(k) { delete pendingResets[k]; });
                        for (const instanceName in appData.instances) {
                            const inst = appData.instances[instanceName];
                            if (!inst) continue;
                            
                            const key = stateKey(app, instanceName);
                            const nextCycleTime = inst.next_cycle ? new Date(inst.next_cycle) : null;
                            
                            if (nextCycleTime && !isNaN(nextCycleTime.getTime())) {
                                nextCycleTimes[key] = nextCycleTime;
                            }
                            
                            runningCycles[key] = inst.cyclelock !== undefined ? inst.cyclelock : true;
                            pendingResets[key] = inst.pending_reset === true;
                            cycleActivities[key] = inst.cycle_activity || null;
                            dataProcessed = true;
                        }
                        runningCycles[app] = false;
                        updateTimerDisplay(app);
                        setupCountdown(app);
                        continue;
                    }
                    // Single-app format: { next_cycle, cyclelock, pending_reset }
                    if (appData.next_cycle || appData.cyclelock !== undefined) {
                        const nextCycleTime = appData.next_cycle ? new Date(appData.next_cycle) : null;
                        
                        if (nextCycleTime && !isNaN(nextCycleTime.getTime())) {
                            nextCycleTimes[app] = nextCycleTime;
                        }
                        
                        pendingResets[app] = appData.pending_reset === true;
                        const cyclelock = appData.cyclelock !== undefined ? appData.cyclelock : true;
                        runningCycles[app] = cyclelock;
                        if (cyclelock && !pendingResets[app]) {
                            getTimerElements(app).forEach(timerElement => {
                                const timerValue = timerElement.querySelector('.timer-value');
                                if (timerValue) {
                                    timerValue.textContent = 'Running Cycle';
                                    timerValue.classList.remove('refreshing-state');
                                    timerValue.classList.add('running-state');
                                    timerValue.style.color = '#00ff88';
                                }
                            });
                        } else if (pendingResets[app]) {
                            getTimerElements(app).forEach(timerElement => {
                                const timerValue = timerElement.querySelector('.timer-value');
                                if (timerValue) {
                                    timerValue.textContent = 'Pending Reset';
                                    timerValue.classList.remove('refreshing-state', 'running-state');
                                    timerValue.classList.add('pending-reset-state');
                                    timerValue.style.color = '#ffaa00';
                                }
                            });
                        } else {
                            updateTimerDisplay(app);
                        }
                        setupCountdown(app);
                        dataProcessed = true;
                    }
                }
                
                if (dataProcessed) {
                    clearStaleLoadingTimers();
                    // When any instance still has no next_cycle (shows "Starting Cycle"), poll every 2s until we get
                    // a countdown (sleep just started; backend sets next_cycle shortly)
                    const hasStartingCycleWithInstances = Object.keys(data).some(app => {
                        const appData = data[app];
                        if (!appData || !appData.instances) return false;
                        return Object.keys(appData.instances).some(instanceName => {
                            const inst = appData.instances[instanceName];
                            return inst && !inst.next_cycle && !inst.cyclelock;
                        });
                    });
                    const hasStartingCycleSingle = Object.keys(data).some(app => {
                        const appData = data[app];
                        if (!appData || appData.instances) return false;
                        return (appData.next_cycle == null && !appData.cyclelock);
                    });
                    if (hasStartingCycleWithInstances || hasStartingCycleSingle) {
                        startStartingCyclePolling();
                    }
                    resolve(data);
                } else {
                    clearStaleLoadingTimers();
                    resolve({}); // No configured apps found
                }
            })
            .catch(error => {
                // Release the lock
                isFetchingData = false;
                
                // Only log errors occasionally to reduce console spam
                if (Math.random() < 0.1) { // Only log 10% of errors
                    console.warn('[CycleCountdown] Error fetching from API:', error.message); 
                }
                
                // Display waiting message in UI only if we have no existing data
                if (Object.keys(nextCycleTimes).length === 0) {
                    displayWaitingForCycle(); // Shows "Waiting for cycle..." during startup
                    reject(error);
                } else {
                    // If we have existing data, just use that
                    resolve(nextCycleTimes);
                }
            });
        });
    }
    
    // Fetch the next cycle time for a specific app
    function fetchCycleTime(app) {
        try {
            // Use a completely relative URL approach to avoid any subpath issues
            const url = buildUrl(`./api/cycle/status/${app}`);
            
            // Use safe timeout to avoid context issues
            safeSetTimeout(() => {
                fetch(url, {
                    method: 'GET',
                    headers: {
                        'Cache-Control': 'no-cache',
                        'Pragma': 'no-cache'
                    }
                })
                .then(response => {
                    if (!response.ok) {
                        throw new Error(`HTTP error! Status: ${response.status}`);
                    }
                    return response.json();
                })
                .then(data => {
                    if (data && data.next_cycle) {
                        // Store next cycle time
                        nextCycleTimes[app] = new Date(data.next_cycle);
                        
                        // Update timer display immediately
                        updateTimerDisplay(app);
                        
                        // Set up interval to update countdown
                        setupCountdown(app);
                    }
                })
                .catch(error => {
                    console.error(`[CycleCountdown] Error fetching cycle time for ${app}:`, error);
                    updateTimerError(app);
                });
            }, 50);
        } catch (error) {
            console.error(`[CycleCountdown] Error in fetchCycleTime for ${app}:`, error);
            updateTimerError(app);
        }
    }
    
    // Set up countdown interval for an app
    function setupCountdown(app) {
        // Clear any existing interval
        if (timerIntervals[app]) {
            clearInterval(timerIntervals[app]);
        }
        
        // Set up new interval to update every second for smooth countdown
        timerIntervals[app] = setInterval(() => {
            updateTimerDisplay(app);
        }, 1000); // 1-second interval for smooth countdown
        
    }
    
    // Update the timer display for an app (per-instance when cards have data-instance-name)
    function updateTimerDisplay(app) {
        const timerElements = getTimerElements(app);
        if (!timerElements.length) return;
        
        const now = new Date();
        
        timerElements.forEach(timerElement => {
            const timerValue = timerElement.querySelector('.timer-value');
            if (!timerValue) return;
            
            const instanceName = getInstanceNameForTimer(timerElement);
            const key = stateKey(app, instanceName);
            const nextCycleTime = nextCycleTimes[key];
            const isRunning = runningCycles[key];
            const isPendingReset = pendingResets[key] === true;
            const timeRemaining = nextCycleTime ? (nextCycleTime - now) : 0;
            const isExpired = nextCycleTime && timeRemaining <= 0;
            
            let formattedTime = 'Starting Cycle';
            if (nextCycleTime && !isExpired && !isRunning && !isPendingReset) {
                const hours = Math.floor(timeRemaining / (1000 * 60 * 60));
                const minutes = Math.floor((timeRemaining % (1000 * 60 * 60)) / (1000 * 60));
                const seconds = Math.floor((timeRemaining % (1000 * 60)) / 1000);
                formattedTime = String(hours).padStart(2, '0') + ':' + String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
            }
            if (isExpired) delete nextCycleTimes[key];
            
            if (isPendingReset) {
                timerValue.textContent = 'Pending Reset';
                timerValue.classList.remove('refreshing-state', 'running-state');
                timerValue.classList.add('pending-reset-state');
                timerValue.style.color = '#ffaa00';
                return;
            }
            if (isRunning) {
                const activity = cycleActivities[key];
                timerValue.textContent = (activity && String(activity).trim()) ? activity : 'Running Cycle';
                timerValue.classList.remove('refreshing-state', 'pending-reset-state');
                timerValue.classList.add('running-state');
                timerValue.style.color = '#00ff88';
                return;
            }
            if (!nextCycleTime || isExpired) {
                timerValue.textContent = 'Starting Cycle';
                timerValue.classList.remove('refreshing-state', 'running-state', 'pending-reset-state');
                timerValue.style.removeProperty('color');
                return;
            }
            timerValue.textContent = formattedTime;
            timerValue.classList.remove('refreshing-state', 'running-state', 'pending-reset-state');
            updateTimerStyle(timerElement, timeRemaining);
        });
    }
    
    // Update timer styling based on remaining time
    function updateTimerStyle(timerElement, timeRemaining) {
        // Get the timer value element
        const timerValue = timerElement.querySelector('.timer-value');
        if (!timerValue) return;
        
        // Remove any existing time-based classes from both elements
        timerElement.classList.remove('timer-soon', 'timer-imminent', 'timer-normal');
        timerValue.classList.remove('timer-value-soon', 'timer-value-imminent', 'timer-value-normal');
        
        // Add class based on time remaining
        if (timeRemaining < 60000) { // Less than 1 minute
            timerElement.classList.add('timer-imminent');
            timerValue.classList.add('timer-value-imminent');
            timerValue.style.color = '#ff3333'; // Red - direct styling for immediate effect
        } else if (timeRemaining < 300000) { // Less than 5 minutes
            timerElement.classList.add('timer-soon');
            timerValue.classList.add('timer-value-soon');
            timerValue.style.color = '#ff8c00'; // Orange - direct styling for immediate effect
        } else {
            timerElement.classList.add('timer-normal');
            timerValue.classList.add('timer-value-normal');
            timerValue.style.color = 'white'; // White - direct styling for immediate effect
        }
    }
    
    // Show error state in timer for actual errors (not startup waiting)
    function updateTimerError(app) {
        getTimerElements(app).forEach(timerElement => {
            const timerValue = timerElement.querySelector('.timer-value');
            if (timerValue) {
                timerValue.textContent = 'Unavailable';
                timerValue.style.color = '#ff6b6b';
                timerElement.classList.add('timer-error');
            }
        });
    }
    
    // Clean up timers when leaving home (stops all intervals and polling)
    function cleanup() {
        Object.keys(timerIntervals).forEach(app => {
            clearInterval(timerIntervals[app]);
            delete timerIntervals[app];
        });
        if (dataRefreshIntervalId) {
            clearInterval(dataRefreshIntervalId);
            dataRefreshIntervalId = null;
        }
        if (startingCyclePollTimeout) {
            clearTimeout(startingCyclePollTimeout);
            startingCyclePollTimeout = null;
        }
    }
    
    // Initialize on page load - with proper binding for setTimeout
    function safeSetTimeout(callback, delay) {
        // Make sure we're using the global window object for setTimeout
        return window.setTimeout.bind(window)(callback, delay);
    }
    
    function safeSetInterval(callback, delay) {
        // Make sure we're using the global window object for setInterval
        return window.setInterval.bind(window)(callback, delay);
    }
    
    document.addEventListener('DOMContentLoaded', function() {
        // Skip initialization on login page or if not authenticated
        const isLoginPage = document.querySelector('.login-container, #loginForm, .login-form');
        if (isLoginPage) return;
        
        // Only initialize if we're on a page that has app status cards
        const homeSection = document.getElementById('homeSection');
        const hasAppCards = document.querySelector('.app-status-card, .status-card, [id$="StatusCard"]');
        
        if (!homeSection && !hasAppCards) return;
        
        // Simple initialization with minimal delay
        setTimeout(function() {
            // Always initialize immediately on page load
            initialize();
            
            // Also set up observer for home section visibility changes
            const observer = new MutationObserver((mutations) => {
                for (const mutation of mutations) {
                    if (mutation.target.id === 'homeSection' && 
                        mutation.attributeName === 'class' && 
                        !mutation.target.classList.contains('hidden')) {
                        initialize();
                    } else if (mutation.target.id === 'homeSection' && 
                               mutation.attributeName === 'class' && 
                               mutation.target.classList.contains('hidden')) {
                        cleanup();
                    }
                }
            });
            
            if (homeSection) {
                observer.observe(homeSection, { attributes: true });
            }
        }, 100); // 100ms delay is enough
    });
    
    // Refresh all cycle data immediately (for timezone changes)
    // When called right after list-mode render, a second delayed refresh ensures
    // timers (which may not exist yet) get updated — fixes TV Snipe etc. stuck on "Loading..."
    function refreshAllData() {
        fetchAllCycleData()
            .then(() => {
                // Delayed refresh to catch timers that appeared after first fetch (list-mode race)
                safeSetTimeout(() => {
                    fetchAllCycleData().then(clearStaleLoadingTimers).catch(() => {});
                }, 500);
            })
            .catch(() => {});
    }

    // Public API
    return {
        initialize: initialize,
        fetchAllCycleTimes: fetchAllCycleTimes,
        cleanup: cleanup,
        refreshAllData: refreshAllData,
        refreshTimerElements: setupTimerElements
    };
})();


/* === modules/ui/apps-scroll-fix.js === */
/**
 * Apps Section Scroll Fix
 * This script prevents double scrollbars and limits excessive scrolling
 * by ensuring only the main content area is scrollable
 */
document.addEventListener('DOMContentLoaded', function() {
    // Function to fix the apps section scrolling
    function fixAppsScrolling() {
        // Get the main content element (this should be the only scrollable container)
        const mainContent = document.querySelector('.main-content');
        
        // Get the apps section elements
        const appsSection = document.getElementById('appsSection');
        const singleScrollContainer = appsSection ? appsSection.querySelector('.single-scroll-container') : null;
        const appPanelsContainer = appsSection ? appsSection.querySelector('.app-panels-container') : null;
        
        // Make sure main content is the only scrollable container
        if (mainContent) {
            mainContent.style.overflowY = 'auto';
            mainContent.style.height = '100vh';
        }
        
        // If the apps section exists, make it visible but not scrollable
        if (appsSection) {
            // Remove scrolling from apps section
            appsSection.style.overflow = 'visible';
            appsSection.style.height = 'auto';
            appsSection.style.maxHeight = 'none';
            
            // Remove scrolling from single scroll container
            if (singleScrollContainer) {
                singleScrollContainer.style.overflow = 'visible';
                singleScrollContainer.style.height = 'auto';
                singleScrollContainer.style.maxHeight = 'none';
            }
            
            // Remove excessive padding from app panels container
            if (appPanelsContainer) {
                appPanelsContainer.style.height = 'auto';
                appPanelsContainer.style.overflow = 'visible';
                appPanelsContainer.style.marginBottom = '50px';
                appPanelsContainer.style.paddingBottom = '0';
            }
            
            // Remove excessive padding from all app panels
            const appPanels = document.querySelectorAll('.app-apps-panel');
            appPanels.forEach(panel => {
                panel.style.overflow = 'visible';
                panel.style.height = 'auto';
                panel.style.maxHeight = 'none';
                panel.style.paddingBottom = '50px';
                panel.style.marginBottom = '20px';
            });
            
            // Remove excessive bottom padding from additional options sections
            const additionalOptions = document.querySelectorAll('.additional-options, .skip-series-refresh');
            additionalOptions.forEach(section => {
                section.style.overflow = 'visible';
                section.style.marginBottom = '50px';
                section.style.paddingBottom = '20px';
            });
            
            // Make sure content sections are not scrollable
            const contentSections = document.querySelectorAll('.content-section');
            contentSections.forEach(section => {
                section.style.overflow = 'visible';
                section.style.height = 'auto';
            });
            
            // Make sure app container is not scrollable
            const appsContainer = document.getElementById('appsContainer');
            if (appsContainer) {
                appsContainer.style.overflow = 'visible';
                appsContainer.style.height = 'auto';
            }
        }
    }
    
    // Apply the fix immediately
    fixAppsScrolling();
    
    // Apply after a short delay to account for dynamic content
    setTimeout(fixAppsScrolling, 500);
    setTimeout(fixAppsScrolling, 1000); // Additional delayed application
    
    // Apply when app selection changes
    const appsAppSelect = document.getElementById('appsAppSelect');
    if (appsAppSelect) {
        appsAppSelect.addEventListener('change', function() {
            // Wait for panel to update
            setTimeout(fixAppsScrolling, 300);
        });
    }
    
    // Apply when window is resized
    window.addEventListener('resize', fixAppsScrolling);
    
    // Apply when hash changes (navigation)
    window.addEventListener('hashchange', function() {
        // Check if we navigated to the apps section
        setTimeout(fixAppsScrolling, 300);
    });
}); 

/* === modules/ui/card-hover-effects.js === */
/**
 * Sniparr - Card Hover Effects
 * Adds subtle hover animations to app cards
 */

document.addEventListener('DOMContentLoaded', function() {
    // Add hover effects to app cards
    const appCards = document.querySelectorAll('.app-stats-card');
    
    appCards.forEach(card => {
        // Add transition properties
        card.style.transition = 'transform 0.3s ease, box-shadow 0.3s ease, filter 0.3s ease';
        
        // Mouse enter event - elevate and highlight card
        card.addEventListener('mouseenter', function() {
            card.style.transform = 'translateY(-5px) scale(1.02)';
            card.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.2)';
            card.style.filter = 'brightness(1.1)';
            
            // Get app type from classes
            const appType = getAppType(card);
            if (appType) {
                // Add app-specific glow effect
                const glowColors = {
                    'sonarr': '0 0 15px rgba(52, 152, 219, 0.4)',
                    'radarr': '0 0 15px rgba(243, 156, 18, 0.4)',
                    'lidarr': '0 0 15px rgba(46, 204, 113, 0.4)',
                    'readarr': '0 0 15px rgba(231, 76, 60, 0.4)',
                    'whisparr': '0 0 15px rgba(155, 89, 182, 0.4)',
                    'eros': '0 0 15px rgba(26, 188, 156, 0.4)'
                };
                
                if (glowColors[appType]) {
                    card.style.boxShadow += ', ' + glowColors[appType];
                }
            }
        });
        
        // Mouse leave event - return to normal
        card.addEventListener('mouseleave', function() {
            card.style.transform = 'translateY(0) scale(1)';
            card.style.boxShadow = '';
            card.style.filter = 'brightness(1)';
        });
    });
    
    // Helper function to get app type from card classes
    function getAppType(card) {
        const classList = card.classList;
        const appTypes = ['sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros', 'swaparr'];
        
        for (const type of appTypes) {
            if (classList.contains(type)) {
                return type;
            }
        }
        
        return null;
    }
});


/* === modules/ui/circular-progress.js === */
/**
 * Sniparr - Circular Progress Indicators
 * Creates animated circular progress indicators for API usage counters
 */

document.addEventListener('DOMContentLoaded', function() {
    // Create and inject SVG progress indicators for API counts
    const apps = ['sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros', 'swaparr'];
    
    // App-specific colors matching your existing design
    const appColors = {
        'sonarr': '#6366f1',  // Indigo
        'radarr': '#f39c12',  // Yellow/orange
        'lidarr': '#2ecc71',  // Green
        'readarr': '#e74c3c', // Red
        'whisparr': '#9b59b6', // Purple
        'eros': '#1abc9c'     // Teal
    };
    
    // Add circular progress indicators to each API count indicator
    apps.forEach(app => {
        const capContainer = document.querySelector(`#${app}-hourly-cap`);
        if (!capContainer) return;
        
        // Get current API count and limit
        const countElement = document.querySelector(`#${app}-api-count`);
        const limitElement = document.querySelector(`#${app}-api-limit`);
        
        if (!countElement || !limitElement) return;
        
        const count = parseInt(countElement.textContent);
        const limit = parseInt(limitElement.textContent);
        
        // Create SVG container for progress circle
        const svgSize = 28;
        const circleRadius = 10;
        const circleStrokeWidth = 2.5;
        const circumference = 2 * Math.PI * circleRadius;
        
        // Calculate progress percentage
        const percentage = Math.min(count / limit, 1);
        const dashOffset = circumference * (1 - percentage);
        
        // Create SVG element
        const svgNamespace = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(svgNamespace, "svg");
        svg.setAttribute("width", svgSize);
        svg.setAttribute("height", svgSize);
        svg.setAttribute("viewBox", `0 0 ${svgSize} ${svgSize}`);
        svg.classList.add("api-progress-circle");
        
        // Background circle
        const bgCircle = document.createElementNS(svgNamespace, "circle");
        bgCircle.setAttribute("cx", svgSize / 2);
        bgCircle.setAttribute("cy", svgSize / 2);
        bgCircle.setAttribute("r", circleRadius);
        bgCircle.setAttribute("fill", "none");
        bgCircle.setAttribute("stroke", "rgba(255, 255, 255, 0.1)");
        bgCircle.setAttribute("stroke-width", circleStrokeWidth);
        
        // Progress circle
        const progressCircle = document.createElementNS(svgNamespace, "circle");
        progressCircle.setAttribute("cx", svgSize / 2);
        progressCircle.setAttribute("cy", svgSize / 2);
        progressCircle.setAttribute("r", circleRadius);
        progressCircle.setAttribute("fill", "none");
        progressCircle.setAttribute("stroke", appColors[app]);
        progressCircle.setAttribute("stroke-width", circleStrokeWidth);
        progressCircle.setAttribute("stroke-dasharray", circumference);
        progressCircle.setAttribute("stroke-dashoffset", dashOffset);
        progressCircle.setAttribute("transform", `rotate(-90 ${svgSize/2} ${svgSize/2})`);
        
        // Add circles to SVG
        svg.appendChild(bgCircle);
        svg.appendChild(progressCircle);
        
        // Add SVG before text content
        capContainer.insertBefore(svg, capContainer.firstChild);
        
        // Style for the indicator
        const style = document.createElement('style');
        style.textContent = `
            .api-progress-circle {
                margin-right: 5px;
                filter: drop-shadow(0 0 3px ${appColors[app]}40);
            }
            
            .hourly-cap-status {
                display: flex;
                align-items: center;
            }
            
            .api-progress-circle circle:nth-child(2) {
                filter: drop-shadow(0 0 4px ${appColors[app]}60);
                transition: stroke-dashoffset 0.5s ease;
            }
        `;
        document.head.appendChild(style);
        
        // Update progress when API counts change
        const updateProgressCircle = () => {
            const newCount = parseInt(countElement.textContent);
            const newLimit = parseInt(limitElement.textContent);
            const newPercentage = Math.min(newCount / newLimit, 1);
            const newDashOffset = circumference * (1 - newPercentage);
            
            progressCircle.setAttribute("stroke-dashoffset", newDashOffset);
            
            // Change color based on usage percentage
            if (newPercentage > 0.9) {
                progressCircle.setAttribute("stroke", "#e74c3c"); // Red when near limit
            } else if (newPercentage > 0.75) {
                progressCircle.setAttribute("stroke", "#f39c12"); // Orange/yellow for moderate usage
            } else {
                progressCircle.setAttribute("stroke", appColors[app]); // Default color
            }
        };
        
        // Set up a mutation observer to watch for changes in the count value
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'characterData' || mutation.type === 'childList') {
                    updateProgressCircle();
                }
            });
        });
        
        // Observe both count and limit elements
        observer.observe(countElement, { characterData: true, childList: true, subtree: true });
        observer.observe(limitElement, { characterData: true, childList: true, subtree: true });
    });
});


/* === modules/ui/background-pattern.js === */
/**
 * Sniparr - Subtle Background Pattern
 * Adds a modern dot grid pattern to the dashboard background
 */

document.addEventListener('DOMContentLoaded', function() {
    // Add subtle background pattern styles
    const style = document.createElement('style');
    style.id = 'background-pattern-styles';
    
    // Pattern style based on the user's preference for dark themes with blue accents
    style.textContent = `
        /* Subtle dot grid pattern for dark background */
        .dashboard-grid::before {
            content: "";
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background-image: 
                radial-gradient(circle at 1px 1px, rgba(85, 97, 215, 0.07) 1px, transparent 0);
            background-size: 25px 25px;
            background-position: -5px -5px;
            pointer-events: none;
            z-index: 0;
            opacity: 0.5;
        }
        
        /* Make sure all dashboard content stays above the pattern */
        .dashboard-grid > * {
            position: relative;
            z-index: 1;
        }
        
        /* For mobile - smaller pattern */
        @media (max-width: 768px) {
            .dashboard-grid::before {
                background-size: 20px 20px;
            }
        }
    `;
    
    document.head.appendChild(style);
    
    // Make sure the container has position relative for the pattern to work
    const dashboardGrid = document.querySelector('.dashboard-grid');
    if (dashboardGrid) {
        dashboardGrid.style.position = 'relative';
        dashboardGrid.style.overflow = 'hidden';
    }
});


/* === modules/ui/hourly-cap.js === */
/**
 * Hourly API Cap Handling for Sniparr
 * Fetches and updates the hourly API usage indicators on the dashboard
 */

document.addEventListener('DOMContentLoaded', function() {
    // Set up polling to refresh the hourly cap data every 2 minutes
    setInterval(loadHourlyCapData, 120000);
});

/**
 * Load hourly API cap data from the server
 */
window.loadHourlyCapData = function loadHourlyCapData() {
    SniparrUtils.fetchWithTimeout('./api/hourly-caps')
        .then(response => {
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            return response.json();
        })
        .then(data => {
            if (data.success && data.caps && data.limits) {
                updateHourlyCapDisplay(data.caps, data.limits);
            } else {
                console.error('Failed to load hourly API cap data:', data.message || 'Unknown error');
            }
        })
        .catch(error => {
            console.error('Error fetching hourly API cap data:', error);
        });
};

/**
 * Get instance name for a card (from card attribute or reset button).
 * @param {Element} card - .app-stats-card element
 * @returns {string|null} Instance name or null for single-app
 */
function getInstanceNameForCard(card) {
    // Check card attribute first (most reliable)
    if (card.hasAttribute('data-instance-name')) {
        return card.getAttribute('data-instance-name');
    }
    // Fallback to reset button
    const resetBtn = card.querySelector('.cycle-reset-button[data-instance-name]');
    return resetBtn ? resetBtn.getAttribute('data-instance-name') : null;
}

/**
 * Update the hourly API cap indicators for each app (per-instance when app has instances).
 * Data is keyed by instance name; fallback to index so 2nd+ instance cards always update.
 * @param {Object} caps - Hourly API usage: per-app or per-instance (caps[app].instances[instanceName])
 * @param {Object} limits - Limits: per-app number or per-instance (limits[app].instances[instanceName])
 */
function updateHourlyCapDisplay(caps, limits) {
    const apps = ['sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros', 'swaparr'];

    apps.forEach(app => {
        if (!caps[app]) return;
        const cards = document.querySelectorAll('.app-stats-card.' + app);
        const hasInstances = caps[app].instances && typeof caps[app].instances === 'object';
        const appLimit = typeof limits[app] === 'number' ? limits[app] : 20;
        const usage = !hasInstances && caps[app].api_hits != null ? caps[app].api_hits : 0;

        let instanceNames = [];
        if (hasInstances && limits[app] && limits[app].instances) {
            instanceNames = Object.keys(caps[app].instances);
        }

        cards.forEach((card, cardIndex) => {
            let usageVal = usage;
            let limitVal = appLimit;
            if (hasInstances && instanceNames.length > 0) {
                const instanceName = getInstanceNameForCard(card);
                const nameToUse = instanceName != null && caps[app].instances[instanceName] != null
                    ? instanceName
                    : instanceNames[cardIndex] || null;
                const instCaps = nameToUse != null ? caps[app].instances[nameToUse] : null;
                const instLimits = limits[app].instances && nameToUse != null ? limits[app].instances[nameToUse] : appLimit;
                usageVal = instCaps && instCaps.api_hits != null ? instCaps.api_hits : 0;
                limitVal = instLimits != null ? instLimits : 20;
            }
            const pct = (limitVal > 0) ? (usageVal / limitVal) * 100 : 0;
            const countEl = card.querySelector('.hourly-cap-text span');
            const limitEl = card.querySelectorAll('.hourly-cap-text span')[1];
            if (countEl) countEl.textContent = usageVal;
            if (limitEl) limitEl.textContent = limitVal;
            const statusEl = card.querySelector('.hourly-cap-status');
            if (statusEl) {
                statusEl.classList.remove('good', 'warning', 'danger');
                if (pct >= 100) statusEl.classList.add('danger');
                else if (pct >= 75) statusEl.classList.add('warning');
                else statusEl.classList.add('good');
            }
            const progressFill = card.querySelector('.api-progress-fill');
            if (progressFill) progressFill.style.width = Math.min(100, pct) + '%';
            const progressSpans = card.querySelectorAll('.api-progress-text span');
            if (progressSpans.length >= 2) {
                progressSpans[0].textContent = usageVal;
                progressSpans[1].textContent = limitVal;
            }
        });
    });
}
