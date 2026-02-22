// Google Drive Automation Page
window.DrivePage = {
    render(companyId) {
        const files = companyId === 'all'
            ? MockData.driveFiles
            : MockData.driveFiles.filter(f => f.company === companyId);

        return `
      <div class="page-header">
        <div class="page-header-left">
          <h1>📁 Google Drive Automation</h1>
          <p>Automatically organizes receipts into structured folders</p>
        </div>
        <div style="display:flex;gap:10px">
          <button class="btn btn-secondary btn-sm" onclick="DrivePage.openDrive()">↗ Open Drive</button>
          <button class="btn btn-primary" onclick="DrivePage.organize()">⚡ Organize Now</button>
        </div>
      </div>

      <div class="grid-2" style="margin-bottom:20px">
        <div class="integration-card card-glow">
          <div class="integration-logo" style="font-size:1.8rem">📁</div>
          <div class="integration-info">
            <div class="integration-name">Google Drive</div>
            <div class="integration-desc">docflow@techvision.co.th · Shared Drive</div>
            <div class="integration-status status-connected" style="display:inline-flex;margin-top:6px">
              <div class="status-dot"></div>
              <span style="color:var(--green);font-size:0.78rem">Connected</span>
            </div>
          </div>
          <button class="btn btn-ghost btn-sm" onclick="DrivePage.disconnect()">Disconnect</button>
        </div>

        <div class="card">
          <div class="card-title" style="margin-bottom:12px">📊 Storage Overview</div>
          <div class="stat-row">
            <div class="stat-label">PDF Invoices</div>
            <div class="stat-bar-wrap"><div class="stat-bar" style="width:72%;background:var(--accent)"></div></div>
            <div class="stat-value" style="color:var(--accent)">247 files</div>
          </div>
          <div class="stat-row">
            <div class="stat-label">Receipt Images</div>
            <div class="stat-bar-wrap"><div class="stat-bar" style="width:45%;background:var(--green)"></div></div>
            <div class="stat-value" style="color:var(--green)">153 files</div>
          </div>
          <div class="stat-row">
            <div class="stat-label">Spreadsheets</div>
            <div class="stat-bar-wrap"><div class="stat-bar" style="width:20%;background:var(--amber)"></div></div>
            <div class="stat-value" style="color:var(--amber)">68 files</div>
          </div>
        </div>
      </div>

      <div class="grid-1-2" style="margin-bottom:20px">
        <div class="card">
          <div class="card-header">
            <div class="card-title">🗂️ Folder Structure</div>
          </div>
          <div class="drive-tree" id="driveTree">
            ${MockData.companies.map(comp => `
            <div>
              <div class="drive-node company" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'block':'none'">
                <span>📁</span>
                <span style="color:${comp.color}">${comp.name}</span>
              </div>
              <div class="drive-children">
                ${['2025', '2026'].map(yr => `
                <div>
                  <div class="drive-node" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'block':'none'">
                    <span>📂</span> ${yr}
                  </div>
                  <div class="drive-children">
                    ${['January', 'February', 'March'].map(mo => `
                    <div class="drive-node">
                      <span>${yr === '2026' && mo === 'February' ? '📂' : '📁'}</span> ${mo}
                      ${yr === '2026' && mo === 'February' ? `<span style="font-size:0.7rem;background:var(--accent-soft);color:var(--accent);padding:2px 6px;border-radius:99px;margin-left:4px">${files.length} files</span>` : ''}
                    </div>`).join('')}
                  </div>
                </div>`).join('')}
              </div>
            </div>`).join('')}
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title">🕐 Auto-Organized Files</div>
              <div class="card-subtitle">Recently processed documents</div>
            </div>
          </div>
          <table class="data-table">
            <thead><tr>
              <th>File</th><th>Company</th><th>Folder</th><th>Size</th>
            </tr></thead>
            <tbody>
              ${files.map(f => {
            const comp = MockData.companies.find(c => c.id === f.company);
            return `<tr>
                  <td>
                    <div style="display:flex;align-items:center;gap:8px">
                      <span>${f.type === 'pdf' ? '📄' : '🖼️'}</span>
                      <span style="font-size:0.82rem">${f.name}</span>
                    </div>
                  </td>
                  <td>${comp ? `<span class="company-pill" style="background:${comp.color}22;color:${comp.color}">${comp.short}</span>` : ''}</td>
                  <td style="font-size:0.8rem;color:var(--text-muted)">${f.year} / ${f.month}</td>
                  <td style="font-size:0.8rem">${f.size}</td>
                </tr>`;
        }).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title">⚙️ Automation Rules</div>
        </div>
        <div style="display:grid;gap:10px">
          ${[
                { rule: 'Receipts → {Company} / {Year} / {Month}', status: 'active' },
                { rule: 'PDF Invoices → Rename to {Vendor}_{Date}.pdf', status: 'active' },
                { rule: 'Duplicate files → Move to /Archive', status: 'active' },
                { rule: 'Unmatched receipts → Flag for review', status: 'active' },
            ].map(r => `
          <div style="display:flex;align-items:center;gap:12px;padding:10px 14px;background:var(--bg-surface);border-radius:var(--radius-sm);border:1px solid var(--border)">
            <span class="badge badge-confirmed">✓ Active</span>
            <span style="font-size:0.85rem;font-family:monospace">${r.rule}</span>
          </div>`).join('')}
        </div>
      </div>
    `;
    },

    organize() {
        App.showToast('info', '⚡ Organizing files in Drive...');
        setTimeout(() => App.showToast('success', `✅ ${MockData.driveFiles.length} files organized into structured folders!`), 2000);
    },

    disconnect() {
        App.showToast('info', 'Google Drive disconnected.');
    },

    openDrive() {
        App.showToast('info', '↗ Opening Google Drive (requires authentication)');
    }
};
