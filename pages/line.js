// LINE Chatbot Workflow Page
window.LinePage = {
    render(companyId) {
        const msgs = MockData.lineMessages;
        return `
      <div class="page-header">
        <div class="page-header-left">
          <h1>💬 LINE Chatbot Workflow</h1>
          <p>Receive and import receipts sent via LINE Messaging API</p>
        </div>
        <button class="btn btn-primary" onclick="LinePage.reconnect()">🔄 Reconnect Bot</button>
      </div>

      <div class="grid-2" style="margin-bottom:20px">
        <div class="integration-card card-glow">
          <div class="integration-logo" style="background:linear-gradient(135deg,#00b900,#00d900);font-size:1.8rem">💬</div>
          <div class="integration-info">
            <div class="integration-name">DocFlow LINE Bot</div>
            <div class="integration-desc">@docflow_bot · Channel ID: 2006xxxxxx</div>
            <div style="margin-top:6px">
              <div class="integration-status status-connected" style="display:inline-flex">
                <div class="status-dot"></div>
                <span style="color:var(--green);font-size:0.78rem">Active & Listening</span>
              </div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-title" style="margin-bottom:12px">🔗 Webhook Configuration</div>
          <div class="form-group" style="margin-bottom:10px">
            <div class="form-label">Webhook URL</div>
            <div class="form-input-group">
              <input class="form-input" style="font-size:0.78rem;font-family:monospace" readonly value="https://docflow.ai/api/line/webhook">
              <button class="btn btn-secondary btn-sm" onclick="App.showToast('info','📋 Copied to clipboard!')">Copy</button>
            </div>
          </div>
          <div class="form-group" style="margin-bottom:0">
            <div class="form-label">QR Code — Share with team</div>
            <div style="width:80px;height:80px;background:white;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:2.5rem">🟦</div>
          </div>
        </div>
      </div>

      <div class="grid-3" style="margin-bottom:20px">
        ${[
                { label: 'Messages Today', value: '7', icon: '💬', color: 'accent' },
                { label: 'Receipts Received', value: '4', icon: '🧾', color: 'green' },
                { label: 'Pending Import', value: '2', icon: '⏳', color: 'amber' },
            ].map(s => `
        <div class="card" style="text-align:center">
          <div style="font-size:1.8rem;margin-bottom:6px">${s.icon}</div>
          <div style="font-size:1.8rem;font-weight:800">${s.value}</div>
          <div style="font-size:0.8rem;color:var(--text-secondary);margin-top:4px">${s.label}</div>
        </div>`).join('')}
      </div>

      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">📨 Recent Messages</div>
            <div class="card-subtitle">Receipts and documents sent by team members</div>
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            <span style="font-size:0.8rem;color:var(--text-secondary)">${msgs.filter(m => m.status === 'pending').length} pending</span>
            <button class="btn btn-primary btn-sm" onclick="LinePage.importAll()">Import All Pending</button>
          </div>
        </div>
        ${msgs.map(m => `
        <div class="line-message">
          <div class="line-avatar">${m.avatar}</div>
          <div style="flex:1">
            <div class="line-bubble">
              <div class="line-sender">${m.sender} <span style="font-size:0.72rem;color:var(--text-muted);font-weight:400">· ${m.time}</span></div>
              <div class="line-text">${m.message}</div>
              <div style="display:flex;align-items:center;gap:8px;margin-top:6px;padding:8px;background:rgba(255,255,255,0.04);border-radius:6px">
                <span style="font-size:1.2rem">🧾</span>
                <div style="flex:1">
                  <div style="font-size:0.82rem;font-weight:600">${m.vendor}</div>
                  <div style="font-size:0.78rem;color:var(--text-secondary)">฿${m.amount.toLocaleString()} · ${m.category}</div>
                </div>
              </div>
            </div>
            <div class="line-meta">
              <span class="badge badge-${m.status === 'imported' ? 'confirmed' : 'pending'}">${m.status === 'imported' ? '✓ Imported' : '⏳ Pending'}</span>
              ${m.status === 'pending' ? `<button class="btn btn-primary btn-sm" onclick="LinePage.importMsg('${m.id}')">Import</button>` : ''}
              <button class="btn btn-ghost btn-sm">View</button>
            </div>
          </div>
        </div>`).join('')}
      </div>

      <div class="card" style="margin-top:20px;background:var(--amber-soft);border-color:rgba(245,158,11,0.3)">
        <div style="display:flex;align-items:center;gap:12px">
          <span style="font-size:1.5rem">💡</span>
          <div>
            <div style="font-weight:700;color:var(--amber)">How to use the LINE Bot</div>
            <div style="font-size:0.82rem;color:var(--text-secondary);margin-top:4px">
              Add <strong>@docflow_bot</strong> as a LINE friend → Send a photo of any receipt → The bot auto-OCRs it and queues it here for review → Click "Import" to add to your expense database.
            </div>
          </div>
        </div>
      </div>
    `;
    },

    importMsg(id) {
        const msg = MockData.lineMessages.find(m => m.id === id);
        if (msg) {
            msg.status = 'imported';
            App.showToast('success', `✅ Receipt from ${msg.sender} imported!`);
            App.navigate('line');
        }
    },

    importAll() {
        MockData.lineMessages.filter(m => m.status === 'pending').forEach(m => m.status = 'imported');
        App.showToast('success', '✅ All pending receipts imported!');
        App.navigate('line');
    },

    reconnect() {
        App.showToast('info', '🔄 Reconnecting LINE Bot webhook...');
        setTimeout(() => App.showToast('success', '✅ LINE Bot reconnected successfully!'), 1500);
    }
};
