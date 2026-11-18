// Chart of accounts section of the Settings page (bookkeeping Phase A; docs/ACCOUNTING.md):
// map each expense category to an account, pick the default bank and capex accounts, check a month is ready to post.
window.AccountingSection = {
    orgId: null,
    accounts: [],
    mapping: null,       // { categories: [{ category, account_code, suggested_code, records }], settings }
    readiness: null,
    month: new Date().toISOString().slice(0, 7),
    loading: false,
    error: null,
    showChart: false,

    canEdit() {
        const org = (App.organizations || []).find(o => (o._id || o.id) === App.currentCompany);
        return !!org && ['owner', 'admin'].includes(org.role);
    },

    render(companyId) {
        if (this.orgId !== companyId) {
            this.orgId = companyId;
            this.accounts = [];
            this.mapping = null;
            this.readiness = null;
            this.loadedAt = 0;
        }
        if (Date.now() - (this.loadedAt || 0) > 30000) this.load();
        return `<div class="settings-section" id="accountingSection">${this.renderBody()}</div>`;
    },

    async load() {
        const orgId = this.orgId;
        if (!orgId || this.loading) return;
        this.loading = true;
        this.error = null;
        try {
            const [accounts, mapping, readiness] = await Promise.all([
                AccountingApi.accounts(orgId), AccountingApi.mapping(orgId), AccountingApi.journal(orgId, this.month),
            ]);
            if (orgId !== this.orgId) return;
            Object.assign(this, { accounts, mapping, readiness, loadedAt: Date.now() });
        } catch (error) {
            this.error = error.message;
        } finally {
            this.loading = false;
            this.refresh();
        }
    },

    refresh() {
        const el = document.getElementById('accountingSection');
        if (el) el.innerHTML = this.renderBody();
    },

    label(a) { return `${a.code} · ${a.name}${a.name_th ? ` (${a.name_th})` : ''}`; },

    options(filter, selected, blank) {
        const list = this.accounts.filter(a => (a.active || a.code === selected) && filter(a));
        return (blank ? `<option value="">${blank}</option>` : '') +
            list.map(a => `<option value="${esc(a.code)}" ${a.code === selected ? 'selected' : ''}>${esc(this.label(a))}</option>`).join('');
    },

    renderBody() {
        const title = `
        <div class="settings-title">📒 Chart of accounts</div>
        <div class="settings-subtitle">Which account each category posts to, for the monthly journal and management accounts.
          Started from a standard Thai SME chart, so have your accountant review it once.</div>`;
        if (this.error) {
            return title + `<div style="font-size:0.85rem;color:var(--red)">⚠️ Couldn't load the chart of accounts: ${esc(this.error)}
              <button class="btn btn-secondary btn-sm" style="margin-left:8px" onclick="AccountingSection.load()">↻ Retry</button></div>`;
        }
        if (!this.mapping) return title + '<div class="skeleton" style="height:120px"></div>';

        const edit = this.canEdit();
        const dis = edit ? '' : 'disabled';
        const postable = a => a.type === 'expense' || a.role === 'fixed_asset' || a.role === 'construction';
        const s = this.mapping.settings || {};
        const rows = this.mapping.categories.map((c, i) => {
            const value = c.account_code ?? c.suggested_code ?? '';
            const note = c.account_code ? '' : c.suggested_code
                ? '<span style="color:var(--amber);font-size:0.75rem">Suggested, not saved yet</span>'
                : '<span style="color:var(--red);font-size:0.75rem">Not mapped</span>';
            return `<div class="settings-row" style="gap:12px;flex-wrap:wrap">
              <span style="min-width:140px">${esc(c.category)} <span style="color:var(--text-muted);font-size:0.75rem">${c.records ? `${c.records} receipt${c.records === 1 ? '' : 's'}` : ''}</span><br>${note}</span>
              <select class="form-input" style="max-width:420px;flex:1" data-map="${i}" ${dis}>${this.options(postable, value, '— not mapped —')}</select>
            </div>`;
        }).join('');

        return title + `
        ${this.renderReadiness()}
        <div class="settings-rows">
          ${rows || '<div style="font-size:0.85rem;color:var(--text-muted)">No categories yet. Add them under Property above.</div>'}
          <div class="settings-row" style="gap:12px;flex-wrap:wrap">
            <span style="min-width:140px">🏦 Company payments from</span>
            <select class="form-input" style="max-width:420px;flex:1" id="acctBank" ${dis}>${this.options(a => a.role === 'bank' || a.role === 'cash', s.bank_code)}</select>
          </div>
          <div class="settings-row" style="gap:12px;flex-wrap:wrap">
            <span style="min-width:140px" title="For receipts flagged capex in a category that maps to an expense account">🏗 Capex default asset</span>
            <select class="form-input" style="max-width:420px;flex:1" id="acctCapex" ${dis}>${this.options(a => a.role === 'fixed_asset' || a.role === 'construction', s.capex_code)}</select>
          </div>
        </div>
        ${edit ? `<div style="display:flex;gap:10px;margin-top:14px">
          <button class="btn btn-primary btn-sm" id="saveMappingBtn" onclick="AccountingSection.save()">💾 Save mapping</button>
        </div>` : '<div style="font-size:0.8rem;color:var(--text-muted);margin-top:10px">Only an owner or admin can change the mapping.</div>'}

        <details style="margin-top:16px" ${this.showChart ? 'open' : ''} ontoggle="AccountingSection.showChart = this.open">
          <summary class="btn btn-ghost btn-sm" style="display:inline-flex">📖 View / edit accounts (${this.accounts.length})</summary>
          ${this.renderChart(edit)}
        </details>`;
    },

    renderReadiness() {
        const r = this.readiness;
        if (!r) return '';
        const item = (x, color) => `<li style="color:${color}">${esc(x.message)} · ${x.count}${x.categories ? `: ${x.categories.map(esc).join(', ')}` : ''}</li>`;
        return `
        <div style="padding:10px 12px;border-radius:8px;margin-bottom:12px;background:${r.ready ? 'var(--green-soft, rgba(16,185,129,.1))' : 'var(--amber-soft)'}">
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
            <strong>${r.ready ? '✅' : '⏳'} ${esc(r.month)} ${r.ready ? 'is ready to post' : 'is not ready to post yet'}</strong>
            <span style="font-size:0.8rem;color:var(--text-secondary)">${r.posted} confirmed receipt${r.posted === 1 ? '' : 's'}</span>
            <input type="month" class="form-input" style="max-width:170px;margin-left:auto" value="${esc(this.month)}" onchange="AccountingSection.setMonth(this.value)" aria-label="Month to check">
            <button class="btn ${r.ready ? 'btn-primary' : 'btn-secondary'} btn-sm" id="journalBtn" ${r.ready && r.posted ? '' : 'disabled'}
              title="${r.ready ? 'General journal and trial balance for this month' : 'Fix the items below first'}"
              onclick="AccountingSection.downloadJournal()">⬇ Journal (Excel)</button>
          </div>
          ${r.blockers.length || r.warnings.length ? `<ul style="margin:6px 0 0 18px;font-size:0.82rem">
            ${r.blockers.map(x => item(x, 'var(--red)')).join('')}${r.warnings.map(x => item(x, 'var(--amber)')).join('')}
            ${(r.errors || []).slice(0, 10).map(x => `<li style="color:var(--red)">${esc(x.vendor_name || 'Receipt')}: ${esc(x.message)}</li>`).join('')}
          </ul>` : ''}
          ${r.ready && r.entries ? `<div style="font-size:0.8rem;color:var(--text-secondary);margin-top:6px">${r.entries.length} journal entr${r.entries.length === 1 ? 'y' : 'ies'} · Dr ${fmtTHB(r.totals.debit)} = Cr ${fmtTHB(r.totals.credit)}</div>` : ''}
        </div>`;
    },

    renderChart(edit) {
        const types = [['asset', 'Assets'], ['liability', 'Liabilities'], ['equity', 'Equity'], ['revenue', 'Revenue'], ['expense', 'Expenses']];
        const row = a => `<tr style="${a.active ? '' : 'opacity:.5'}">
            <td>${esc(a.code)}</td><td>${esc(a.name)}<br><span style="color:var(--text-muted)">${esc(a.name_th)}</span></td>
            <td>${a.life_years ? `${a.life_years} yrs` : ''}</td>
            <td>${edit ? `<button class="btn btn-ghost btn-sm" onclick="AccountingSection.editAccount('${esc(a.id)}')">Edit</button>` : ''}</td></tr>`;
        return `
          <table class="table" style="width:100%;font-size:0.82rem;margin-top:10px">
            <thead><tr><th style="text-align:left">Code</th><th style="text-align:left">Account</th><th style="text-align:left">Life</th><th></th></tr></thead>
            ${types.map(([t, l]) => `<tbody><tr><td colspan="4" style="font-weight:600;padding-top:10px">${l}</td></tr>${this.accounts.filter(a => a.type === t).map(row).join('')}</tbody>`).join('')}
          </table>
          ${edit ? `<form style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px" onsubmit="event.preventDefault();AccountingSection.addAccount()">
            <input class="form-input" id="newAcctCode" placeholder="Code, e.g. 6240" style="max-width:120px" required>
            <input class="form-input" id="newAcctName" placeholder="Name, e.g. Pest control" style="max-width:220px" required>
            <input class="form-input" id="newAcctNameTh" placeholder="ชื่อภาษาไทย" style="max-width:200px">
            <select class="form-input" id="newAcctType" style="max-width:140px">${types.map(([t, l]) => `<option value="${t}" ${t === 'expense' ? 'selected' : ''}>${l}</option>`).join('')}</select>
            <button class="btn btn-secondary btn-sm" type="submit">+ Add account</button>
          </form>` : ''}`;
    },

    async setMonth(month) {
        if (!/^\d{4}-\d{2}$/.test(month)) return;
        this.month = month;
        try {
            this.readiness = await AccountingApi.journal(this.orgId, month);
        } catch (error) {
            App.showToast('error', error.message);
        }
        this.refresh();
    },

    async downloadJournal() {
        const btn = document.getElementById('journalBtn');
        if (btn) { btn.disabled = true; btn.textContent = '⏳ Preparing...'; }
        try {
            await ReportApi.download(
                `/accounting/journal.xlsx?${new URLSearchParams({ organization_id: this.orgId, month: this.month })}`,
                `journal-${this.month}.xlsx`,
            );
        } catch (error) {
            App.showToast('error', error.message);
        }
        if (btn) { btn.disabled = false; btn.textContent = '⬇ Journal (Excel)'; }
    },

    async save() {
        const btn = document.getElementById('saveMappingBtn');
        const mappings = this.mapping.categories.map((c, i) => ({
            category: c.category,
            account_code: document.querySelector(`#accountingSection [data-map="${i}"]`)?.value || null,
        }));
        if (btn) { btn.disabled = true; btn.textContent = '⏳ Saving...'; }
        try {
            this.mapping = await AccountingApi.saveMapping(this.orgId, {
                mappings,
                bank_code: document.getElementById('acctBank')?.value,
                capex_code: document.getElementById('acctCapex')?.value,
            });
            this.readiness = await AccountingApi.journal(this.orgId, this.month);
            App.showToast('success', '✅ Mapping saved');
        } catch (error) {
            App.showToast('error', error.message);
        }
        this.refresh();
    },

    async addAccount() {
        const v = id => (document.getElementById(id)?.value || '').trim();
        try {
            const acc = await AccountingApi.createAccount(this.orgId, { code: v('newAcctCode'), name: v('newAcctName'), name_th: v('newAcctNameTh'), type: v('newAcctType') });
            this.accounts = [...this.accounts, acc].sort((a, b) => a.code.localeCompare(b.code));
            this.showChart = true;
            App.showToast('success', `✅ Account ${acc.code} added`);
            this.refresh();
        } catch (error) {
            App.showToast('error', error.message);
        }
    },

    async editAccount(id) {
        const a = this.accounts.find(x => x.id === id);
        if (!a) return;
        const code = prompt('Account code', a.code);
        if (code === null) return;
        const name = prompt('Name (English)', a.name);
        if (name === null) return;
        const nameTh = prompt('ชื่อภาษาไทย', a.name_th);
        if (nameTh === null) return;
        const fields = { code: code.trim(), name: name.trim(), name_th: nameTh.trim() };
        if (!a.role) fields.active = confirm(`Keep ${fields.code} active? (Cancel = deactivate)`);
        try {
            await AccountingApi.updateAccount(id, fields);
            this.loadedAt = 0;
            this.showChart = true;
            App.showToast('success', '✅ Account updated');
            await this.load();
        } catch (error) {
            App.showToast('error', error.message);
        }
    },
};
