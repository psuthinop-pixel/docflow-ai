window.DashboardPage = {
    loading: false,
    expenses: [],
    lastCompanyId: null,

    async loadData(companyId) {
        this.loading = true;
        try {
            this.expenses = await window.ExpenseApi.listExpenses(companyId);
        } catch (error) {
            console.error('Dashboard load failed:', error);
        } finally {
            this.loading = false;
            const content = document.getElementById('mainContent');
            if (content && App.currentPage === 'dashboard') {
                content.innerHTML = this.render(companyId, true);
            }
        }
    },

    render(companyId, isLoaded = false) {
        if (!isLoaded || this.lastCompanyId !== companyId) {
            this.lastCompanyId = companyId;
            this.loadData(companyId);
        }

        if (this.loading && !isLoaded) {
            return '<div style="display:flex;align-items:center;justify-content:center;height:60vh;font-size:1.5rem">📊 Loading Dashboard...</div>';
        }

        const data = MockData;
        
        // Filter out disabled expenses for calculations and display
        const activeExpenses = this.expenses.filter(e => e.status !== 'disabled');
        
        const total = activeExpenses.reduce((s, e) => s + parseFloat(e.total || 0), 0);
        const pending = activeExpenses.filter(e => e.status === 'pending').length;
        const confirmed = activeExpenses.filter(e => e.status === 'confirmed').length;
        const companiesCount = App.organizations.length;

        return `
      <div class="page-header">
        <div class="page-header-left">
          <h1>📊 Dashboard</h1>
          <p>Overview of your financial activity — Live Data</p>
        </div>
        <div style="display:flex;gap:10px">
          <button class="btn btn-secondary btn-sm" onclick="Pages.receipts()">📤 Upload Receipt</button>
          <button class="btn btn-primary btn-sm" onclick="Pages.email()">📧 Scan Email</button>
        </div>
      </div>

      <div class="kpi-grid">
        <div class="kpi-card" style="--kpi-color:var(--accent);--kpi-bg:var(--accent-soft)">
          <div class="kpi-icon">💰</div>
          <div class="kpi-label">Total Expenses (MTD)</div>
          <div class="kpi-value">฿${total.toLocaleString()}</div>
          <div class="kpi-change up">↑ Live from database</div>
        </div>
        <div class="kpi-card" style="--kpi-color:var(--amber);--kpi-bg:var(--amber-soft)">
          <div class="kpi-icon">⏳</div>
          <div class="kpi-label">Pending Review</div>
          <div class="kpi-value">${pending}</div>
          <div class="kpi-change" style="color:var(--amber)">Requires attention</div>
        </div>
        <div class="kpi-card" style="--kpi-color:var(--green);--kpi-bg:var(--green-soft)">
          <div class="kpi-icon">✅</div>
          <div class="kpi-label">Confirmed Receipts</div>
          <div class="kpi-value">${confirmed}</div>
          <div class="kpi-change up">Processed successfully</div>
        </div>
        <div class="kpi-card" style="--kpi-color:var(--cyan);--kpi-bg:var(--cyan-soft)">
          <div class="kpi-icon">🏢</div>
          <div class="kpi-label">Your Organizations</div>
          <div class="kpi-value">${companiesCount}</div>
          <div class="kpi-change" style="color:var(--cyan)">Multi-company mode</div>
        </div>
      </div>

      <div class="grid-2-1">
        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title">📋 Recent Activity</div>
              <div class="card-subtitle">Real-time extraction logs</div>
            </div>
          </div>
          ${activeExpenses.length === 0 ? '<div style="padding:20px;text-align:center;color:var(--text-secondary)">No active records found.</div>' : 
            activeExpenses.slice(0, 5).map(e => `
            <div class="activity-item">
              <div class="activity-icon-wrap">🔍</div>
              <div style="flex:1">
                <div class="activity-text">OCR processed: ${e.vendor_name} — ฿${parseFloat(e.total).toLocaleString()}</div>
                <div style="display:flex;align-items:center;gap:8px;margin-top:4px">
                  <div class="activity-time">${new Date(e.date).toLocaleDateString()}</div>
                  <div class="company-pill" style="background:var(--accent-soft);color:var(--accent);font-size:0.7rem;padding:2px 8px;border-radius:99px">Live</div>
                </div>
              </div>
            </div>`).join('')}
        </div>

        <div style="display:flex;flex-direction:column;gap:16px">
          <div class="card">
            <div class="card-header">
              <div class="card-title">🔗 Integrations</div>
            </div>
            <div style="display:flex;flex-direction:column;gap:8px">
              ${[
                { icon: '📧', name: 'Gmail', status: 'connected' },
                { icon: '💬', name: 'LINE Bot', status: 'connected' },
                { icon: '📁', name: 'Google Drive', status: 'connected' },
                { icon: '📊', name: 'Google Sheets', status: 'connected' },
                { icon: '🤖', name: 'AI OCR', status: 'connected' },
            ].map(i => `
              <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
                <span style="font-size:1.1rem">${i.icon}</span>
                <span style="font-size:0.85rem;flex:1">${i.name}</span>
                <div class="integration-status status-connected">
                  <div class="status-dot"></div>
                  <span style="color:var(--green);font-size:0.75rem">Active</span>
                </div>
              </div>`).join('')}
            </div>
          </div>

          <div class="card" style="background:linear-gradient(135deg,rgba(99,102,241,0.1),rgba(129,140,248,0.05))">
            <div class="card-title" style="margin-bottom:8px">⚡ Quick Actions</div>
            <div style="display:flex;flex-direction:column;gap:8px">
              <button class="btn btn-primary" style="width:100%;justify-content:center" onclick="Pages.receipts()">📤 Upload Receipt</button>
              <button class="btn btn-secondary" style="width:100%;justify-content:center" onclick="Pages.sheets()">📊 Sync Sheets</button>
              <button class="btn btn-secondary" style="width:100%;justify-content:center" onclick="Pages.reports()">📈 View Reports</button>
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">💳 Recent Live Expenses</div>
            <div class="card-subtitle">Confirmed transactions excluding disabled ones</div>
          </div>
          <button class="btn btn-ghost btn-sm" onclick="Pages.receipts()">View All →</button>
        </div>
        <table class="data-table">
          <thead><tr>
            <th>Vendor</th><th>Date</th><th>Amount</th><th>Category</th><th>Source</th><th>Status</th>
          </tr></thead>
          <tbody>
            ${activeExpenses.slice(0, 6).map(e => {
                return `<tr>
                <td>${e.vendor_name}</td>
                <td style="color:var(--text-secondary)">${new Date(e.date).toLocaleDateString()}</td>
                <td style="font-weight:700;color:var(--text-primary)">฿${parseFloat(e.total).toLocaleString()}</td>
                <td><span class="badge badge-info">${e.category}</span></td>
                <td>📤 upload</td>
                <td><span class="badge badge-confirmed">confirmed</span></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
    }
};
