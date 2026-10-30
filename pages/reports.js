// Reports Page — server-side totals by month, category and property (see backend/src/routes/reports.ts)
window.ReportsPage = {
    scope: 'property',      // 'property' (current) | 'all' (every property the user belongs to)
    period: '6m',
    data: null,             // summary for the selected period
    prev: null,             // summary for the period just before it, for the change figure
    loading: false,
    error: null,
    vatMonth: null,
    requestId: 0,

    PERIODS: [
        ['1m', 'This month'], ['3m', 'Last 3 months'], ['6m', 'Last 6 months'],
        ['12m', 'Last 12 months'], ['ytd', 'This year'], ['ly', 'Last year'],
    ],

    range(period = this.period) {
        const now = thisMonth();
        const year = +now.slice(0, 4);
        switch (period) {
            case '1m': return { from: now, to: now };
            case '3m': return { from: monthAdd(now, -2), to: now };
            case '12m': return { from: monthAdd(now, -11), to: now };
            case 'ytd': return { from: `${year}-01`, to: now };
            case 'ly': return { from: `${year - 1}-01`, to: `${year - 1}-12` };
            default: return { from: monthAdd(now, -5), to: now };
        }
    },

    months({ from, to }) {
        const out = [];
        for (let m = from; m <= to; m = monthAdd(m, 1)) out.push(m);
        return out;
    },

    orgParam() {
        return this.scope === 'all' ? 'all' : App.currentCompany;
    },

    render(companyId) {
        const key = `${this.orgParam()}|${this.period}`;
        if (this.loadedKey !== key || companyId !== this.lastCompanyId) {
            this.lastCompanyId = companyId;
            this.load();
        }
        return `<div id="reportsRoot">${this.renderBody()}</div>`;
    },

    refresh() {
        const root = document.getElementById('reportsRoot');
        if (root) root.innerHTML = this.renderBody();
    },

    async load() {
        const id = ++this.requestId;
        const { from, to } = this.range();
        const span = this.months({ from, to }).length;
        this.loading = true;
        this.error = null;
        this.refresh();
        try {
            const [data, prev] = await Promise.all([
                ReportApi.summary(this.orgParam(), from, to),
                ReportApi.summary(this.orgParam(), monthAdd(from, -span), monthAdd(from, -1)),
            ]);
            if (id !== this.requestId) return;
            this.data = data;
            this.prev = prev;
            this.loadedKey = `${this.orgParam()}|${this.period}`;
            if (!this.vatMonth || this.vatMonth < from || this.vatMonth > to) this.vatMonth = to;
        } catch (error) {
            if (id !== this.requestId) return;
            this.error = error.message;
        } finally {
            if (id === this.requestId) {
                this.loading = false;
                this.refresh();
            }
        }
    },

    setScope(scope) { this.scope = scope; this.load(); },
    setPeriod(period) { this.period = period; this.load(); },

    // ─── Derived figures ───

    stats() {
        const d = this.data;
        const sum = (list, k) => list.reduce((t, x) => t + (x[k] || 0), 0);
        const spend = sum(d.by_month, 'spend');
        const prevSpend = this.prev ? sum(this.prev.by_month, 'spend') : 0;
        const status = k => d.status_counts.filter(x => x.status === k).reduce((t, x) => t + x.count, 0);
        const gap = r => (d.vat_not_claimable.find(x => x.reason === r) || { vat: 0, count: 0 });
        return {
            spend,
            prevSpend,
            change: prevSpend > 0 ? ((spend - prevSpend) / prevSpend) * 100 : null,
            perMonth: spend / d.range.months,
            records: sum(d.by_month, 'count'),
            vat: sum(d.by_month, 'vat_claimable'),
            missingTaxId: gap('missing_tax_id'),
            notReviewed: gap('not_reviewed'),
            drafts: status('draft'),
            awaiting: status('confirmed'),
        };
    },

    // Spend per month, per property: { 'YYYY-MM': { orgId: spend } }
    grid() {
        const g = {};
        this.data.by_month.forEach(x => { (g[x.month] = g[x.month] || {})[x.organization_id] = x.spend; });
        return g;
    },

    // ─── Rendering ───

    renderBody() {
        const multi = this.scope === 'all';
        const org = (App.organizations || []).find(o => (o._id || o.id) === App.currentCompany);
        const { from, to } = this.range();
        const periodLabel = from === to ? fmtMonth(from, { month: 'long', year: 'numeric' }) : `${fmtMonth(from)} – ${fmtMonth(to)}`;

        const filters = `
      <div class="report-filters no-print">
        <div class="filter-chips" role="radiogroup" aria-label="Properties">
          <button class="filter-chip ${!multi ? 'active' : ''}" role="radio" aria-checked="${!multi}" onclick="ReportsPage.setScope('property')">
            <span class="company-dot" style="display:inline-block;width:8px;height:8px;margin-right:6px;background:${org ? orgColor(org) : 'var(--accent)'}"></span>${esc(org ? org.organization_name : 'This property')}
          </button>
          <button class="filter-chip ${multi ? 'active' : ''}" role="radio" aria-checked="${multi}" onclick="ReportsPage.setScope('all')">All properties</button>
        </div>
        <div class="filter-chips" role="radiogroup" aria-label="Period">
          ${this.PERIODS.map(([k, label]) => `<button class="filter-chip ${this.period === k ? 'active' : ''}" role="radio" aria-checked="${this.period === k}" onclick="ReportsPage.setPeriod('${k}')">${label}</button>`).join('')}
        </div>
      </div>`;

        const header = `
      <div class="page-header">
        <div class="page-header-left">
          <h1>📈 Reports</h1>
          <p>${multi ? 'All your properties' : esc(org ? org.organization_name : '')} · ${periodLabel}</p>
        </div>
        <div style="display:flex;gap:10px" class="no-print">
          <button class="btn btn-secondary btn-sm" onclick="window.print()" ${this.data ? '' : 'disabled'}>🖨 Print / PDF</button>
          <button class="btn btn-secondary btn-sm" onclick="ReportsPage.exportSummary()" ${this.data ? '' : 'disabled'}>⬇ Summary CSV</button>
        </div>
      </div>`;

        if (this.error) {
            return header + filters + `
      <div class="card" style="border-color:var(--red);background:var(--red-soft)">
        <div style="display:flex;align-items:center;gap:12px">
          <div style="flex:1"><div style="font-weight:700;color:var(--red)">⚠️ Couldn't load the report</div>
          <div style="font-size:0.8rem;color:var(--text-secondary);margin-top:4px">${esc(this.error)}</div></div>
          <button class="btn btn-secondary btn-sm" onclick="ReportsPage.load()">↻ Retry</button>
        </div>
      </div>`;
        }
        if (!this.data) {
            return header + filters + `
      <div class="kpi-grid">${[1, 2, 3, 4].map(() => '<div class="kpi-card"><div class="skeleton" style="height:90px"></div></div>').join('')}</div>
      <div class="card"><div class="skeleton" style="height:260px"></div></div>`;
        }

        const s = this.stats();
        let changeNote = 'No spend in the previous period';
        let changeColor = 'var(--text-muted)';
        if (s.change !== null) {
            const up = s.change >= 0;
            changeNote = `${up ? '↑' : '↓'} ${Math.abs(s.change).toFixed(0)}% vs previous ${this.data.range.months === 1 ? 'month' : `${this.data.range.months} months`}`;
            changeColor = up ? 'var(--red)' : 'var(--green)';
        }
        const gapVat = s.missingTaxId.vat + s.notReviewed.vat;

        return header + filters + `
      <div style="${this.loading ? 'opacity:0.55;pointer-events:none;transition:opacity .15s' : ''}">
        <div class="kpi-grid">
          ${this.tile('💰', 'Spend', fmtTHB(s.spend), changeNote, changeColor, 'accent')}
          ${this.tile('📅', 'Average per month', fmtTHB(s.perMonth), `${s.records} record${s.records === 1 ? '' : 's'} in ${this.data.range.months} month${this.data.range.months === 1 ? '' : 's'}`, 'var(--text-muted)', 'cyan')}
          ${this.tile('🧾', 'Claimable input VAT', fmtTHB(s.vat), gapVat ? `${fmtTHB(gapVat)} more on receipts that can't be claimed yet` : 'Every VAT amount is claimable', gapVat ? 'var(--amber)' : 'var(--green)', 'green')}
          ${this.tile('⏳', 'Needs attention', s.drafts + s.awaiting, `${s.drafts} draft${s.drafts === 1 ? '' : 's'} · ${s.awaiting} awaiting approval`, s.drafts + s.awaiting ? 'var(--amber)' : 'var(--text-muted)', 'amber')}
        </div>

        <div class="card" style="margin-bottom:20px">
          <div class="card-header">
            <div>
              <div class="card-title">Spend by month</div>
              <div class="card-subtitle">${multi ? 'Stacked by property' : 'All non-disabled records, by receipt date'}</div>
            </div>
          </div>
          ${this.renderMonthly()}
        </div>

        <div class="grid-2" style="margin-bottom:20px">
          <div class="card">
            <div class="card-header"><div>
              <div class="card-title">Spend by category</div>
              <div class="card-subtitle">${periodLabel}</div>
            </div></div>
            ${this.renderCategories()}
          </div>
          <div class="card">
            <div class="card-header"><div>
              <div class="card-title">Input VAT</div>
              <div class="card-subtitle">What your accountant can file, and what is holding the rest back</div>
            </div></div>
            ${this.renderVat(s)}
          </div>
        </div>

        ${multi ? this.renderComparison() : ''}
      </div>`;
    },

    tile(icon, label, value, note, noteColor, color) {
        return `
        <div class="kpi-card" style="--kpi-color:var(--${color});--kpi-bg:var(--${color}-soft)">
          <div class="kpi-icon">${icon}</div>
          <div class="kpi-label">${label}</div>
          <div class="kpi-value" style="font-size:1.5rem">${value}</div>
          <div class="kpi-change" style="color:${noteColor}">${note}</div>
        </div>`;
    },

    // Column chart in HTML: one column per month, stacked by property when showing all properties.
    renderMonthly() {
        const d = this.data;
        const months = this.months(d.range);
        const grid = this.grid();
        const orgs = d.organizations;
        const totals = months.map(m => orgs.reduce((t, o) => t + ((grid[m] || {})[o.id] || 0), 0));
        const max = Math.max(...totals, 0);
        if (max === 0) return '<div class="empty-state" style="padding:32px"><p>No spend recorded in this period.</p></div>';

        const { step, top } = niceScale(max);
        const ticks = [];
        for (let v = 0; v <= top + 1e-6; v += step) ticks.push(v);
        const multi = this.scope === 'all';
        const peak = totals.indexOf(max);
        const last = totals.length - 1;

        const cols = months.map((m, i) => {
            // Bottom-up stack; flex weights keep the 2px surface gaps exact between segments
            const segs = orgs
                .map(o => ({ o, v: (grid[m] || {})[o.id] || 0 }))
                .filter(x => x.v > 0)
                .reverse()
                .map(x => `<span class="col-seg" style="flex:${x.v};background:${orgColor(x.o)}"></span>`)
                .join('');
            // Label selectively: the peak month and the latest month
            const label = (i === peak || i === last) && totals[i] > 0
                ? `<span class="col-value">${compactTHB(totals[i])}</span>` : '';
            const xLabel = fmtMonth(m, { month: 'short' }) + (i === 0 || m.endsWith('-01') ? ` ${m.slice(2, 4)}` : '');
            return `
            <button class="col" style="--h:${totals[i] / top}" aria-label="${fmtMonth(m, { month: 'long', year: 'numeric' })}: ${fmtTHB(totals[i])}"
              onpointerenter="ReportsPage.showTip(event, '${m}')" onfocus="ReportsPage.showTip(event, '${m}')"
              onpointerleave="ReportsPage.hideTip()" onblur="ReportsPage.hideTip()">
              ${label}<span class="col-stack">${segs}</span><span class="col-x">${xLabel}</span>
            </button>`;
        }).join('');

        const legend = multi && orgs.length > 1 ? `
          <div class="chart-legend">
            ${orgs.map(o => `<span><i style="background:${orgColor(o)}"></i>${esc(o.organization_name)}</span>`).join('')}
          </div>` : '';

        const tableHead = `<tr><th>Month</th>${multi ? orgs.map(o => `<th style="text-align:right">${esc(o.organization_name)}</th>`).join('') : ''}<th style="text-align:right">Total</th></tr>`;
        const tableRows = months.map((m, i) => `<tr><td>${fmtMonth(m, { month: 'long', year: 'numeric' })}</td>${multi ? orgs.map(o => `<td style="text-align:right">${fmtTHB((grid[m] || {})[o.id] || 0)}</td>`).join('') : ''}<td style="text-align:right;font-weight:700">${fmtTHB(totals[i])}</td></tr>`).join('');

        return `
          ${legend}
          <div class="col-chart">
            <div class="col-grid">${ticks.slice().reverse().map(v => `<div><span>${compactTHB(v)}</span></div>`).join('')}</div>
            <div class="col-plot" style="--cols:${months.length}">${cols}</div>
            <div class="chart-tip" id="reportTip" role="tooltip" hidden></div>
          </div>
          <details class="table-view">
            <summary>Show as table</summary>
            <div class="table-scroll"><table class="data-table"><thead>${tableHead}</thead><tbody>${tableRows}</tbody></table></div>
          </details>`;
    },

    showTip(e, month) {
        const tip = document.getElementById('reportTip');
        const col = e.currentTarget;
        if (!tip || !col) return;
        const row = this.grid()[month] || {};
        const orgs = this.data.organizations;
        const total = orgs.reduce((t, o) => t + (row[o.id] || 0), 0);
        const count = this.data.by_month.filter(x => x.month === month).reduce((t, x) => t + x.count, 0);

        // Built with textContent: property names are user data
        tip.replaceChildren();
        const head = document.createElement('div');
        head.className = 'chart-tip-head';
        head.textContent = `${fmtMonth(month, { month: 'long', year: 'numeric' })} · ${count} record${count === 1 ? '' : 's'}`;
        tip.append(head);
        const line = (color, value, name) => {
            const r = document.createElement('div');
            r.className = 'chart-tip-row';
            if (color) { const k = document.createElement('i'); k.style.background = color; r.append(k); }
            const v = document.createElement('strong'); v.textContent = value; r.append(v);
            if (name) { const n = document.createElement('span'); n.textContent = name; r.append(n); }
            tip.append(r);
        };
        if (this.scope === 'all' && orgs.length > 1) {
            orgs.forEach(o => line(orgColor(o), fmtTHB(row[o.id] || 0), o.organization_name));
            line(null, fmtTHB(total), 'Total');
        } else {
            line(null, fmtTHB(total), 'Spend');
        }

        // Beside the column, never over it: right of it when there is room, otherwise left
        tip.hidden = false;
        const box = col.closest('.col-chart').getBoundingClientRect();
        const c = col.getBoundingClientRect();
        const right = c.right - box.left + 8;
        tip.style.left = `${right + tip.offsetWidth <= box.width ? right : Math.max(c.left - box.left - tip.offsetWidth - 8, 0)}px`;
        tip.style.top = '8px';
    },

    hideTip() {
        const tip = document.getElementById('reportTip');
        if (tip) tip.hidden = true;
    },

    renderCategories() {
        const totals = {};
        this.data.by_category.forEach(x => { totals[x.category] = (totals[x.category] || 0) + x.spend; });
        let rows = Object.entries(totals).sort((a, b) => b[1] - a[1]);
        if (!rows.length) return '<div style="padding:12px 0;font-size:0.82rem;color:var(--text-muted)">No spend recorded in this period.</div>';
        if (rows.length > 8) {
            const other = rows.slice(7).reduce((t, r) => t + r[1], 0);
            rows = [...rows.slice(0, 7), [`Other (${rows.length - 7} categories)`, other]];
        }
        const all = rows.reduce((t, r) => t + r[1], 0);
        const max = rows[0][1];
        return rows.map(([cat, amt]) => `
          <div class="hbar">
            <div class="hbar-label"><span>${esc(cat)}</span><span><strong>${fmtTHB(amt)}</strong> <em>${all ? Math.round((amt / all) * 100) : 0}%</em></span></div>
            <div class="hbar-track"><div class="hbar-fill" style="width:${(amt / max) * 100}%"></div></div>
          </div>`).join('');
    },

    renderVat(s) {
        const multi = this.scope === 'all';
        const months = this.months(this.data.range);
        const row = (label, value, note, color) => `
          <div class="settings-row"><span>${label}${note ? ` <span style="color:var(--text-muted);font-size:0.75rem">${note}</span>` : ''}</span>
          <strong style="${color ? `color:${color}` : ''}">${value}</strong></div>`;
        return `
          <div class="settings-rows">
            ${row('Claimable', fmtTHB(s.vat), 'confirmed or approved, with seller tax ID')}
            ${row('Missing seller tax ID', fmtTHB(s.missingTaxId.vat), `${s.missingTaxId.count} record${s.missingTaxId.count === 1 ? '' : 's'}`, s.missingTaxId.vat ? 'var(--amber)' : '')}
            ${row('Still in draft', fmtTHB(s.notReviewed.vat), `${s.notReviewed.count} record${s.notReviewed.count === 1 ? '' : 's'}`, s.notReviewed.vat ? 'var(--amber)' : '')}
          </div>
          <div class="no-print" style="margin-top:16px;padding-top:14px;border-top:1px solid var(--border)">
            <div style="font-size:0.8rem;font-weight:600;margin-bottom:8px">Input VAT report for your accountant</div>
            ${multi ? '<div style="font-size:0.78rem;color:var(--text-muted)">VAT is filed per property: switch to a single property to download its report.</div>' : `
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <select class="form-input" style="width:auto" aria-label="VAT month" onchange="ReportsPage.vatMonth = this.value">
                ${months.slice().reverse().map(m => `<option value="${m}" ${m === this.vatMonth ? 'selected' : ''}>${fmtMonth(m, { month: 'long', year: 'numeric' })}</option>`).join('')}
              </select>
              <button class="btn btn-primary btn-sm" id="vatExportBtn" onclick="ReportsPage.exportVat()">⬇ Download CSV</button>
            </div>
            <div style="font-size:0.72rem;color:var(--text-muted);margin-top:6px">Every receipt with VAT that month, by date, marked claimable or not.</div>`}
          </div>`;
    },

    renderComparison() {
        const d = this.data;
        const grid = this.grid();
        const months = this.months(d.range);
        const by = id => months.reduce((t, m) => t + ((grid[m] || {})[id] || 0), 0);
        const vat = id => d.by_month.filter(x => x.organization_id === id).reduce((t, x) => t + x.vat_claimable, 0);
        const count = (id, st) => (d.status_counts.find(x => x.organization_id === id && x.status === st) || { count: 0 }).count;
        const total = d.organizations.reduce((t, o) => t + by(o.id), 0);
        const rows = d.organizations.map(o => ({ o, spend: by(o.id) })).sort((a, b) => b.spend - a.spend);
        return `
        <div class="card">
          <div class="card-header"><div>
            <div class="card-title">Property comparison</div>
            <div class="card-subtitle">Share of total spend for the period, and each property's work queue today</div>
          </div></div>
          <div class="table-scroll"><table class="data-table">
            <thead><tr><th>Property</th><th style="text-align:right">Spend</th><th style="text-align:right">Share</th><th style="text-align:right">Per month</th><th style="text-align:right">Claimable VAT</th><th style="text-align:right">Drafts</th><th style="text-align:right">Awaiting approval</th></tr></thead>
            <tbody>
              ${rows.map(({ o, spend }) => `<tr>
                <td><span style="display:inline-flex;align-items:center;gap:8px"><i class="legend-key" style="background:${orgColor(o)}"></i>${esc(o.organization_name)}</span></td>
                <td style="text-align:right;font-weight:700">${fmtTHB(spend)}</td>
                <td style="text-align:right">${total ? Math.round((spend / total) * 100) : 0}%</td>
                <td style="text-align:right">${fmtTHB(spend / d.range.months)}</td>
                <td style="text-align:right">${fmtTHB(vat(o.id))}</td>
                <td style="text-align:right">${count(o.id, 'draft') || '—'}</td>
                <td style="text-align:right">${count(o.id, 'confirmed') || '—'}</td>
              </tr>`).join('')}
            </tbody>
            <tfoot><tr style="border-top:2px solid var(--border)">
              <td style="font-weight:700">Total</td><td style="text-align:right;font-weight:800">${fmtTHB(total)}</td><td></td>
              <td style="text-align:right">${fmtTHB(total / d.range.months)}</td><td colspan="3"></td>
            </tr></tfoot>
          </table></div>
        </div>`;
    },

    // ─── Exports ───

    exportSummary() {
        const d = this.data;
        const names = Object.fromEntries(d.organizations.map(o => [o.id, o.organization_name]));
        // Long format (one row per property and month) so it pivots cleanly in Excel
        const rows = [['Month', 'Property', 'Spend', 'Claimable VAT', 'Records'].map(h => csvCell(h))];
        d.by_month.forEach(x => rows.push([
            csvCell(x.month), csvCell(names[x.organization_id]), csvCell(x.spend, { numeric: true }),
            csvCell(x.vat_claimable, { numeric: true }), csvCell(x.count, { numeric: true }),
        ]));
        rows.push([]);
        rows.push(['Category', 'Property', 'Spend', 'Records'].map(h => csvCell(h)));
        d.by_category.forEach(x => rows.push([
            csvCell(x.category), csvCell(names[x.organization_id]), csvCell(x.spend, { numeric: true }), csvCell(x.count, { numeric: true }),
        ]));
        const who = this.scope === 'all' ? 'all-properties' : names[App.currentCompany] || 'property';
        downloadCsv(`${who}_summary_${d.range.from}_to_${d.range.to}.csv`, rows);
    },

    async exportVat() {
        const month = this.vatMonth;
        const org = (App.organizations || []).find(o => (o._id || o.id) === App.currentCompany);
        const btn = document.getElementById('vatExportBtn');
        if (btn) { btn.disabled = true; btn.textContent = '⏳ Preparing...'; }
        try {
            const list = await ReportApi.vat(App.currentCompany, month);
            const dmy = v => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v || ''); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };
            const rows = [[
                'No. / ลำดับ', 'Date / วันที่', 'Invoice no. / เลขที่ใบกำกับภาษี', 'Seller / ชื่อผู้ขาย',
                'Seller tax ID / เลขประจำตัวผู้เสียภาษี', 'Value before VAT / มูลค่าสินค้าหรือบริการ', 'VAT / ภาษีมูลค่าเพิ่ม',
                'Total / รวม', 'Filing status',
            ].map(h => csvCell(h))];
            let n = 0, base = 0, vat = 0;
            list.forEach(x => {
                const status = x.claimable ? 'Claimable' : x.status === 'draft' ? 'Not reviewed (draft)' : 'Missing seller tax ID';
                if (x.claimable) { n++; base += x.subtotal; vat += x.tax_amount; }
                rows.push([
                    csvCell(x.claimable ? n : '', { numeric: true }), csvCell(dmy(x.date)), csvCell(x.invoice_number), csvCell(x.vendor_name),
                    csvCell(x.vendor_taxid, { taxId: true }), csvCell(x.subtotal, { numeric: true }), csvCell(x.tax_amount, { numeric: true }),
                    csvCell(x.total, { numeric: true }), csvCell(status),
                ]);
            });
            rows.push([]);
            rows.push(['', '', '', csvCell('Total claimable / รวมที่ขอคืนได้'), '', csvCell(base.toFixed(2), { numeric: true }), csvCell(vat.toFixed(2), { numeric: true }), '', '']);
            downloadCsv(`${org ? org.organization_name : 'property'}_input-VAT_${month}.csv`, rows);
            App.showToast('success', `⬇ ${n} claimable tax invoice${n === 1 ? '' : 's'} for ${fmtMonth(month, { month: 'long', year: 'numeric' })}`);
        } catch (error) {
            App.showToast('error', '❌ ' + error.message, 4000);
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = '⬇ Download CSV'; }
        }
    },
};

// Axis scale with round steps: 0 / 5K / 10K / 15K ...
function niceScale(max, ticks = 4) {
    const raw = max / ticks;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map(f => f * mag).find(s => s >= raw) || 10 * mag;
    return { step, top: Math.ceil(max / step) * step };
}

function compactTHB(v) {
    if (v >= 1e6) return `฿${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1).replace(/\.0$/, '')}M`;
    if (v >= 1e4) return `฿${Math.round(v / 1e3)}K`;
    if (v >= 1e3) return `฿${(v / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
    return `฿${Math.round(v)}`;
}
