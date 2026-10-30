// Settings Page — the current property, server OCR status, account, appearance and data export
window.SettingsPage = {
    draft: null,      // { orgId, organization_name, color, categories } being edited
    status: null,     // GET /system/status
    statusError: null,

    org() {
        return (App.organizations || []).find(o => (o._id || o.id) === App.currentCompany);
    },

    canEdit() {
        const org = this.org();
        return !!org && ['owner', 'admin'].includes(org.role);
    },

    render(companyId) {
        const org = this.org();
        if (!this.draft || this.draft.orgId !== companyId) {
            this.draft = org ? {
                orgId: companyId,
                organization_name: org.organization_name,
                color: orgColor(org),
                categories: [...(org.categories || [])],
            } : null;
        }
        if (!this.status) this.loadStatus();

        return `
      <div class="page-header">
        <div class="page-header-left">
          <h1>⚙️ Settings</h1>
          <p>Your property, its members, how receipts are read, and your account</p>
        </div>
      </div>

      ${this.renderProperty()}

      ${MembersSection.render(companyId)}

      <div class="settings-section">
        <div class="settings-title">🤖 Receipt reading (OCR)</div>
        <div class="settings-subtitle">Configured on the server. API keys live in the server environment, never in the browser.</div>
        <div id="ocrStatus">${this.renderStatus()}</div>
      </div>

      <div class="settings-section">
        <div class="settings-title">👤 Account</div>
        <div class="settings-subtitle">Signed in to DocFlow AI</div>
        <div class="settings-rows">
          <div class="settings-row"><span>Name</span><strong>${esc(App.currentUser?.name || '—')}</strong></div>
          <div class="settings-row"><span>Email</span><strong>${esc(App.currentUser?.email || '—')}</strong></div>
          <div class="settings-row"><span>Role in ${esc(org?.organization_name || 'this property')}</span><strong style="text-transform:capitalize">${esc(org?.role || '—')}</strong></div>
        </div>
        <details class="password-change" style="margin-top:16px">
          <summary class="btn btn-secondary btn-sm" style="display:inline-flex">🔑 Change password</summary>
          <form style="display:grid;gap:10px;max-width:360px;margin-top:12px" onsubmit="event.preventDefault();SettingsPage.changePassword()">
            <input class="form-input" id="pwCurrent" type="password" placeholder="Current (or temporary) password" autocomplete="current-password" required>
            <input class="form-input" id="pwNew" type="password" placeholder="New password, at least 8 characters" autocomplete="new-password" minlength="8" required>
            <input class="form-input" id="pwConfirm" type="password" placeholder="Repeat new password" autocomplete="new-password" minlength="8" required>
            <button class="btn btn-primary btn-sm" type="submit" id="pwBtn" style="justify-self:start">Save new password</button>
          </form>
        </details>
        <button class="btn btn-secondary btn-sm" style="margin-top:12px" onclick="App.handleLogout()">🚪 Sign out</button>
      </div>

      <div class="settings-section">
        <div class="settings-title">🎨 Appearance</div>
        <div class="settings-subtitle">Saved in this browser</div>
        <div class="filter-chips" style="margin-bottom:0" role="radiogroup" aria-label="Theme">
          ${[['dark', '🌙 Dark'], ['light', '☀️ Light']].map(([t, label]) => `
            <button class="filter-chip ${App.currentTheme === t ? 'active' : ''}" role="radio" aria-checked="${App.currentTheme === t}"
              onclick="SettingsPage.setTheme('${t}')">${label}</button>`).join('')}
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-title">📤 Data</div>
        <div class="settings-subtitle">Every record for ${esc(org?.organization_name || 'this property')}, including drafts and disabled ones, as a CSV that opens in Excel with Thai text intact</div>
        <button class="btn btn-secondary btn-sm" id="exportBtn" onclick="SettingsPage.exportCsv()">⬇ Export CSV</button>
      </div>

      <div class="settings-section">
        <div class="settings-title">🔗 Integrations</div>
        <div class="settings-subtitle">Planned for Phase 3, one at a time. Nothing to configure yet.</div>
        <div class="settings-rows">
          ${['💬 LINE bot — send a photo of a receipt to file it', '📧 Gmail — pick up e-Tax invoices from your inbox', '📁 Google Drive — file originals into folders', '🗂️ Google Sheets / Airtable — two-way sync']
            .map(i => `<div class="settings-row"><span>${i}</span><span class="nav-soon">Soon</span></div>`).join('')}
        </div>
      </div>
    `;
    },

    renderProperty() {
        const d = this.draft;
        if (!d) return '';
        const editable = this.canEdit();
        const dis = editable ? '' : 'disabled';
        return `
      <div class="settings-section" style="border-left:3px solid ${d.color}">
        <div class="settings-title">🏢 Property</div>
        <div class="settings-subtitle">${editable
            ? 'Name, colour and the categories offered when you review a receipt'
            : 'Only an owner or admin can change these'}</div>

        <div class="form-group">
          <label class="form-label" for="propName">Name</label>
          <input class="form-input" id="propName" value="${esc(d.organization_name)}" ${dis}
            oninput="SettingsPage.draft.organization_name = this.value">
        </div>

        <div class="form-group">
          <div class="form-label">Colour</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap" role="radiogroup" aria-label="Property colour">
            ${ORG_COLORS.map(c => `
              <button class="org-swatch-btn" role="radio" aria-checked="${c === d.color}" aria-label="${c}" ${dis}
                style="background:${c};border-color:${c === d.color ? 'var(--text-primary)' : 'transparent'}"
                onclick="SettingsPage.setColor('${c}')"></button>`).join('')}
          </div>
        </div>

        <div class="form-group" style="margin-bottom:0">
          <div class="form-label">Categories</div>
          <div id="categoryChips" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">${this.renderCategories()}</div>
          ${editable ? `
          <form style="display:flex;gap:8px;max-width:420px" onsubmit="event.preventDefault();SettingsPage.addCategory()">
            <input class="form-input" id="newCategory" placeholder="Add a category, e.g. Utilities" maxlength="60">
            <button class="btn btn-secondary btn-sm" type="submit" style="white-space:nowrap">+ Add</button>
          </form>` : ''}
        </div>

        ${editable ? `
        <div style="display:flex;gap:10px;margin-top:20px">
          <button class="btn btn-primary btn-sm" id="savePropertyBtn" onclick="SettingsPage.saveProperty()">💾 Save property</button>
          <button class="btn btn-ghost btn-sm" onclick="SettingsPage.resetDraft()">Undo changes</button>
        </div>` : ''}
      </div>`;
    },

    renderCategories() {
        const d = this.draft;
        if (!d.categories.length) {
            return '<span style="font-size:0.8rem;color:var(--text-muted)">No categories yet: the default list is used.</span>';
        }
        const editable = this.canEdit();
        return d.categories.map((c, i) => `
          <span class="badge badge-info" style="display:inline-flex;align-items:center;gap:6px;font-size:0.78rem;padding:4px 10px">
            ${esc(c)}
            ${editable ? `<button onclick="SettingsPage.removeCategory(${i})" aria-label="Remove ${esc(c)}"
              style="background:none;border:none;color:inherit;cursor:pointer;font-size:0.9rem;line-height:1">×</button>` : ''}
          </span>`).join('');
    },

    renderStatus() {
        if (this.statusError) {
            return `<div style="font-size:0.85rem;color:var(--red)">⚠️ Couldn't load server status: ${esc(this.statusError)}
              <button class="btn btn-secondary btn-sm" style="margin-left:8px" onclick="SettingsPage.loadStatus(true)">↻ Retry</button></div>`;
        }
        if (!this.status) return '<div class="skeleton" style="height:96px"></div>';

        const { ocr, max_upload_mb } = this.status;
        const names = { typhoon: 'Typhoon OCR', claude: 'Claude', tesseract: 'Tesseract (offline)' };
        const mode = ocr.setting === 'auto' ? 'Automatic: Typhoon, then Claude, then Tesseract' : `Fixed to ${names[ocr.setting] || ocr.setting}`;
        const row = (key, note) => {
            const on = ocr.engines[key];
            return `<div class="settings-row">
              <span>${names[key]} <span style="color:var(--text-muted);font-size:0.75rem">${note}</span></span>
              <span class="badge ${on ? 'badge-confirmed' : 'badge-draft'}">${on ? (ocr.active === key ? '● In use' : 'Configured') : 'Not set up'}</span>
            </div>`;
        };
        return `
        <div class="settings-rows">
          <div class="settings-row"><span>Engine in use</span><strong>${esc(names[ocr.active] || ocr.active)}</strong></div>
          <div class="settings-row"><span>Mode</span><span>${esc(mode)}</span></div>
          ${row('typhoon', 'best for Thai receipts')}
          ${row('claude', 'optional')}
          ${row('tesseract', 'always available fallback')}
          <div class="settings-row"><span>Max upload size</span><span>${Number(max_upload_mb)} MB</span></div>
        </div>
        ${!ocr.engines.typhoon ? `<p style="font-size:0.78rem;color:var(--amber);margin-top:12px">
          Typhoon isn't set up, so Thai receipts are read with the less accurate offline engine.
          Set <code>TYPHOON_OCR_API_KEY</code> on the API project in Vercel to enable it.</p>` : ''}`;
    },

    async loadStatus(force = false) {
        if (this.loadingStatus && !force) return;
        this.loadingStatus = true;
        this.statusError = null;
        try {
            this.status = await SystemApi.status();
        } catch (error) {
            this.statusError = error.message;
        } finally {
            this.loadingStatus = false;
            const el = document.getElementById('ocrStatus');
            if (el) el.innerHTML = this.renderStatus();
        }
    },

    refreshProperty() {
        if (App.currentPage !== 'settings') return;
        const content = document.getElementById('mainContent');
        if (content) content.innerHTML = this.render(App.currentCompany);
    },

    setColor(color) {
        this.draft.color = color;
        this.refreshProperty();
    },

    addCategory() {
        const input = document.getElementById('newCategory');
        const name = (input?.value || '').trim();
        if (!name) return;
        if (this.draft.categories.some(c => c.toLowerCase() === name.toLowerCase())) {
            App.showToast('info', `"${name}" is already in the list`);
            return;
        }
        this.draft.categories.push(name);
        input.value = '';
        document.getElementById('categoryChips').innerHTML = this.renderCategories();
        input.focus();
    },

    removeCategory(i) {
        this.draft.categories.splice(i, 1);
        document.getElementById('categoryChips').innerHTML = this.renderCategories();
    },

    resetDraft() {
        this.draft = null;
        this.refreshProperty();
    },

    async saveProperty() {
        const d = this.draft;
        if (!d.organization_name.trim()) {
            App.showToast('error', 'The property needs a name');
            return;
        }
        const btn = document.getElementById('savePropertyBtn');
        if (btn) { btn.disabled = true; btn.textContent = '⏳ Saving...'; }
        try {
            await OrganizationApi.update(d.orgId, {
                organization_name: d.organization_name,
                color: d.color,
                categories: d.categories,
            });
            await App.refreshOrganizations();
            this.draft = null;
            App.showToast('success', '✅ Property saved');
            this.refreshProperty();
        } catch (error) {
            App.showToast('error', '❌ ' + error.message, 4000);
            if (btn) { btn.disabled = false; btn.textContent = '💾 Save property'; }
        }
    },

    async changePassword() {
        const current = document.getElementById('pwCurrent').value;
        const next = document.getElementById('pwNew').value;
        if (next !== document.getElementById('pwConfirm').value) {
            App.showToast('error', 'The new passwords do not match', 4000);
            return;
        }
        const btn = document.getElementById('pwBtn');
        if (btn) { btn.disabled = true; btn.textContent = '⏳ Saving...'; }
        try {
            await AuthApi.changePassword(current, next);
            App.showToast('success', '🔑 Password changed');
            ['pwCurrent', 'pwNew', 'pwConfirm'].forEach(id => { document.getElementById(id).value = ''; });
            document.querySelector('.password-change')?.removeAttribute('open');
        } catch (error) {
            App.showToast('error', '❌ ' + error.message, 4000);
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = 'Save new password'; }
        }
    },

    setTheme(theme) {
        if (App.currentTheme !== theme) App.toggleTheme();
        this.refreshProperty();
    },

    async exportCsv() {
        const btn = document.getElementById('exportBtn');
        if (btn) { btn.disabled = true; btn.textContent = '⏳ Preparing...'; }
        try {
            const rows = await ExpenseApi.listExpenses(App.currentCompany);
            const cols = [
                ['Date', 'date'], ['Vendor', 'vendor_name'], ['Vendor tax ID', 'vendor_taxid'], ['Invoice no.', 'invoice_number'],
                ['Category', 'category'], ['Subtotal', 'subtotal'], ['VAT', 'tax_amount'], ['Total', 'total'],
                ['Currency', 'currency'], ['Status', 'status'], ['Notes', 'notes'], ['Has original file', 'receipt_id'],
            ];
            const NUMERIC = ['subtotal', 'tax_amount', 'total'];
            const value = (r, k) => k === 'receipt_id' ? (r.receipt_id ? 'yes' : 'no') : k === 'date' ? String(r.date || '').slice(0, 10) : r[k];
            downloadCsv(`${this.org()?.organization_name || 'docflow'}_expenses_${new Date().toISOString().slice(0, 10)}.csv`, [
                cols.map(c => csvCell(c[0])),
                ...rows.map(r => cols.map(([, k]) => csvCell(value(r, k), { taxId: k === 'vendor_taxid', numeric: NUMERIC.includes(k) }))),
            ]);
            App.showToast('success', `⬇ Exported ${rows.length} record${rows.length === 1 ? '' : 's'}`);
        } catch (error) {
            App.showToast('error', '❌ Export failed: ' + error.message, 4000);
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = '⬇ Export CSV'; }
        }
    },
};
