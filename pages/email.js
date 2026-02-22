// Email Receipt Scraper Page
window.EmailPage = {
    scanning: false,
    selected: new Set(),

    render(companyId) {
        return `
      <div class="page-header">
        <div class="page-header-left">
          <h1>📧 Email Receipt Scraper</h1>
          <p>Automatically detect and import e-receipts from connected inboxes</p>
        </div>
        <button class="btn btn-primary" id="scanBtn" onclick="EmailPage.startScan()">🔍 Scan Inbox Now</button>
      </div>

      <div class="grid-2" style="margin-bottom:20px">
        ${[
                { icon: '📧', name: 'Gmail — info@techvision.co.th', status: 'connected', count: '3 found' },
                { icon: '📫', name: 'Office365 — accounts@greenlogistics.com', status: 'connected', count: '2 found' },
            ].map(acc => `
        <div class="integration-card">
          <div class="integration-logo">${acc.icon}</div>
          <div class="integration-info">
            <div class="integration-name">${acc.name}</div>
            <div class="integration-desc">Last scanned: 2 hours ago · ${acc.count}</div>
          </div>
          <div class="integration-status status-connected">
            <div class="status-dot"></div>
            <span style="color:var(--green);font-size:0.78rem">Active</span>
          </div>
        </div>`).join('')}
      </div>

      <div class="card" style="margin-bottom:20px">
        <div class="card-header">
          <div class="card-title">📥 Scan Progress</div>
          <span id="scanStatus" style="font-size:0.8rem;color:var(--text-secondary)">Idle — click "Scan Inbox Now" to start</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill" id="scanProgress" style="width:0%"></div>
        </div>
        <div id="scanLog" style="font-size:0.78rem;color:var(--text-muted);margin-top:8px;min-height:20px"></div>
      </div>

      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">📋 Detected Receipts</div>
            <div class="card-subtitle" id="receiptCount">5 receipts available for import</div>
          </div>
          <div style="display:flex;gap:10px">
            <button class="btn btn-ghost btn-sm" onclick="EmailPage.selectAll()">Select All</button>
            <button class="btn btn-primary btn-sm" id="importBtn" onclick="EmailPage.importSelected()">⬇ Import Selected</button>
          </div>
        </div>
        <div id="emailReceiptList">
          ${this.renderReceiptList(MockData.emailReceipts, companyId)}
        </div>
      </div>
    `;
    },

    renderReceiptList(receipts, companyId) {
        return receipts.map(r => `
    <div class="activity-item" style="padding:14px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);margin-bottom:8px;gap:12px">
      <input type="checkbox" id="er_${r.id}" onchange="EmailPage.toggleSelect('${r.id}')">
      <div class="activity-icon-wrap">📧</div>
      <div style="flex:1">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px">
          <div>
            <div style="font-size:0.88rem;font-weight:600">${r.subject}</div>
            <div style="font-size:0.78rem;color:var(--text-muted);margin-top:2px">${r.from} · ${r.date}</div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div style="font-size:1rem;font-weight:800">฿${r.amount.toLocaleString()}</div>
            <span class="badge badge-info" style="font-size:0.68rem">${r.category}</span>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-top:8px">
          <span class="badge badge-confirmed">✓ Detected</span>
          <span style="font-size:0.78rem;color:var(--text-secondary)">${r.vendor}</span>
        </div>
      </div>
    </div>`).join('');
    },

    startScan() {
        const btn = document.getElementById('scanBtn');
        const progress = document.getElementById('scanProgress');
        const status = document.getElementById('scanStatus');
        const log = document.getElementById('scanLog');
        if (this.scanning) return;
        this.scanning = true;
        btn.disabled = true;
        btn.textContent = '⏳ Scanning...';

        const steps = [
            { p: 10, msg: 'Connecting to Gmail API...' },
            { p: 25, msg: 'Fetching inbox (last 30 days)...' },
            { p: 45, msg: 'Filtering receipt-like emails...' },
            { p: 65, msg: 'Running AI parser on attachments...' },
            { p: 80, msg: 'Extracting amounts and vendors...' },
            { p: 95, msg: 'Deduplicating with existing records...' },
            { p: 100, msg: '✅ Scan complete — 5 receipts found!' },
        ];
        let i = 0;
        const iv = setInterval(() => {
            if (i >= steps.length) {
                clearInterval(iv);
                this.scanning = false;
                btn.disabled = false;
                btn.textContent = '🔍 Scan Inbox Now';
                status.textContent = 'Completed — 5 receipts detected';
                App.showToast('success', '📧 Inbox scan complete — 5 receipts found!');
                return;
            }
            progress.style.width = steps[i].p + '%';
            status.textContent = `${steps[i].p}%`;
            log.textContent = steps[i].msg;
            i++;
        }, 500);
    },

    selectAll() {
        MockData.emailReceipts.forEach(r => {
            this.selected.add(r.id);
            const cb = document.getElementById('er_' + r.id);
            if (cb) cb.checked = true;
        });
    },

    toggleSelect(id) {
        if (this.selected.has(id)) this.selected.delete(id);
        else this.selected.add(id);
    },

    importSelected() {
        const count = this.selected.size || MockData.emailReceipts.length;
        App.showToast('success', `✅ ${count} receipt(s) imported to expense database!`);
        this.selected.clear();
    }
};
