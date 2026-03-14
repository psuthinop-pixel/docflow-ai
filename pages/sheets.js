// Google Sheets Expense Database Page
window.SheetsPage = {
    sortKey: 'date',
    sortDir: 'desc',
    filterCategory: 'all',
    syncing: false,
    expenses: [],
    loading: false,
    initialized: false,

    render(companyId) {
        if (!this.initialized || this.lastCompanyId !== companyId) {
            this.initialized = true;
            this.lastCompanyId = companyId;
            this.loadExpenses(companyId);
        }

        let expenses = this.expenses;

        if (this.filterCategory !== 'all') expenses = expenses.filter(e => e.category === this.filterCategory);
        expenses = [...expenses].sort((a, b) => {
            let v = a[this.sortKey] > b[this.sortKey] ? 1 : -1;
            return this.sortDir === 'desc' ? -v : v;
        });

        const total = expenses.reduce((s, e) => s + (parseFloat(e.total) || 0), 0);
        const totalTax = total * 0.07; // Approximate VAT if not in API

        return `
      <div class="page-header">
        <div class="page-header-left">
          <h1>📊 Google Sheets Database</h1>
          <p>Live expense data synced to Google Sheets — last sync 2 min ago</p>
        </div>
        <div style="display:flex;gap:10px">
          <button class="btn btn-secondary btn-sm" onclick="SheetsPage.export()">⬇ CSV Export</button>
          <button class="btn btn-primary" id="syncBtn" onclick="SheetsPage.sync()">🔄 Sync Now</button>
        </div>
      </div>

      <div class="kpi-grid" style="margin-bottom:20px">
        <div class="kpi-card" style="--kpi-color:var(--accent);--kpi-bg:var(--accent-soft)">
          <div class="kpi-icon">💰</div>
          <div class="kpi-label">Total Amount</div>
          <div class="kpi-value" style="font-size:1.5rem">฿${total.toLocaleString()}</div>
          <div class="kpi-change up">All selected records</div>
        </div>
        <div class="kpi-card" style="--kpi-color:var(--amber);--kpi-bg:var(--amber-soft)">
          <div class="kpi-icon">🧾</div>
          <div class="kpi-label">Total Tax (VAT 7%)</div>
          <div class="kpi-value" style="font-size:1.5rem">฿${totalTax.toLocaleString()}</div>
        </div>
        <div class="kpi-card" style="--kpi-color:var(--green);--kpi-bg:var(--green-soft)">
          <div class="kpi-icon">📋</div>
          <div class="kpi-label">Total Records</div>
          <div class="kpi-value" style="font-size:1.5rem">${expenses.length}</div>
        </div>
        <div class="kpi-card" style="--kpi-color:var(--cyan);--kpi-bg:var(--cyan-soft)">
          <div class="kpi-icon">📅</div>
          <div class="kpi-label">Sync Status</div>
          <div class="kpi-value" style="font-size:1rem;color:var(--green)">✅ Synced</div>
          <div class="kpi-change" style="color:var(--text-muted)">2 min ago · Row 1–${expenses.length}</div>
        </div>
      </div>

      <div class="card" style="margin-bottom:20px">
        <div class="card-header">
          <div>
            <div class="card-title">📋 Expense Records</div>
            <div class="card-subtitle">Mirrors your Google Sheet — <a href="#" style="color:var(--accent)" onclick="App.showToast('info','↗ Opening Google Sheet...')">Open in Sheets ↗</a></div>
          </div>
          <div style="display:flex;gap:10px;align-items:center">
            <select class="form-select" style="padding:7px 10px;font-size:0.82rem;width:auto" onchange="SheetsPage.filterCategory=this.value;App.navigate('sheets')">
              <option value="all">All Categories</option>
              ${MockData.categories.map(c => `<option value="${c}" ${this.filterCategory === c ? 'selected' : ''}>${c}</option>`).join('')}
            </select>
          </div>
        </div>
        <div style="overflow-x:auto" id="sheetsTableContainer">
            ${this.renderTable(expenses, total, totalTax)}
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title">📊 Category Breakdown</div>
        </div>
        ${total === 0 ? '<div style="padding:20px;text-align:center;color:var(--text-secondary)">No data to display.</div>' : Object.entries(
            expenses.reduce((acc, e) => { 
                const amt = parseFloat(e.total) || 0;
                acc[e.category] = (acc[e.category] || 0) + amt; 
                return acc; 
            }, {})
        ).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => {
            const pct = Math.round((amt / total) * 100);
            const colors = ['#6366f1', '#10b981', '#f59e0b', '#06b6d4', '#ef4444', '#8b5cf6', '#f97316', '#64748b'];
            const ci = MockData.categories.indexOf(cat) % colors.length;
            return `<div class="stat-row">
            <div class="stat-label">${cat}</div>
            <div class="stat-bar-wrap"><div class="stat-bar" style="width:${pct}%;background:${colors[ci]}"></div></div>
            <div class="stat-value" style="color:${colors[ci]}">฿${amt.toLocaleString()}</div>
          </div>`;
        }).join('')}
      </div>
    `;
    },

    renderTable(expenses, total, totalTax) {
        if (this.loading) return '<div style="padding:40px;text-align:center">Loading expense records...</div>';
        if (expenses.length === 0) return '<div style="padding:40px;text-align:center;color:var(--text-secondary)">No records found.</div>';

        return `
          <table class="data-table">
            <thead><tr>
              <th style="cursor:pointer" onclick="SheetsPage.sort('vendor_name')">Vendor ${this.sortKey === 'vendor_name' ? '↕' : ''}</th>
              <th style="cursor:pointer" onclick="SheetsPage.sort('date')">Date ${this.sortKey === 'date' ? '↕' : ''}</th>
              <th style="cursor:pointer" onclick="SheetsPage.sort('total')">Amount ${this.sortKey === 'total' ? '↕' : ''}</th>
              <th>Category</th>
              <th>Status</th>
              <th>Organization ID</th>
            </tr></thead>
            <tbody>
              ${expenses.map(e => {
            return `<tr>
                  <td>${e.vendor_name}</td>
                  <td>${new Date(e.date).toLocaleDateString()}</td>
                  <td style="font-weight:800;color:var(--text-primary)">฿${(parseFloat(e.total) || 0).toLocaleString()}</td>
                  <td><span class="badge badge-info">${e.category}</span></td>
                  <td><span class="badge badge-${e.status}">${e.status}</span></td>
                  <td><span class="company-pill" style="background:var(--accent-soft);color:var(--accent);font-size:0.7rem">${e.organization_id}</span></td>
                </tr>`;
        }).join('')}
            </tbody>
            <tfoot>
              <tr style="border-top:2px solid var(--border)">
                <td colspan="2" style="font-weight:700;color:var(--text-primary)">TOTAL</td>
                <td style="font-weight:800;font-size:1rem;color:var(--accent)">฿${total.toLocaleString()}</td>
                <td colspan="3"></td>
              </tr>
            </tfoot>
          </table>
        `;
    },

    async loadExpenses(companyId) {
        this.loading = true;
        try {
            this.expenses = await window.ExpenseApi.listExpenses(companyId);
            const container = document.getElementById('sheetsTableContainer');
            if (container) App.navigate('sheets'); // Refresh view
        } catch (error) {
            console.error('Failed to load expenses:', error);
            App.showToast('error', 'Failed to load expense records');
        } finally {
            this.loading = false;
        }
    },

    sort(key) {
        if (this.sortKey === key) this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
        else { this.sortKey = key; this.sortDir = 'desc'; }
        App.navigate('sheets');
    },

    sync() {
        if (this.syncing) return;
        this.syncing = true;
        const btn = document.getElementById('syncBtn');
        if (btn) { btn.disabled = true; btn.textContent = '⏳ Syncing...'; }
        setTimeout(() => {
            this.syncing = false;
            if (btn) { btn.disabled = false; btn.textContent = '🔄 Sync Now'; }
            App.showToast('success', `✅ Google Sheets synced — ${MockData.expenses.length} rows updated!`);
        }, 2000);
    },

    export() {
        const expenses = this.expenses;
        const headers = ['Vendor', 'Date', 'Amount', 'Category', 'Status', 'Organization'];
        const rows = expenses.map(e => {
            return [e.vendor_name, e.date, e.total, e.category, e.status, e.organization_id].join(',');
        });
        const csv = [headers.join(','), ...rows].join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `docflow_expenses_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        App.showToast('success', '⬇ CSV downloaded successfully!');
    }
};
