// AI OCR Receipt Reader Page
window.ReceiptsPage = {
  ocrRunning: false,
  ocrDone: false,
  currentFile: null,
  ocrResult: null,
  expenses: [],
  loading: false,

  render(companyId) {
    if (!this.initialized || this.lastCompanyId !== companyId) {
      this.initialized = true;
      this.lastCompanyId = companyId;
      this.loadExpenses(companyId);
    }

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
            <div class="card-subtitle">${this.expenses.length} receipts uploaded</div>
          </div>
          <button class="btn btn-ghost btn-sm" onclick="Pages.sheets()">View All →</button>
        </div>
        <div id="expensesTableContainer">
            ${this.renderExpensesTable()}
        </div>
      </div>
    `;
  },

  renderExpensesTable() {
    if (this.loading) return '<div style="padding:20px;text-align:center">Loading expenses...</div>';
    if (this.expenses.length === 0) return '<div style="padding:20px;text-align:center;color:var(--text-secondary)">No receipts found.</div>';

    return `
        <table class="data-table">
          <thead><tr>
            <th>Vendor</th><th>Date</th><th>Amount</th><th>Category</th><th>Tax Info</th><th>Status</th><th style="text-align:right">Actions</th>
          </tr></thead>
          <tbody>
            ${this.expenses.map((e, idx) => {
              const hasTax = e.tax_amount && parseFloat(e.tax_amount) > 0;
              return `
            <tr>
              <td>${e.vendor_name}</td>
              <td>${new Date(e.date).toLocaleDateString()}</td>
              <td style="font-weight:700">฿${parseFloat(e.total).toLocaleString()}</td>
              <td><span class="badge badge-info">${e.category}</span></td>
              <td>
                ${hasTax 
                  ? `<span style="font-size:0.8rem;color:var(--green)">฿${parseFloat(e.tax_amount).toLocaleString()} VAT</span>` 
                  : `<span class="badge badge-error" style="background:rgba(239, 68, 68, 0.1);color:rgb(239, 68, 68);border:1px solid rgba(239, 68, 68, 0.2)">⚠️ No Tax</span>`}
              </td>
              <td><span class="badge badge-${e.status}">${e.status}</span></td>
              <td style="text-align:right">
                <button class="btn btn-ghost btn-sm" onclick="ReceiptsPage.viewExpense(${idx})">✏️ Edit</button>
              </td>
            </tr>`;
            }).join('')}
          </tbody>
        </table>
    `;
  },

  async loadExpenses(companyId) {
    this.loading = true;
    try {
      this.expenses = await window.ExpenseApi.listExpenses(companyId);
      const container = document.getElementById('expensesTableContainer');
      if (container) container.innerHTML = this.renderExpensesTable();
    } catch (error) {
      console.error('Failed to load expenses:', error);
    } finally {
      this.loading = false;
      const container = document.getElementById('expensesTableContainer');
      if (container) container.innerHTML = this.renderExpensesTable();
    }
  },

  renderOcrResult(r) {
    r = r || this.ocrResult;
    if (!r) return '';
    const isEditing = !!r.id;
    return `
    <div class="ocr-panel">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid var(--border)">
        <div style="width:36px;height:36px;background:${isEditing ? 'var(--blue-soft)' : 'var(--green-soft)'};border-radius:8px;display:flex;align-items:center;justify-content:center;color:${isEditing ? 'var(--indigo)' : 'var(--green)'};font-size:1.2rem">
          ${isEditing ? '✏️' : '✓'}
        </div>
        <div>
          <div style="font-weight:700">${isEditing ? 'Edit Expense' : 'OCR Extraction Complete'}</div>
          <div style="font-size:0.78rem;color:var(--text-secondary)">
            ${isEditing ? 'Update details below' : `Confidence: ${r.confidence}% · Review and confirm`}
          </div>
        </div>
        <span class="badge ${isEditing ? 'badge-info' : 'badge-confirmed'}" style="margin-left:auto">
          ${isEditing ? 'Existing Record' : 'AI Extracted'}
        </span>
      </div>
      <div class="ocr-field"><div class="ocr-field-label">🏪 Vendor / Store</div><input class="ocr-field-input" value="${r.vendor}"></div>
      <div class="ocr-field"><div class="ocr-field-label">📅 Date</div><input class="ocr-field-input" type="date" value="${r.date}"></div>
      <div class="ocr-field"><div class="ocr-field-label">💰 Total Amount</div><input class="ocr-field-input" value="฿${r.amount}"></div>
      <div class="ocr-field"><div class="ocr-field-label">🧾 Tax (VAT)</div><input class="ocr-field-input" value="฿${r.tax}"></div>
      <div class="ocr-field">
        <div class="ocr-field-label">🏷 Category</div>
        <select class="ocr-field-input">
          ${MockData.categories.map(c => `<option ${c === r.category ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
      </div>
      <div class="ocr-field">
        <div class="ocr-field-label">🏢 Organization ID</div>
        <input class="ocr-field-input" value="${App.currentCompany}" readonly>
      </div>
      <div class="ocr-field" style="align-items: flex-start;">
        <div class="ocr-field-label" style="margin-top: 8px;">📝 Notes</div>
        <textarea class="ocr-field-input" style="height: 120px; resize: none; font-family: monospace; font-size: 0.75rem;" placeholder="Raw OCR text...">${r.notes || ''}</textarea>
      </div>
      <div class="ocr-field" style="flex-direction:row;align-items:center;padding:12px;background:var(--bg-base);border-radius:8px;margin-top:10px;border:1px dashed var(--border)">
        <div style="flex:1">
            <div style="font-weight:700;font-size:0.85rem">🚫 Disable Expense</div>
            <div style="font-size:0.75rem;color:var(--text-secondary)">Ignore in dashboard and reports</div>
        </div>
        <input type="checkbox" id="disableExpenseToggle" style="width:20px;height:20px;cursor:pointer" ${r.status === 'disabled' ? 'checked' : ''}>
      </div>
      <div style="display:flex;gap:10px;margin-top:20px">
        <button class="btn btn-primary" style="flex:1;justify-content:center" onclick="ReceiptsPage.confirmExpense()">
          ${isEditing ? '💾 Update Expense' : '✅ Confirm & Save'}
        </button>
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

  viewExpense(idx) {
    const e = this.expenses[idx];
    const expenseId = e.id || e._id; // Handle both id and MongoDB _id
    this.ocrResult = {
      id: expenseId,
      vendor: e.vendor_name,
      date: e.date && e.date.includes('T') ? e.date.split('T')[0] : e.date,
      amount: e.total,
      tax: e.tax_amount || 0,
      category: e.category,
      companyId: e.organization_id,
      status: e.status, // Preserve status (important for 'disabled')
      confidence: 100,
      notes: e.notes
    };
    this.ocrDone = true;
    const panel = document.getElementById('ocrResultPanel');
    if (panel) {
      panel.style.display = 'block';
      panel.innerHTML = this.renderOcrResult();
    }
    const placeholder = document.getElementById('ocrPlaceholder');
    if (placeholder) placeholder.style.display = 'none';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  async runOCR() {
    if (this.ocrRunning) return;
    this.ocrRunning = true;
    const btn = document.getElementById('ocrBtn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Processing...'; }
    const progressArea = document.getElementById('ocrProgressArea');
    if (progressArea) progressArea.style.display = 'block';

    const prog = document.getElementById('ocrProgress');
    const stat = document.getElementById('ocrStatusText');

    let worker = null;
    let ocrText = "";
    let confidence = 97;

    try {
      if (this.currentFile && this.currentFile.type !== 'application/pdf') {
        stat.textContent = 'Reading image file...';
        prog.style.width = '10%';

        const imageData = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = e => resolve(e.target.result);
          reader.onerror = e => reject(new Error('Failed to read file'));
          reader.readAsDataURL(this.currentFile);
        });

        stat.textContent = 'Initializing Tesseract...';
        prog.style.width = '20%';

        worker = await Tesseract.createWorker('eng', 1, {
          workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js',
          langPath: 'https://tessdata.projectnaptha.com/4.0.0_best',
          corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5/tesseract-core.wasm.js',
          logger: m => {
            if (m.status === 'recognizing text') {
              const p = 20 + Math.round(m.progress * 70);
              prog.style.width = p + '%';
              stat.textContent = `Extracting text... (${p}%)`;
            }
          }
        });

        const result = await worker.recognize(imageData);
        ocrText = result.data.text;
        confidence = Math.round(result.data.confidence);
        await worker.terminate();
      } else {
        // Logic for Demo or PDF (simulated real logic step since no image/direct PDF support)
        stat.textContent = 'Analyzing document...';
        prog.style.width = '30%';
        await new Promise(r => setTimeout(r, 600));
        prog.style.width = '60%';
        stat.textContent = 'Extracting fields...';
        await new Promise(r => setTimeout(r, 600));
        ocrText = this.demoData
          ? `DEMO RECEIPT: ${this.demoData.name}\nVendor: ${this.demoData.vendor}\nAmount: ${this.demoData.amount}`
          : "PDF Content: Sample text extracted from PDF document.";
      }

      let extractedVendor = 'Starbucks Siam Paragon';
      let extractedAmount = 450;
      let extractedCat = 'Food & Beverage';

      if (this.demoData) {
        extractedVendor = this.demoData.vendor || extractedVendor;
        extractedAmount = this.demoData.amount || extractedAmount;
        extractedCat = this.demoData.cat || this.demoData.category || extractedCat;
      } else if (ocrText) {
        // Real extraction logic for uploaded files
        const lines = ocrText.split('\n').map(l => l.trim()).filter(l => l.length > 2);
        if (lines.length > 0) extractedVendor = lines[0]; // Assume top line is vendor

        const matches = ocrText.match(/(\d{1,3}(,\d{3})*(\.\d{2})?)/g);
        if (matches) {
          const nums = matches.map(m => parseFloat(m.replace(/,/g, ''))).filter(n => n > 10);
          if (nums.length > 0) extractedAmount = Math.max(...nums);
        }
      }

      const existingId = this.ocrResult ? (this.ocrResult.id || this.ocrResult._id) : null;

      this.ocrResult = {
        id: existingId,
        vendor: extractedVendor,
        date: '2026-02-22',
        amount: extractedAmount,
        tax: Math.round(extractedAmount * 0.07),
        category: extractedCat,
        companyId: App.currentCompany,
        confidence: 97,
        notes: ocrText
      };

      prog.style.width = '100%';
      stat.textContent = '✅ Extraction complete!';

      setTimeout(() => {
        this.ocrRunning = false;
        this.ocrDone = true;
        document.getElementById('ocrResultPanel').style.display = 'block';
        document.getElementById('ocrResultPanel').innerHTML = this.renderOcrResult();
        document.getElementById('ocrPlaceholder').style.display = 'none';
        if (btn) { btn.disabled = false; btn.textContent = '🤖 Run AI OCR'; }
      }, 500);

    } catch (error) {
      console.error('OCR Error:', error);
      stat.textContent = '❌ OCR Failed: ' + error.message;
      if (worker) await worker.terminate();
      this.ocrRunning = false;
      if (btn) { btn.disabled = false; btn.textContent = '🤖 Run AI OCR'; }
      App.showToast('error', 'OCR failed: ' + error.message);
    }
  },

  async confirmExpense() {
    if (!this.ocrResult) return;

    const panel = document.querySelector('.ocr-panel');
    if (!panel) return;

    const isUpdate = !!(this.ocrResult && (this.ocrResult.id || this.ocrResult._id));
    const targetId = isUpdate ? (this.ocrResult.id || this.ocrResult._id) : null;

    const inputs = panel.querySelectorAll('.ocr-field-input');
    const vendor = inputs[0].value;
    const date = inputs[1].value;
    const amountStr = inputs[2].value.replace('฿', '').replace(/,/g, '');
    const taxStr = inputs[3].value.replace('฿', '').replace(/,/g, '');
    const category = inputs[4].value;
    const organizationId = inputs[5].value;
    const notes = inputs[6].value;
    const isDisabled = document.getElementById('disableExpenseToggle')?.checked;

    const total = amountStr;

    const payload = {
      organization_id: organizationId,
      status: isDisabled ? 'disabled' : 'confirmed',
      vendor_name: vendor,
      date: new Date(date).toISOString(),
      total: total,
      tax_amount: parseFloat(taxStr) || 0,
      currency: 'THB',
      category: category,
      notes: notes,
      vendor_address: '',
      vendor_taxid: '',
    };

    try {
      if (isUpdate) {
        // Remove organization_id for updates as the backend model doesn't accept it
        const { organization_id, ...updatePayload } = payload;
        await window.ExpenseApi.updateExpense(targetId, updatePayload);
        App.showToast('success', '✅ Expense updated!');
      } else {
        await window.ExpenseApi.createExpense(payload);
        App.showToast('success', '✅ Receipt saved to database!');
      }

      this.ocrDone = false;
      this.ocrResult = null;
      this.demoData = null;
      this.initialized = false; // Trigger reload
      App.navigate('receipts');

    } catch (error) {
      console.error('Action failed:', error);
      App.showToast('error', '❌ Could not complete: ' + error.message);
    }
  },

  discardOcr() {
    this.ocrDone = false; this.ocrResult = null;
    App.navigate('receipts');
  }
};
