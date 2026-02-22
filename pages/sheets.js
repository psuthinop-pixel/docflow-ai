// Google Sheets Expense Database Page
window.SheetsPage = {
    sortKey: 'date',
    sortDir: 'desc',
    filterCategory: 'all',
    syncing: false,

    render(companyId) {
        let expenses = companyId === 'all'
            ? MockData.expenses
            : MockData.expenses.filter(e => e.companyId === companyId);

        if (this.filterCategory !== 'all') expenses = expenses.filter(e => e.category === this.filterCategory);
        expenses = [...expenses].sort((a, b) => {
            let v = a[this.sortKey] > b[this.sortKey] ? 1 : -1;
            return this.sortDir === 'desc' ? -v : v;
        });

        const total = expenses.reduce((s, e) => s + e.amount, 0);
        const totalTax = expenses.reduce((s, e) => s + e.tax, 0);

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
        <div style="overflow-x:auto">
          <table class="data-table">
            <thead><tr>
              <th style="cursor:pointer" onclick="SheetsPage.sort('vendor')">Vendor ${this.sortKey === 'vendor' ? '↕' : ''}</th>
              <th style="cursor:pointer" onclick="SheetsPage.sort('date')">Date ${this.sortKey === 'date' ? '↕' : ''}</th>
              <th style="cursor:pointer" onclick="SheetsPage.sort('amount')">Amount ${this.sortKey === 'amount' ? '↕' : ''}</th>
              <th>Tax</th>
              <th>Category</th>
              <th>Source</th>
              <th>Status</th>
              <th>Company</th>
            </tr></thead>
            <tbody>
              ${expenses.map(e => {
            const comp = MockData.companies.find(c => c.id === e.companyId);
            const srcIcons = { upload: '📤', email: '📧', line: '💬' };
            return `<tr>
                  <td>${e.vendor}</td>
                  <td>${e.date}</td>
                  <td style="font-weight:800;color:var(--text-primary)">฿${e.amount.toLocaleString()}</td>
                  <td style="color:var(--text-muted)">฿${e.tax.toLocaleString()}</td>
                  <td><span class="badge badge-info">${e.category}</span></td>
                  <td>${srcIcons[e.source] || ''} ${e.source}</td>
                  <td><span class="badge badge-${e.status}">${e.status}</span></td>
                  <td>${comp ? `<span class="company-pill" style="background:${comp.color}22;color:${comp.color}">${comp.name}</span>` : ''}</td>
                </tr>`;
        }).join('')}
            </tbody>
            <tfoot>
              <tr style="border-top:2px solid var(--border)">
                <td colspan="2" style="font-weight:700;color:var(--text-primary)">TOTAL</td>
                <td style="font-weight:800;font-size:1rem;color:var(--accent)">฿${total.toLocaleString()}</td>
                <td style="font-weight:700;color:var(--amber)">฿${totalTax.toLocaleString()}</td>
                <td colspan="4"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title">📊 Category Breakdown</div>
        </div>
        ${Object.entries(
            expenses.reduce((acc, e) => { acc[e.category] = (acc[e.category] || 0) + e.amount; return acc; }, {})
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
        const expenses = MockData.expenses;
        const headers = ['Vendor', 'Date', 'Amount', 'Tax', 'Category', 'Source', 'Status', 'Company'];
        const rows = expenses.map(e => {
            const comp = MockData.companies.find(c => c.id === e.companyId);
            return [e.vendor, e.date, e.amount, e.tax, e.category, e.source, e.status, comp?.name || ''].join(',');
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
