window.DashboardPage = {
    loading: false,
    error: null,
    expenses: [],
    lastCompanyId: null,

    async loadData(companyId) {
        this.loading = true;
        this.error = null;
        const now = thisMonth();
        try {
            // Totals come from the server (same definitions as Reports); only the two short lists are rows
            const [current, previous, activity, recent] = await Promise.all([
                ReportApi.summary(companyId, now, now),
                ReportApi.summary(companyId, monthAdd(now, -1), monthAdd(now, -1)),
                ExpenseApi.listExpenses(companyId, { limit: 5, sort: 'updated' }),
                ExpenseApi.listExpenses(companyId, { limit: 8 }),
            ]);
            this.summary = { current, previous };
            this.activity = activity.filter(e => e.status !== 'disabled');
            this.recent = recent.filter(e => e.status !== 'disabled').slice(0, 6);
            App.setDraftCountFromSummary(current);
        } catch (error) {
            console.error('Dashboard load failed:', error);
            this.summary = null;
            this.error = error.message || 'Could not load expenses';
        } finally {
            this.loading = false;
            const content = document.getElementById('mainContent');
            if (content && App.currentPage === 'dashboard') {
                content.innerHTML = this.render(companyId, true);
            }
        }
    },

    retry() {
        this.lastCompanyId = null;
        App.navigate('dashboard');
    },

    stats() {
        const { current, previous } = this.summary || { current: null, previous: null };
        const sum = (list, k) => (list || []).reduce((t, x) => t + (x[k] || 0), 0);
        const spend = sum(current?.by_month, 'spend');
        const lastSpend = sum(previous?.by_month, 'spend');
        const status = k => (current?.status_counts || []).filter(x => x.status === k).reduce((t, x) => t + x.count, 0);
        const missing = (current?.vat_not_claimable || []).find(x => x.reason === 'missing_tax_id') || { count: 0 };
        return {
            spend,
            lastSpend,
            change: lastSpend > 0 ? ((spend - lastSpend) / lastSpend) * 100 : null,
            thisMonthCount: sum(current?.by_month, 'count'),
            drafts: status('draft'),
            awaitingApproval: status('confirmed'),
            vat: sum(current?.by_month, 'vat_claimable'),
            vatCount: sum(current?.by_month, 'vat_claimable_count'),
            vatMissingTaxId: missing.count,
            categories: (current?.by_category || []).map(x => [x.category, x.spend]),
            activity: this.activity || [],
            recent: this.recent || [],
        };
    },

    renderSkeleton() {
        const block = (h, w = '100%', mb = 0) => `<div class="skeleton" style="height:${h}px;width:${w};margin-bottom:${mb}px"></div>`;
        return `
      <div class="page-header" aria-busy="true" aria-label="Loading dashboard">
        <div class="page-header-left">${block(28, '220px', 8)}${block(14, '260px')}</div>
      </div>
      <div class="kpi-grid">
        ${[1, 2, 3, 4].map(() => `<div class="kpi-card">${block(40, '40px', 14)}${block(12, '60%', 10)}${block(28, '70%', 10)}${block(12, '50%')}</div>`).join('')}
      </div>
      <div class="grid-2-1">
        <div class="card">${[1, 2, 3, 4].map(() => block(44, '100%', 12)).join('')}</div>
        <div class="card">${[1, 2, 3].map(() => block(28, '100%', 14)).join('')}</div>
      </div>`;
    },

    kpi({ color, icon, label, value, note, noteStyle = '', status }) {
        return `
        <button class="kpi-card kpi-card-link" style="--kpi-color:var(--${color});--kpi-bg:var(--${color}-soft)"
          onclick="Pages.receiptsFiltered('${status}')" title="Show these receipts">
          <div class="kpi-icon">${icon}</div>
          <div class="kpi-label">${label}</div>
          <div class="kpi-value">${value}</div>
          <div class="kpi-change" style="${noteStyle}">${note}</div>
        </button>`;
    },

    render(companyId, isLoaded = false) {
        if (!isLoaded || this.lastCompanyId !== companyId) {
            this.lastCompanyId = companyId;
            this.loadData(companyId);
        }

        if (this.loading && !isLoaded) return this.renderSkeleton();

        const s = this.stats();
        const org = (App.organizations || []).find(o => (o._id || o.id) === companyId);
        const monthName = new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
        const isApprover = !!org && ['owner', 'admin'].includes(org.role);

        return `
      <div class="page-header">
        <div class="page-header-left">
          <h1 style="display:flex;align-items:center;gap:10px">
            <span class="company-dot" style="width:12px;height:12px;background:${org ? orgColor(org) : 'var(--accent)'}"></span>
            ${esc(org ? org.organization_name : 'Dashboard')}
          </h1>
          <p>${monthName} · what needs your attention</p>
        </div>
        <button class="btn btn-primary btn-sm" onclick="Pages.receipts()">📤 Upload Receipt</button>
      </div>

      ${this.error ? `
      <div class="card" style="margin-bottom:20px;border-color:var(--red);background:var(--red-soft)">
        <div style="display:flex;align-items:center;gap:12px">
          <div style="flex:1">
            <div style="font-weight:700;color:var(--red)">⚠️ Couldn't load expenses</div>
            <div style="font-size:0.8rem;color:var(--text-secondary);margin-top:4px">${esc(this.error)}. No figures are shown until the data loads.</div>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="DashboardPage.retry()">↻ Retry</button>
        </div>
      </div>` : this.renderBody(s, monthName, isApprover)}
    `;
    },

    renderBody(s, monthName, isApprover) {
        let changeNote = 'No spend recorded last month';
        let changeStyle = 'color:var(--text-muted)';
        if (s.change !== null) {
            const up = s.change >= 0;
            changeNote = `${up ? '↑' : '↓'} ${Math.abs(s.change).toFixed(0)}% vs last month (${fmtTHB(s.lastSpend)})`;
            changeStyle = `color:var(--${up ? 'red' : 'green'})`;
        }

        const vatNote = s.vatMissingTaxId
            ? `${s.vatCount} tax invoice${s.vatCount === 1 ? '' : 's'} · ${s.vatMissingTaxId} missing tax ID`
            : `${s.vatCount} tax invoice${s.vatCount === 1 ? '' : 's'}`;

        const recentActivity = s.activity;

        const activityLabel = {
            draft: { icon: '📝', verb: 'Draft saved' },
            confirmed: { icon: '✅', verb: 'Confirmed' },
            approved: { icon: '✔️', verb: 'Approved' },
        };

        const maxCat = s.categories.length ? s.categories[0][1] : 0;

        return `

      <div class="kpi-grid">
        ${this.kpi({
            color: 'accent', icon: '💰', label: `Spend in ${monthName}`, value: fmtTHB(s.spend),
            note: changeNote, noteStyle: changeStyle, status: 'all',
        })}
        ${this.kpi({
            color: 'amber', icon: '📝', label: 'Drafts to review', value: s.drafts,
            note: s.drafts ? 'Check OCR fields and confirm' : 'Nothing waiting',
            noteStyle: s.drafts ? 'color:var(--amber)' : 'color:var(--text-muted)', status: 'draft',
        })}
        ${this.kpi({
            color: 'cyan', icon: '⏳', label: 'Awaiting approval', value: s.awaitingApproval,
            note: s.awaitingApproval ? (isApprover ? 'Ready for you to approve' : 'Waiting for an owner/admin') : 'All approved',
            noteStyle: s.awaitingApproval ? 'color:var(--cyan)' : 'color:var(--text-muted)', status: 'confirmed',
        })}
        ${this.kpi({
            color: 'green', icon: '🧾', label: 'Input VAT this month', value: fmtTHB(s.vat),
            note: vatNote, noteStyle: s.vatMissingTaxId ? 'color:var(--amber)' : 'color:var(--green)', status: 'all',
        })}
      </div>

      <div class="grid-2-1">
        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title">📋 Recent Activity</div>
              <div class="card-subtitle">Latest changes to expenses</div>
            </div>
          </div>
          ${recentActivity.length === 0 ? `
            <div class="empty-state">
              <div class="empty-state-icon">📤</div>
              <p>No receipts yet. Upload your first one to get started.</p>
              <button class="btn btn-primary btn-sm" style="margin-top:14px" onclick="Pages.receipts()">📤 Upload Receipt</button>
            </div>` :
            recentActivity.map(e => {
                const a = activityLabel[e.status] || { icon: '•', verb: 'Updated' };
                return `
            <div class="activity-item">
              <div class="activity-icon-wrap">${a.icon}</div>
              <div style="flex:1">
                <div class="activity-text">${a.verb}: ${esc(e.vendor_name || 'Unknown vendor')} — ${fmtTHB(e.total)}</div>
                <div style="display:flex;align-items:center;gap:8px;margin-top:4px">
                  <div class="activity-time">${fmtDateTime(e.updated_at || e.created_at)}</div>
                  <div style="font-size:0.7rem;color:var(--text-muted)">${sourceLabel(e)}</div>
                </div>
              </div>
            </div>`;
            }).join('')}
        </div>

        <div style="display:flex;flex-direction:column;gap:16px">
          <div class="card">
            <div class="card-header">
              <div>
                <div class="card-title">🏷 Spend by category</div>
                <div class="card-subtitle">${monthName} · ${s.thisMonthCount} record${s.thisMonthCount === 1 ? '' : 's'}</div>
              </div>
            </div>
            ${s.categories.length === 0
                ? '<div style="padding:12px 0;font-size:0.82rem;color:var(--text-muted)">No spend recorded this month.</div>'
                : s.categories.slice(0, 6).map(([cat, amt]) => `
              <div style="margin-bottom:10px">
                <div style="display:flex;justify-content:space-between;font-size:0.8rem;margin-bottom:4px">
                  <span>${esc(cat)}</span><span style="font-weight:600">${fmtTHB(amt)}</span>
                </div>
                <div class="progress-bar"><div class="progress-fill" style="width:${maxCat ? (amt / maxCat) * 100 : 0}%"></div></div>
              </div>`).join('')}
          </div>

          <div style="font-size:0.75rem;color:var(--text-muted);padding:0 4px">
            🔗 Email, LINE, Google Drive and Sheets intake are coming in a later phase.
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">💳 Recent Expenses</div>
            <div class="card-subtitle">Newest receipt dates first, disabled records excluded</div>
          </div>
          <button class="btn btn-ghost btn-sm" onclick="Pages.receiptsFiltered('all')">View All →</button>
        </div>
        ${s.recent.length === 0
            ? '<div style="padding:20px;text-align:center;color:var(--text-secondary)">No expenses recorded yet.</div>'
            : `<div class="table-scroll"><table class="data-table">
          <thead><tr>
            <th>Vendor</th><th>Date</th><th>Amount</th><th>Category</th><th>Source</th><th>Status</th>
          </tr></thead>
          <tbody>
            ${s.recent.map(e => `<tr>
                <td>${esc(e.vendor_name)}</td>
                <td style="color:var(--text-secondary)">${fmtDate(e.date)}</td>
                <td style="font-weight:700;color:var(--text-primary)">${fmtTHB(e.total)}</td>
                <td>${e.category ? `<span class="badge badge-info">${esc(e.category)}</span>` : '<span style="color:var(--text-muted)">—</span>'}</td>
                <td>${sourceLabel(e)}</td>
                <td><span class="badge badge-${esc(e.status)}">${esc(e.status)}</span></td>
              </tr>`).join('')}
          </tbody>
        </table></div>`}
      </div>
    `;
    }
};
