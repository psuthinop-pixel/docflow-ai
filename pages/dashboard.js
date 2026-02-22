// Dashboard Page
window.DashboardPage = {
    render(companyId) {
        const data = MockData;
        const expenses = companyId === 'all'
            ? data.expenses
            : data.expenses.filter(e => e.companyId === companyId);

        const total = expenses.reduce((s, e) => s + e.amount, 0);
        const pending = expenses.filter(e => e.status === 'pending').length;
        const confirmed = expenses.filter(e => e.status === 'confirmed').length;
        const companiesCount = data.companies.length;

        return `
      <div class="page-header">
        <div class="page-header-left">
          <h1>📊 Dashboard</h1>
          <p>Overview of your financial activity — February 2026</p>
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
          <div class="kpi-change up">↑ 12.4% vs last month</div>
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
          <div class="kpi-change up">↑ 8 since last week</div>
        </div>
        <div class="kpi-card" style="--kpi-color:var(--cyan);--kpi-bg:var(--cyan-soft)">
          <div class="kpi-icon">🏢</div>
          <div class="kpi-label">Active Companies</div>
          <div class="kpi-value">${companiesCount}</div>
          <div class="kpi-change" style="color:var(--cyan)">Multi-company mode</div>
        </div>
      </div>

      <div class="grid-2-1">
        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title">📋 Recent Activity</div>
              <div class="card-subtitle">Last 24 hours across all integrations</div>
            </div>
          </div>
          ${data.activity.map(a => {
            const comp = data.companies.find(c => c.id === a.company);
            return `
            <div class="activity-item">
              <div class="activity-icon-wrap">${a.icon}</div>
              <div style="flex:1">
                <div class="activity-text">${a.text}</div>
                <div style="display:flex;align-items:center;gap:8px;margin-top:4px">
                  <div class="activity-time">${a.time}</div>
                  ${comp ? `<div class="company-pill" style="background:${comp.color}22;color:${comp.color};font-size:0.7rem;padding:2px 8px;border-radius:99px">${comp.short}</div>` : ''}
                </div>
              </div>
            </div>`;
        }).join('')}
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
            <div class="card-title">💳 Recent Expenses</div>
            <div class="card-subtitle">Latest confirmed and pending transactions</div>
          </div>
          <button class="btn btn-ghost btn-sm" onclick="Pages.sheets()">View All →</button>
        </div>
        <table class="data-table">
          <thead><tr>
            <th>Vendor</th><th>Date</th><th>Amount</th><th>Category</th><th>Source</th><th>Status</th><th>Company</th>
          </tr></thead>
          <tbody>
            ${expenses.slice(0, 6).map(e => {
                const comp = data.companies.find(c => c.id === e.companyId);
                const sourceIcons = { upload: '📤', email: '📧', line: '💬' };
                return `<tr>
                <td>${e.vendor}</td>
                <td style="color:var(--text-secondary)">${e.date}</td>
                <td style="font-weight:700;color:var(--text-primary)">฿${e.amount.toLocaleString()}</td>
                <td><span class="badge badge-info">${e.category}</span></td>
                <td>${sourceIcons[e.source] || '?'} ${e.source}</td>
                <td><span class="badge badge-${e.status}">${e.status}</span></td>
                <td>${comp ? `<span class="company-pill" style="background:${comp.color}22;color:${comp.color}">${comp.short}</span>` : ''}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
    }
};
