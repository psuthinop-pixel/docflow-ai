// Management accounts page: the monthly pack (docs/ACCOUNTING.md, Phase D) for one property or the group.
// Every figure comes from GET /accounting/mma; Claude's commentary is generated on request and number-checked server-side.
window.MmaPage = {
    scope: 'property',     // 'property' | 'all'
    month: null,
    data: null,
    loading: false,
    error: null,
    language: 'en',
    generating: false,

    REASONS: { fuel: 'Fuel (passenger car): VAT kept in cost', excluded: 'Marked not claimable', missing_tax_id: 'No 13-digit seller tax ID' },

    defaultMonth() {
        const d = new Date();
        return new Date(Date.UTC(d.getFullYear(), d.getMonth() - 1, 1)).toISOString().slice(0, 7); // last month
    },

    orgParam() { return this.scope === 'all' ? 'all' : App.currentCompany; },

    canComment() {
        const orgs = App.organizations || [];
        const ok = o => ['owner', 'admin'].includes(o.role);
        return this.scope === 'all' ? orgs.length > 0 && orgs.every(ok) : orgs.some(o => (o._id || o.id) === App.currentCompany && ok(o));
    },

    render(companyId) {
        if (!this.month) this.month = this.defaultMonth();
        const key = `${this.orgParam()}|${this.month}`;
        if (this.loadedKey !== key) { this.loadedKey = key; this.load(); }
        return `<div id="mmaPage">${this.renderBody()}</div>`;
    },

    async load() {
        const key = this.loadedKey;
        this.loading = true;
        this.error = null;
        this.refresh();
        try {
            const data = await AccountingApi.mma(this.orgParam(), this.month);
            if (key !== this.loadedKey) return;
            this.data = data;
        } catch (error) {
            this.error = error.message;
            this.data = null;
        } finally {
            this.loading = false;
            this.refresh();
        }
    },

    refresh() {
        const el = document.getElementById('mmaPage');
        if (el && App.currentPage === 'mma') el.innerHTML = this.renderBody();
    },

    setScope(scope) { this.scope = scope; this.render(); },
    setMonth(month) { if (/^\d{4}-\d{2}$/.test(month)) { this.month = month; this.render(); } },

    renderBody() {
        const org = (App.organizations || []).find(o => (o._id || o.id) === App.currentCompany);
        const multi = this.scope === 'all';
        const d = this.data;
        const header = `
      <div class="page-header">
        <div class="page-header-left">
          <h1>📊 Management accounts</h1>
          <p>${multi ? 'All your properties' : esc(org ? org.organization_name : '')} · ${esc(fmtMonth(this.month, { month: 'long', year: 'numeric' }))}</p>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap" class="no-print">
          <button class="btn btn-secondary btn-sm" onclick="window.print()" ${d ? '' : 'disabled'}>🖨 Print / PDF</button>
          <button class="btn btn-secondary btn-sm" id="mmaXlsxBtn" onclick="MmaPage.exportXlsx()" ${d ? '' : 'disabled'}>⬇ Excel</button>
        </div>
      </div>
      <div class="report-filters no-print">
        <div class="filter-chips" role="radiogroup" aria-label="Properties">
          <button class="filter-chip ${!multi ? 'active' : ''}" role="radio" aria-checked="${!multi}" onclick="MmaPage.setScope('property')">${esc(org ? org.organization_name : 'This property')}</button>
          <button class="filter-chip ${multi ? 'active' : ''}" role="radio" aria-checked="${multi}" onclick="MmaPage.setScope('all')">All properties</button>
        </div>
        <input type="month" class="form-input" style="max-width:180px" value="${esc(this.month)}" onchange="MmaPage.setMonth(this.value)" aria-label="Month">
      </div>`;

        if (this.error) {
            return header + `<div class="card"><div style="color:var(--red)">⚠️ Couldn't load the pack: ${esc(this.error)}</div>
              <button class="btn btn-secondary btn-sm" style="margin-top:10px" onclick="MmaPage.load()">↻ Retry</button></div>`;
        }
        if (!d) return header + '<div class="kpi-grid">' + [1, 2, 3, 4].map(() => '<div class="skeleton" style="height:110px"></div>').join('') + '</div>';

        const s = d.summary;
        const tile = (icon, label, value, note, color, noteColor = 'var(--text-secondary)') => ReportsPage.tile(icon, label, value, note, noteColor, color);
        const change = s.opex_change_pct == null ? 'No costs posted last month' : `${s.opex_change_pct > 0 ? '↑' : '↓'} ${Math.abs(s.opex_change_pct)}% vs last month (${fmtTHB(s.opex_prev)})`;
        return header + `
      <div style="${this.loading ? 'opacity:0.55;pointer-events:none' : ''}">
        ${this.renderStatus(d)}
        <div class="kpi-grid">
          ${tile('💰', 'Operating costs', fmtTHB(s.opex), change, 'accent', s.opex_change_pct > 0 ? 'var(--red)' : 'var(--green)')}
          ${tile('🏗', 'Capex', fmtTHB(s.capex), `${fmtTHB(s.capex_ytd)} year to date`, 'cyan')}
          ${tile('🧾', 'Input VAT claimable', fmtTHB(s.input_vat), s.vat_not_claimable ? `${fmtTHB(s.vat_not_claimable)} not claimable` : 'All VAT claimable', 'green')}
          ${tile('🙋', 'Advances owed', fmtTHB(s.advances_outstanding), `${fmtTHB(s.advances_opened)} paid out · ${fmtTHB(s.advances_repaid)} repaid`, 'amber')}
          ${tile('🏦', 'Cash out (company)', fmtTHB(s.cash_out), `${s.entries} journal entries`, 'accent')}
        </div>
        <div style="font-size:0.8rem;color:var(--text-muted);margin:-12px 0 16px">Revenue is not captured in DocFlow yet, so this is a cost statement, not a full P&amp;L.</div>
        ${this.renderCommentary(d)}
        ${d.by_property ? this.renderByProperty(d) : ''}
        <div class="grid-2" style="margin-bottom:20px">
          ${this.card('Operating costs by account', 'This month vs last month and the same month last year', this.renderOpex(d))}
          ${this.card('Top vendors', 'Operating costs and capex, net of claimable VAT', this.renderVendors(d))}
        </div>
        <div class="grid-2" style="margin-bottom:20px">
          ${this.card('Capex', `${fmtTHB(s.capex)} this month · ${fmtTHB(s.capex_ytd)} year to date`, this.renderCapex(d))}
          ${this.card('Cash paid from company accounts', 'By week of the month', this.renderCash(d))}
        </div>
        <div class="grid-2" style="margin-bottom:20px">
          ${this.card('Advances owed at month end', 'Paid out of pocket and not yet repaid', this.renderAdvances(d))}
          ${this.card('VAT position', 'Claimable, reverse charge, and VAT kept in cost', this.renderVat(d))}
        </div>
      </div>`;
    },

    card(title, subtitle, body) {
        return `<div class="card"><div class="card-header"><div><div class="card-title">${title}</div><div class="card-subtitle">${subtitle}</div></div></div>${body}</div>`;
    },

    table(head, rows, empty = 'Nothing this month.') {
        if (!rows.length) return `<div style="padding:8px 0;font-size:0.82rem;color:var(--text-muted)">${empty}</div>`;
        return `<div style="overflow-x:auto"><table class="table" style="width:100%;font-size:0.82rem">
          <thead><tr>${head.map(([h, right]) => `<th style="text-align:${right ? 'right' : 'left'}">${h}</th>`).join('')}</tr></thead>
          <tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td style="text-align:${head[i][1] ? 'right' : 'left'}">${c}</td>`).join('')}</tr>`).join('')}</tbody>
        </table></div>`;
    },

    pct(v) { return v == null ? '—' : `<span style="color:${v > 0 ? 'var(--red)' : 'var(--green)'}">${v > 0 ? '+' : ''}${v}%</span>`; },

    renderStatus(d) {
        const closed = d.status === 'closed';
        const items = [...d.checklist.blockers.map(x => [x, 'var(--red)']), ...d.checklist.warnings.map(x => [x, 'var(--amber)'])];
        return `
        <div style="padding:10px 12px;border-radius:8px;margin-bottom:16px;background:${closed ? 'var(--green-soft)' : 'var(--amber-soft)'}">
          <strong>${closed ? '🔒 Final: month closed' : '⏳ Provisional: month not closed, figures may change'}</strong>
          ${closed && d.closed_by ? `<span style="font-size:0.8rem;color:var(--text-secondary)"> · by ${esc(d.closed_by)} on ${esc(fmtDate(d.closed_at))}</span>` : ''}
          ${!closed ? `<span class="no-print" style="font-size:0.8rem"> · close it in <a href="#" onclick="App.navigate('settings');return false">Settings → Chart of accounts</a></span>` : ''}
          ${!closed && items.length ? `<ul style="margin:6px 0 0 18px;font-size:0.82rem">${items.map(([x, c]) => `<li style="color:${c}">${esc(x.message)} · ${x.count}</li>`).join('')}</ul>` : ''}
        </div>`;
    },

    renderCommentary(d) {
        const c = d.commentary?.[this.language] || d.commentary?.en || d.commentary?.th;
        const canGen = d.commentary_available && this.canComment() && d.summary.entries > 0;
        const controls = canGen ? `
          <div class="no-print" style="display:flex;gap:8px;align-items:center">
            <select class="form-input" style="max-width:110px" onchange="MmaPage.language = this.value; MmaPage.refresh()" aria-label="Language">
              <option value="en" ${this.language === 'en' ? 'selected' : ''}>English</option>
              <option value="th" ${this.language === 'th' ? 'selected' : ''}>ภาษาไทย</option>
            </select>
            <button class="btn btn-primary btn-sm" id="mmaCommentBtn" onclick="MmaPage.generate()" ${this.generating ? 'disabled' : ''}>
              ${this.generating ? '⏳ Writing…' : c ? '↻ Rewrite' : '✨ Write commentary'}</button>
          </div>` : '';
        const list = (title, items) => items?.length ? `<div style="margin-top:8px"><strong style="font-size:0.85rem">${title}</strong><ul style="margin:4px 0 0 18px">${items.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '';
        const body = c ? `
            ${c.stale ? '<div style="font-size:0.8rem;color:var(--amber);margin-bottom:6px">⚠️ Figures have changed since this was written. Rewrite it.</div>' : ''}
            ${c.headline ? `<div style="font-weight:600;margin-bottom:4px">${esc(c.headline)}</div>` : ''}
            ${list('Highlights', c.highlights)}${list('Risks', c.risks)}${list('Actions', c.actions)}
            <div style="font-size:0.75rem;color:var(--text-muted);margin-top:8px">Written by Claude from this pack's figures only${c.removed?.length ? ` · ${c.removed.length} sentence${c.removed.length === 1 ? '' : 's'} removed because their figures weren't in the pack` : ''}.</div>`
            : `<div style="font-size:0.85rem;color:var(--text-muted)">${!d.commentary_available ? 'Claude is not configured on the server (ANTHROPIC_API_KEY).'
                : !d.summary.entries ? 'No posted receipts this month.' : !this.canComment() ? 'An owner or admin can ask Claude to write the commentary.' : 'No commentary yet.'}</div>`;
        return `
        <div class="card" style="margin-bottom:20px">
          <div class="card-header" style="flex-wrap:wrap;gap:10px">
            <div><div class="card-title">✨ Owner commentary</div><div class="card-subtitle">What moved, what to watch, what to do</div></div>
            ${controls}
          </div>
          ${body}
        </div>`;
    },

    renderByProperty(d) {
        return `<div class="card" style="margin-bottom:20px"><div class="card-header"><div><div class="card-title">By property</div></div></div>
          ${this.table([['Property'], ['Status'], ['Operating costs', 1], ['Capex', 1], ['Input VAT', 1], ['Advances owed', 1], ['Cash out', 1]],
            d.by_property.map(x => [esc(x.name), x.status === 'closed' ? '🔒 closed' : '⏳ provisional', fmtTHB(x.opex), fmtTHB(x.capex), fmtTHB(x.input_vat), fmtTHB(x.advances_outstanding), fmtTHB(x.cash_out)]))}
        </div>`;
    },

    renderOpex(d) {
        return this.table([['Account'], ['This month', 1], ['Last month', 1], ['Change', 1], ['Last year', 1]],
            d.opex.map(o => [`${esc(o.code)} ${esc(o.name)}`, fmtTHB(o.amount), fmtTHB(o.prev), this.pct(o.change_pct), o.ly ? fmtTHB(o.ly) : '—']),
            'No operating costs posted.');
    },

    renderVendors(d) {
        return this.table([['Vendor'], ['Receipts', 1], ['Amount', 1]], d.top_vendors.map(v => [esc(v.vendor), v.count, fmtTHB(v.amount)]));
    },

    renderCapex(d) {
        const multi = !!d.by_property;
        return this.table([['Date'], ['Vendor'], ['Account'], ...(multi ? [['Property']] : []), ['Amount', 1]],
            d.capex.items.map(x => [esc(fmtDate(x.date)), esc(x.vendor), `${esc(x.code)} ${esc(x.name)}`, ...(multi ? [esc(x.property || '')] : []), fmtTHB(x.amount)]),
            'No capex this month.');
    },

    renderCash(d) {
        return this.table([['Days'], ['Operating', 1], ['Capex', 1], ['Advances repaid', 1], ['Total', 1]],
            d.cash.weeks.map(w => [esc(w.week), fmtTHB(w.opex), fmtTHB(w.capex), fmtTHB(w.reimbursements), `<strong>${fmtTHB(w.total)}</strong>`]));
    },

    renderAdvances(d) {
        const multi = !!d.by_property;
        return this.table([['Paid by'], ...(multi ? [['Property']] : []), ['Receipts', 1], ['Owed', 1], ['Since', 1]],
            d.advances.outstanding.map(x => [esc(x.paid_by), ...(multi ? [esc(x.property || '')] : []), x.count, fmtTHB(x.total), esc(x.oldest_month)]),
            'Nothing owed.');
    },

    renderVat(d) {
        const s = d.summary;
        return this.table([['Item'], ['Receipts', 1], ['Amount', 1]], [
            ['Input VAT claimable', '', fmtTHB(s.input_vat)],
            ['ภ.พ.36 on foreign services (claimable next month)', '', fmtTHB(s.pp36_vat)],
            ...d.vat.not_claimable.map(x => [`Not claimable: ${esc(this.REASONS[x.reason] || x.reason)}`, x.count, fmtTHB(x.vat)]),
        ]);
    },

    async generate() {
        this.generating = true;
        this.refresh();
        try {
            const c = await AccountingApi.mmaCommentary(this.orgParam(), this.month, this.language);
            this.data.commentary = { ...(this.data.commentary || {}), [this.language]: c };
            App.showToast('success', '✨ Commentary written');
        } catch (error) {
            App.showToast('error', error.message);
        }
        this.generating = false;
        this.refresh();
    },

    async exportXlsx() {
        const btn = document.getElementById('mmaXlsxBtn');
        if (btn) { btn.disabled = true; btn.textContent = '⏳ Preparing...'; }
        try {
            await ReportApi.download(`/accounting/mma.xlsx?${new URLSearchParams({ organization_id: this.orgParam(), month: this.month })}`, `management-accounts-${this.month}.xlsx`);
        } catch (error) {
            App.showToast('error', error.message);
        }
        if (btn) { btn.disabled = false; btn.textContent = '⬇ Excel'; }
    },
};
