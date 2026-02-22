// Reports & Analytics Page
window.ReportsPage = {
    barChart: null,
    donutChart: null,
    companyFilter: 'all',

    render(companyId) {
        this.companyFilter = companyId;
        return `
      <div class="page-header">
        <div class="page-header-left">
          <h1>📈 Reports & Analytics</h1>
          <p>Monthly summaries, trends, and category breakdowns</p>
        </div>
        <div style="display:flex;gap:10px">
          <button class="btn btn-secondary btn-sm" onclick="ReportsPage.exportReport()">⬇ Export PDF</button>
          <button class="btn btn-primary btn-sm" onclick="SheetsPage.export();App.navigate('reports')">⬇ Export CSV</button>
        </div>
      </div>

      <div class="kpi-grid" style="margin-bottom:24px">
        ${[
                { label: 'Year to Date', value: '฿61,930', change: '+18.3%', icon: '📅', color: 'accent' },
                { label: 'Monthly Avg', value: '฿15,483', change: '+5.2%', icon: '📊', color: 'green' },
                { label: 'Highest Month', value: '฿42,100', change: 'Dec 2025', icon: '🏆', color: 'amber' },
                { label: 'Largest Category', value: 'Marketing', change: '฿20,900', icon: '🎯', color: 'cyan' },
            ].map(k => `
        <div class="kpi-card" style="--kpi-color:var(--${k.color});--kpi-bg:var(--${k.color}-soft)">
          <div class="kpi-icon">${k.icon}</div>
          <div class="kpi-label">${k.label}</div>
          <div class="kpi-value" style="font-size:1.4rem">${k.value}</div>
          <div class="kpi-change up">${k.change}</div>
        </div>`).join('')}
      </div>

      <div class="grid-2" style="margin-bottom:20px">
        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title">📊 Monthly Expenses</div>
              <div class="card-subtitle">Last 7 months — all companies</div>
            </div>
            <div style="display:flex;gap:6px">
              ${MockData.companies.map(c => `
              <span style="font-size:0.72rem;padding:3px 8px;border-radius:99px;background:${c.color}22;color:${c.color}">${c.short}</span>`).join('')}
            </div>
          </div>
          <div class="chart-wrap">
            <canvas id="barChart"></canvas>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title">🍩 Category Breakdown</div>
              <div class="card-subtitle">February 2026 — all companies</div>
            </div>
          </div>
          <div class="chart-wrap" style="height:220px">
            <canvas id="donutChart"></canvas>
          </div>
        </div>
      </div>

      <div class="card" style="margin-bottom:20px">
        <div class="card-header">
          <div class="card-title">🏢 Company Comparison</div>
        </div>
        <table class="data-table">
          <thead><tr>
            <th>Company</th>
            <th>Feb 2026</th>
            <th>Jan 2026</th>
            <th>Dec 2025</th>
            <th>Change MoM</th>
            <th>YTD Total</th>
          </tr></thead>
          <tbody>
            ${MockData.companies.map(comp => {
                const md = MockData.monthlyData.companies[comp.id];
                const feb = md[6], jan = md[5], dec = md[4];
                const change = (((feb - jan) / jan) * 100).toFixed(1);
                const ytd = md[5] + feb;
                const changeColor = change >= 0 ? 'var(--red)' : 'var(--green)';
                return `<tr>
                <td><span class="company-pill" style="background:${comp.color}22;color:${comp.color}">${comp.name}</span></td>
                <td style="font-weight:700">฿${feb.toLocaleString()}</td>
                <td>฿${jan.toLocaleString()}</td>
                <td>฿${dec.toLocaleString()}</td>
                <td style="color:${changeColor}">${change >= 0 ? '↑' : '↓'} ${Math.abs(change)}%</td>
                <td style="font-weight:700;color:var(--accent)">฿${ytd.toLocaleString()}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title">🏷️ Category Totals — February 2026</div>
        </div>
        ${MockData.categories.map(cat => {
                const total = MockData.expenses.filter(e => e.category === cat).reduce((s, e) => s + e.amount, 0);
                if (!total) return '';
                const allTotal = MockData.expenses.reduce((s, e) => s + e.amount, 0);
                const pct = Math.round((total / allTotal) * 100);
                const colors = { 'Software & SaaS': '#6366f1', 'Transport': '#10b981', 'Food & Beverage': '#f97316', 'Utilities': '#06b6d4', 'Office Supplies': '#f59e0b', 'Marketing': '#8b5cf6', 'Travel': '#ef4444', 'Other': '#64748b' };
                const col = colors[cat] || '#6366f1';
                return `<div class="stat-row">
            <div class="stat-label">${cat}</div>
            <div class="stat-bar-wrap"><div class="stat-bar" style="width:${pct}%;background:${col}"></div></div>
            <div class="stat-value" style="color:${col}">฿${total.toLocaleString()} <span style="color:var(--text-muted);font-weight:400">(${pct}%)</span></div>
          </div>`;
            }).filter(Boolean).join('')}
      </div>
    `;
    },

    initCharts() {
        if (typeof Chart === 'undefined') return;

        // Destroy old charts
        if (this.barChart) { this.barChart.destroy(); this.barChart = null; }
        if (this.donutChart) { this.donutChart.destroy(); this.donutChart = null; }

        const barCtx = document.getElementById('barChart');
        const donutCtx = document.getElementById('donutChart');
        if (!barCtx || !donutCtx) return;

        const md = MockData.monthlyData;
        const companyColors = { c1: '#6366f1', c2: '#10b981', c3: '#f59e0b' };

        this.barChart = new Chart(barCtx, {
            type: 'bar',
            data: {
                labels: md.labels,
                datasets: MockData.companies.map(comp => ({
                    label: comp.name,
                    data: md.companies[comp.id],
                    backgroundColor: companyColors[comp.id] + 'cc',
                    borderColor: companyColors[comp.id],
                    borderWidth: 1,
                    borderRadius: 4,
                }))
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { labels: { color: '#8892b0', font: { family: 'Inter', size: 11 } } },
                    tooltip: {
                        backgroundColor: '#0d1120',
                        borderColor: 'rgba(255,255,255,0.08)',
                        borderWidth: 1,
                        titleColor: '#f0f4ff',
                        bodyColor: '#8892b0',
                        callbacks: { label: ctx => ` ${ctx.dataset.label}: ฿${ctx.parsed.y.toLocaleString()}` }
                    }
                },
                scales: {
                    x: { ticks: { color: '#8892b0' }, grid: { color: 'rgba(255,255,255,0.05)' } },
                    y: { ticks: { color: '#8892b0', callback: v => '฿' + (v / 1000).toFixed(0) + 'K' }, grid: { color: 'rgba(255,255,255,0.05)' } }
                }
            }
        });

        // Category donut
        const catColors = ['#6366f1', '#10b981', '#f59e0b', '#06b6d4', '#ef4444', '#8b5cf6', '#f97316', '#64748b'];
        const catData = MockData.expenses.reduce((acc, e) => { acc[e.category] = (acc[e.category] || 0) + e.amount; return acc; }, {});
        const catLabels = Object.keys(catData).filter(k => catData[k] > 0);
        const catValues = catLabels.map(k => catData[k]);

        this.donutChart = new Chart(donutCtx, {
            type: 'doughnut',
            data: {
                labels: catLabels,
                datasets: [{
                    data: catValues,
                    backgroundColor: catColors.slice(0, catLabels.length).map(c => c + 'cc'),
                    borderColor: catColors.slice(0, catLabels.length),
                    borderWidth: 2,
                    hoverOffset: 6,
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                cutout: '68%',
                plugins: {
                    legend: { position: 'right', labels: { color: '#8892b0', font: { family: 'Inter', size: 11 }, padding: 12, boxWidth: 12, borderRadius: 3 } },
                    tooltip: {
                        backgroundColor: '#0d1120',
                        borderColor: 'rgba(255,255,255,0.08)',
                        borderWidth: 1,
                        callbacks: { label: ctx => ` ฿${ctx.parsed.toLocaleString()} (${Math.round(ctx.parsed / catValues.reduce((a, b) => a + b, 0) * 100)}%)` }
                    }
                }
            }
        });
    },

    exportReport() {
        App.showToast('info', '⬇ Generating PDF report...');
        setTimeout(() => App.showToast('success', '✅ PDF report exported!'), 1200);
    }
};
