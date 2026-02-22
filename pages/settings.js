// Settings Page
window.SettingsPage = {
    render(companyId) {
        return `
      <div class="page-header">
        <div class="page-header-left">
          <h1>⚙️ Settings</h1>
          <p>API keys, integrations, company management, and preferences</p>
        </div>
        <button class="btn btn-primary" onclick="SettingsPage.saveAll()">💾 Save All</button>
      </div>

      <div class="settings-section">
        <div class="settings-title">🤖 AI & OCR</div>
        <div class="settings-subtitle">API credentials for AI-powered receipt reading</div>
        <div class="form-group">
          <div class="form-label">OpenAI API Key</div>
          <div class="form-input-group">
            <input class="form-input api-key-input" type="password" id="openai_key" placeholder="sk-proj-..." value="sk-proj-••••••••••••••••">
            <button class="btn btn-secondary btn-sm" onclick="SettingsPage.toggleKey('openai_key')">👁</button>
            <button class="btn btn-green btn-sm" onclick="SettingsPage.testKey('OpenAI')">Test</button>
          </div>
        </div>
        <div class="form-group" style="margin-bottom:0">
          <div class="form-label">OCR Model</div>
          <select class="form-select" style="width:auto;max-width:300px">
            <option selected>gpt-4o (Vision)</option>
            <option>gpt-4-turbo (Vision)</option>
            <option>Google Cloud Vision API</option>
          </select>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-title">📧 Gmail / Email Scraper</div>
        <div class="settings-subtitle">OAuth credentials for inbox scanning</div>
        <div class="form-group">
          <div class="form-label">Gmail OAuth Client ID</div>
          <input class="form-input api-key-input" type="password" placeholder="xxxxxx.apps.googleusercontent.com" value="••••••••••••.apps.googleusercontent.com">
        </div>
        <div class="form-group">
          <div class="form-label">Scan Frequency</div>
          <select class="form-select" style="width:auto">
            <option selected>Every 2 hours</option>
            <option>Every 6 hours</option>
            <option>Every 24 hours</option>
            <option>Manual only</option>
          </select>
        </div>
        <div class="form-group" style="margin-bottom:0">
          <div class="form-label">Filter Keywords</div>
          <input class="form-input" value="invoice, receipt, ใบเสร็จ, ใบกำกับ, order, payment" placeholder="Comma-separated keywords">
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-title">💬 LINE Messaging API</div>
        <div class="settings-subtitle">Channel credentials for LINE Bot receipt workflow</div>
        <div class="form-group">
          <div class="form-label">Channel Access Token</div>
          <div class="form-input-group">
            <input class="form-input api-key-input" type="password" id="line_token" placeholder="LINE Channel Access Token" value="••••••••••••••••••••••••">
            <button class="btn btn-secondary btn-sm" onclick="SettingsPage.toggleKey('line_token')">👁</button>
            <button class="btn btn-green btn-sm" onclick="SettingsPage.testKey('LINE')">Test</button>
          </div>
        </div>
        <div class="form-group" style="margin-bottom:0">
          <div class="form-label">Channel Secret</div>
          <input class="form-input api-key-input" type="password" placeholder="LINE Channel Secret" value="••••••••••••••••">
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-title">📁 Google Drive & Sheets</div>
        <div class="settings-subtitle">Service account credentials for Drive and Sheets access</div>
        <div class="form-group">
          <div class="form-label">Service Account JSON</div>
          <div style="display:flex;gap:10px;align-items:flex-start">
            <textarea class="form-input" rows="3" placeholder='{"type":"service_account","project_id":"..."}' style="flex:1;resize:none;font-family:monospace;font-size:0.78rem">{"type":"service_account","project_id":"docflow-ai","private_key":"[HIDDEN]",...}</textarea>
            <button class="btn btn-green btn-sm" onclick="SettingsPage.testKey('Google')">Test</button>
          </div>
        </div>
        <div class="form-group">
          <div class="form-label">Google Sheet ID</div>
          <input class="form-input api-key-input" placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms" value="1BxiMVs0XRA5nFMdKvBdBZjg••••••••••••••">
        </div>
        <div class="form-group" style="margin-bottom:0">
          <div class="form-label">Root Drive Folder ID</div>
          <input class="form-input api-key-input" placeholder="Google Drive Folder ID" value="1a2b3c4d5e••••••••••••">
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-title">🏢 Company Management</div>
        <div class="settings-subtitle">Add, edit, or remove companies for multi-company tracking</div>
        <div id="companyList" style="display:flex;flex-direction:column;gap:10px;margin-bottom:14px">
          ${MockData.companies.map(comp => `
          <div style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--radius-sm)">
            <div style="width:28px;height:28px;border-radius:8px;background:${comp.color};display:flex;align-items:center;justify-content:center;font-size:0.8rem;font-weight:700;color:white">${comp.short}</div>
            <input class="form-input" value="${comp.name}" style="flex:1">
            <input type="color" value="${comp.color}" style="width:36px;height:36px;border:none;border-radius:6px;background:transparent;cursor:pointer" onchange="SettingsPage.updateColor('${comp.id}',this.value)">
            <button class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="SettingsPage.removeCompany('${comp.id}')">🗑</button>
          </div>`).join('')}
        </div>
        <button class="btn btn-secondary" onclick="SettingsPage.addCompany()">+ Add Company</button>
      </div>

      <div class="settings-section">
        <div class="settings-title">🌐 Preferences</div>
        <div class="settings-subtitle">Regional settings and display options</div>
        <div class="grid-2">
          <div class="form-group">
            <div class="form-label">Default Currency</div>
            <select class="form-select">
              <option selected>THB (฿)</option>
              <option>USD ($)</option>
              <option>EUR (€)</option>
            </select>
          </div>
          <div class="form-group">
            <div class="form-label">Date Format</div>
            <select class="form-select">
              <option selected>YYYY-MM-DD</option>
              <option>DD/MM/YYYY</option>
              <option>MM/DD/YYYY</option>
            </select>
          </div>
          <div class="form-group">
            <div class="form-label">Language</div>
            <select class="form-select">
              <option selected>English</option>
              <option>ภาษาไทย</option>
            </select>
          </div>
          <div class="form-group">
            <div class="form-label">VAT Rate</div>
            <input class="form-input" value="7" type="number" min="0" max="100">
          </div>
        </div>
      </div>

      <div class="settings-section" style="border-color:rgba(239,68,68,0.2)">
        <div class="settings-title" style="color:var(--red)">⚠️ Danger Zone</div>
        <div class="settings-subtitle">Irreversible actions — proceed with caution</div>
        <div style="display:flex;gap:10px">
          <button class="btn btn-secondary btn-sm" onclick="SheetsPage.export()">📤 Export All Data (CSV)</button>
          <button class="btn btn-secondary btn-sm" style="border-color:rgba(239,68,68,0.4);color:var(--red)" onclick="SettingsPage.clearData()">🗑 Clear All Data</button>
        </div>
      </div>
    `;
    },

    toggleKey(id) {
        const el = document.getElementById(id);
        if (el) el.type = el.type === 'password' ? 'text' : 'password';
    },

    testKey(service) {
        App.showToast('info', `🔄 Testing ${service} connection...`);
        setTimeout(() => App.showToast('success', `✅ ${service} API connected successfully!`), 1200);
    },

    saveAll() {
        App.showToast('success', '💾 All settings saved successfully!');
    },

    addCompany() {
        App.showToast('info', '+ Add company feature — use the modal in full version');
    },

    removeCompany(id) {
        App.showToast('info', `🗑 Company ${id} removed (mock mode)`);
    },

    updateColor(id, color) {
        const comp = MockData.companies.find(c => c.id === id);
        if (comp) { comp.color = color; App.updateCompanyDot(); }
    },

    clearData() {
        if (confirm('⚠️ Clear all expense data? This cannot be undone.')) {
            App.showToast('info', 'Data cleared (mock mode — no real data was deleted)');
        }
    }
};
