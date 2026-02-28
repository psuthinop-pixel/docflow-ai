// AI OCR Receipt Reader Page
window.ReceiptsPage = {
  ocrRunning: false,
  ocrDone: false,
  currentFile: null,
  ocrResult: null,

  render(companyId) {
    return `
      <div class="page-header">
        <div class="page-header-left">
          <h1>🔍 AI OCR Receipt Reader</h1>
          <p>Upload a receipt image or PDF — AI extracts all data automatically</p>
        </div>
      </div>

      <div class="grid-2" style="margin-bottom:20px">
        <div>
          <div class="upload-zone" id="uploadZone" ondragover="ReceiptsPage.onDragOver(event)" ondragleave="ReceiptsPage.onDragLeave(event)" ondrop="ReceiptsPage.onDrop(event)">
            <input type="file" accept="image/*,.pdf" onchange="ReceiptsPage.onFileSelect(event)" id="fileInput">
            <span class="upload-zone-icon">📤</span>
            <h3>Drop receipt here or click to browse</h3>
            <p>Supports JPG, PNG, PDF · Max 10 MB</p>
            <div style="margin-top:16px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
              <span class="badge badge-info">📷 Photo</span>
              <span class="badge badge-info">📄 PDF</span>
              <span class="badge badge-info">🖼 Screenshot</span>
            </div>
          </div>

          <div id="filePreview" style="display:none;margin-top:16px">
            <div class="card" id="previewCard">
              <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
                <span style="font-size:2rem" id="previewIcon">📄</span>
                <div style="flex:1">
                  <div style="font-weight:700" id="previewName">receipt.jpg</div>
                  <div style="font-size:0.78rem;color:var(--text-secondary)" id="previewSize">2.1 MB</div>
                </div>
                <button class="btn btn-primary" id="ocrBtn" onclick="ReceiptsPage.runOCR()">🤖 Run AI OCR</button>
              </div>
              <div id="ocrProgressArea" style="display:none">
                <div style="font-size:0.8rem;color:var(--text-secondary);margin-bottom:6px" id="ocrStatusText">Initializing AI...</div>
                <div class="progress-bar"><div class="progress-fill" id="ocrProgress" style="width:0%"></div></div>
              </div>
            </div>
          </div>

          <div class="card" style="margin-top:16px">
            <div class="card-header">
              <div class="card-title">📋 Demo Receipts</div>
            </div>
            <p style="font-size:0.82rem;color:var(--text-secondary);margin-bottom:12px">Click to simulate a real receipt being processed:</p>
            <div style="display:flex;flex-direction:column;gap:8px">
              ${[
        { name: 'Starbucks_receipt.jpg', vendor: 'Starbucks Siam Paragon', amount: 450, cat: 'Food & Beverage' },
        { name: 'AWS_invoice_feb.pdf', vendor: 'Amazon Web Services', amount: 8450, cat: 'Software & SaaS' },
        { name: 'Grab_feb17.png', vendor: 'Grab Thailand', amount: 320, cat: 'Transport' },
      ].map(r => `
              <button class="btn btn-secondary" style="justify-content:space-between;text-align:left" onclick="ReceiptsPage.loadDemo(${JSON.stringify(r).replace(/"/g, '&quot;')})">
                <span>📄 ${r.name}</span>
                <span class="badge badge-info">${r.cat}</span>
              </button>`).join('')}
            </div>
          </div>
        </div>

        <div id="ocrResultPanel" style="display:${this.ocrDone ? 'block' : 'none'}">
          ${this.renderOcrResult()}
        </div>
        <div id="ocrPlaceholder" style="${this.ocrDone ? 'display:none' : ''}">
          <div class="card" style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:300px;text-align:center">
            <div style="font-size:3rem;margin-bottom:16px">🤖</div>
            <div style="font-size:1.1rem;font-weight:700;margin-bottom:8px">AI OCR Ready</div>
            <p style="font-size:0.85rem;color:var(--text-secondary);max-width:240px">Upload a receipt or select a demo to see extracted data appear here</p>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">💳 Processed Receipts</div>
            <div class="card-subtitle">${MockData.expenses.filter(e => e.source === 'upload').length} receipts uploaded this month</div>
          </div>
          <button class="btn btn-ghost btn-sm" onclick="Pages.sheets()">View All →</button>
        </div>
        <table class="data-table">
          <thead><tr>
            <th>Vendor</th><th>Date</th><th>Amount</th><th>Category</th><th>Status</th>
          </tr></thead>
          <tbody>
            ${MockData.expenses.filter(e => e.source === 'upload').map(e => `
            <tr>
              <td>${e.vendor}</td>
              <td>${e.date}</td>
              <td style="font-weight:700">฿${e.amount.toLocaleString()}</td>
              <td><span class="badge badge-info">${e.category}</span></td>
              <td><span class="badge badge-${e.status}">${e.status}</span></td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    `;
  },

  renderOcrResult(r) {
    r = r || this.ocrResult;
    if (!r) return '';
    return `
    <div class="ocr-panel">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid var(--border)">
        <div style="width:36px;height:36px;background:var(--green-soft);border-radius:8px;display:flex;align-items:center;justify-content:center;color:var(--green);font-size:1.2rem">✓</div>
        <div>
          <div style="font-weight:700">OCR Extraction Complete</div>
          <div style="font-size:0.78rem;color:var(--text-secondary)">Confidence: ${r.confidence}% · Review and confirm</div>
        </div>
        <span class="badge badge-confirmed" style="margin-left:auto">AI Extracted</span>
      </div>
      <div class="ocr-field"><div class="ocr-field-label">🏪 Vendor / Store</div><input class="ocr-field-input" value="${r.vendor}"></div>
      <div class="ocr-field"><div class="ocr-field-label">📅 Date</div><input class="ocr-field-input" type="date" value="${r.date}"></div>
      <div class="ocr-field"><div class="ocr-field-label">💰 Amount</div><input class="ocr-field-input" value="฿${r.amount}"></div>
      <div class="ocr-field"><div class="ocr-field-label">🧾 Tax (VAT)</div><input class="ocr-field-input" value="฿${r.tax}"></div>
      <div class="ocr-field">
        <div class="ocr-field-label">🏷 Category</div>
        <select class="ocr-field-input">
          ${MockData.categories.map(c => `<option ${c === r.category ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
      </div>
      <div class="ocr-field">
        <div class="ocr-field-label">🏢 Company</div>
        <select class="ocr-field-input">
          ${MockData.companies.map(c => `<option value="${c.id}" ${c.id === r.companyId ? 'selected' : ''}>${c.name}</option>`).join('')}
        </select>
      </div>
      <div class="ocr-field"><div class="ocr-field-label">📝 Notes</div><input class="ocr-field-input" placeholder="Optional notes..." value="${r.notes || ''}"></div>
      <div style="display:flex;gap:10px;margin-top:20px">
        <button class="btn btn-primary" style="flex:1;justify-content:center" onclick="ReceiptsPage.confirmExpense()">✅ Confirm & Save</button>
        <button class="btn btn-ghost" onclick="ReceiptsPage.discardOcr()">🗑 Discard</button>
      </div>
    </div>`;
  },

  onDragOver(e) {
    e.preventDefault();
    document.getElementById('uploadZone').classList.add('dragover');
  },
  onDragLeave() { document.getElementById('uploadZone').classList.remove('dragover'); },
  onDrop(e) {
    e.preventDefault();
    document.getElementById('uploadZone').classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) this.showFile(file);
  },
  onFileSelect(e) {
    const file = e.target.files[0];
    if (file) this.showFile(file);
  },
  showFile(file) {
    this.currentFile = file;
    document.getElementById('filePreview').style.display = 'block';
    document.getElementById('previewName').textContent = file.name;
    document.getElementById('previewSize').textContent = (file.size / 1024).toFixed(0) + ' KB';
    document.getElementById('previewIcon').textContent = file.type === 'application/pdf' ? '📄' : '🖼️';
  },
  loadDemo(data) {
    document.getElementById('filePreview').style.display = 'block';
    document.getElementById('previewName').textContent = data.name;
    document.getElementById('previewSize').textContent = '1.2 MB';
    document.getElementById('previewIcon').textContent = data.name.endsWith('.pdf') ? '📄' : '🖼️';
    this.demoData = data;
    this.runOCR();
  },

  runOCR() {
    if (this.ocrRunning) return;
    this.ocrRunning = true;
    const btn = document.getElementById('ocrBtn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Processing...'; }
    const progressArea = document.getElementById('ocrProgressArea');
    if (progressArea) progressArea.style.display = 'block';
    const steps = [
      { p: 15, msg: 'Preprocessing image...' },
      { p: 35, msg: 'Detecting text regions...' },
      { p: 55, msg: 'Extracting key fields with GPT-4o Vision...' },
      { p: 75, msg: 'Auto-categorizing expense...' },
      { p: 90, msg: 'Validating extracted data...' },
      { p: 100, msg: '✅ Extraction complete!' },
    ];
    let i = 0;
    const iv = setInterval(() => {
      if (i >= steps.length) {
        clearInterval(iv);
        this.ocrRunning = false;
        this.ocrDone = true;
        const demo = this.demoData || { vendor: 'Unknown Vendor', amount: 0, cat: 'Other' };
        this.ocrResult = {
          vendor: demo.vendor || 'Starbucks Siam Paragon',
          date: '2026-02-22',
          amount: demo.amount || 450,
          tax: Math.round((demo.amount || 450) * 0.07),
          category: demo.cat || demo.category || 'Food & Beverage',
          companyId: 'c1',
          confidence: 97,
          notes: ''
        };
        document.getElementById('ocrResultPanel').style.display = 'block';
        document.getElementById('ocrResultPanel').innerHTML = this.renderOcrResult();
        document.getElementById('ocrPlaceholder').style.display = 'none';
        if (btn) { btn.disabled = false; btn.textContent = '🤖 Run AI OCR'; }
        return;
      }
      const prog = document.getElementById('ocrProgress');
      const stat = document.getElementById('ocrStatusText');
      if (prog) prog.style.width = steps[i].p + '%';
      if (stat) stat.textContent = steps[i].msg;
      i++;
    }, 450);
  },

  async confirmExpense() {
    if (!this.ocrResult) return;

    // Collect current data from form fields (in case user edited them)
    const panel = document.querySelector('.ocr-panel');
    if (!panel) return;

    const inputs = panel.querySelectorAll('.ocr-field-input');
    const vendor = inputs[0].value;
    const date = inputs[1].value;
    const amountStr = inputs[2].value.replace('฿', '').replace(/,/g, '');
    const taxStr = inputs[3].value.replace('฿', '').replace(/,/g, '');
    const category = inputs[4].value;
    const companyId = inputs[5].value;

    const amount = parseFloat(amountStr) || 0;
    const tax = parseFloat(taxStr) || 0;

    // Map companyId to company name for the backend
    const company = MockData.companies.find(c => c.id === companyId);
    const companyName = company ? company.name : 'Unknown Company';

    // Construct payload for backend (FastAPI expects vendor_name, date, amount, tax, category, company, etc.)
    const payload = {
      vendor_name: vendor,
      date: new Date(date).toISOString(),
      amount: amount,
      tax: tax,
      category: category,
      company: companyName,
      notes: inputs[6].value || '',
      file_dir: `/uploads/expenses/${date}_${vendor.toLowerCase().replace(/\s+/g, '_')}.pdf`
    };

    try {
      // Call API Service
      await window.ExpenseApi.createExpense(payload);

      // Success: Update UI and MockData (for demo consistency)
      MockData.expenses.unshift({
        id: 'e_new_' + Date.now(),
        companyId: companyId,
        vendor: vendor,
        date: date,
        amount: amount,
        currency: 'THB',
        category: category,
        status: 'confirmed',
        source: 'upload',
        tax: tax,
      });

      MockData.activity.unshift({
        type: 'ocr',
        icon: '🔍',
        text: `OCR processed: ${vendor} — ฿${amount.toLocaleString()}`,
        time: 'Just now',
        company: companyId
      });

      App.showToast('success', '✅ Receipt saved to database!');
      this.ocrDone = false;
      this.ocrResult = null;
      this.demoData = null;
      App.navigate('receipts');

    } catch (error) {
      console.error('Save failed:', error);
      App.showToast('error', '❌ Could not save to backend. Please check connection.');
    }
  },

  discardOcr() {
    this.ocrDone = false; this.ocrResult = null;
    App.navigate('receipts');
  }
};
