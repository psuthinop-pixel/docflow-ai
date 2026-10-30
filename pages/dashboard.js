window.DashboardPage = {
    loading: false,
    error: null,
    expenses: [],
    lastCompanyId: null,

    async loadData(companyId) {
        this.loading = true;
        this.error = null;
        try {
            this.expenses = await window.ExpenseApi.listExpenses(companyId);
            App.setDraftCount(this.expenses);
        } catch (error) {
            console.error('Dashboard load failed:', error);
            this.expenses = [];
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

    // 'YYYY-MM' of the receipt date, falling back to when it was recorded
    monthOf(e) {
        return String(e.date || e.created_at || '').slice(0, 7);
    },

    monthKey(offset = 0) {
        const d = new Date();
        d.setDate(1);
        d.setMonth(d.getMonth() + offset);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    },

    stats() {
        const active = this.expenses.filter(e => e.status !== 'disabled');
        const sum = (list, key = 'total') => list.reduce((s, e) => s + (parseFloat(e[key]) || 0), 0);
        const thisMonth = active.filter(e => this.monthOf(e) === this.monthKey(0));
        const lastMonth = active.filter(e => this.monthOf(e) === this.monthKey(-1));
        const spend = sum(thisMonth);
        const lastSpend = sum(lastMonth);

        // Input VAT counts only reviewed records that carry a VAT amount;
        // without the seller's 13-digit tax ID it cannot be claimed.
        const vatRecords = thisMonth.filter(e => e.status !== 'draft' && parseFloat(e.tax_amount) > 0);
        const claimable = vatRecords.filter(e => /^\d{13}$/.test(e.vendor_taxid || ''));

        const byCategory = {};
        thisMonth.forEach(e => {
            const cat = e.category || 'Uncategorised';
            byCategory[cat] = (byCategory[cat] || 0) + (parseFloat(e.total) || 0);
        });

        return {
            active,
            spend,
            lastSpend,
            change: lastSpend > 0 ? ((spend - lastSpend) / lastSpend) * 100 : null,
            thisMonthCount: thisMonth.length,
            drafts: active.filter(e => e.status === 'draft').length,
            awaitingApproval: active.filter(e => e.status === 'confirmed').length,
            vat: sum(claimable, 'tax_amount'),
            vatCount: claimable.length,
            vatMissingTaxId: vatRecords.length - claimable.length,
            categories: Object.entries(byCategory).sort((a, b) => b[1] - a[1]),
        };
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

        if (this.loading && !isLoaded) {
            return '<div style="display:flex;align-items:center;justify-content:center;height:60vh;font-size:1.5rem">📊 Loading Dashboard...</div>';
        }

        const s = this.stats();
        const org = (App.organizations || []).find(o => (o._id || o.id) === companyId);
        const monthName = new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
        const isApprover = !!org && ['owner', 'admin'].includes(org.role);

        return `
      <div class="page-header">
        <div class="page-header-left">
          <h1>📊 ${esc(org ? org.organization_name : 'Dashboard')}</h1>
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

        const recentActivity = [...s.active]
            .sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')))
            .slice(0, 5);

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
        ${s.active.length === 0
            ? '<div style="padding:20px;text-align:center;color:var(--text-secondary)">No expenses recorded yet.</div>'
            : `<table class="data-table">
          <thead><tr>
            <th>Vendor</th><th>Date</th><th>Amount</th><th>Category</th><th>Source</th><th>Status</th>
          </tr></thead>
          <tbody>
            ${s.active.slice(0, 6).map(e => `<tr>
                <td>${esc(e.vendor_name)}</td>
                <td style="color:var(--text-secondary)">${fmtDate(e.date)}</td>
                <td style="font-weight:700;color:var(--text-primary)">${fmtTHB(e.total)}</td>
                <td>${e.category ? `<span class="badge badge-info">${esc(e.category)}</span>` : '<span style="color:var(--text-muted)">—</span>'}</td>
                <td>${sourceLabel(e)}</td>
                <td><span class="badge badge-${esc(e.status)}">${esc(e.status)}</span></td>
              </tr>`).join('')}
          </tbody>
        </table>`}
      </div>
    `;
    }
};
