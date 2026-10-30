// AI OCR Receipt Reader Page
window.ReceiptsPage = {
  ocrRunning: false,
  ocrDone: false,
  currentFile: null,
  ocrResult: null,
  expenses: [],
  loading: false,
  statusFilter: 'all',
  fxEdited: null, // 'total_thb' or 'fx_rate': whichever FX input the owner typed in last
  currencies: ['THB', 'USD', 'EUR', 'GBP', 'SGD', 'HKD', 'JPY', 'CNY', 'AUD'],

  render(companyId) {
    // Refetch on every visit so approvals and uploads made elsewhere show up;
    // keep the current rows on screen while the same property reloads
    if (this.lastCompanyId !== companyId) this.expenses = [];
    this.lastCompanyId = companyId;
    this.loadExpenses(companyId);

    return `
      <div class="page-header">
        <div class="page-header-left">
          <h1>🔍 Receipts</h1>
          <p>Upload a receipt image or PDF — fields are extracted on the server for you to review</p>
        </div>
      </div>

      <div class="grid-2" style="margin-bottom:20px">
        <div>
          <div class="upload-zone" id="uploadZone" ondragover="ReceiptsPage.onDragOver(event)" ondragleave="ReceiptsPage.onDragLeave(event)" ondrop="ReceiptsPage.onDrop(event)">
            <input type="file" accept="image/jpeg,image/png,image/webp,.pdf" onchange="ReceiptsPage.onFileSelect(event)" id="fileInput">
            <span class="upload-zone-icon">📤</span>
            <h3>Drop receipt here or click to browse</h3>
            <p>Supports JPG, PNG, WebP, PDF · Max 10 MB</p>
            <div style="margin-top:16px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
              <span class="badge badge-info">📷 Photo</span>
              <span class="badge badge-info">📄 PDF</span>
              <span class="badge badge-info">🖼 Screenshot</span>
            </div>
          </div>

          <div class="mobile-capture">
            <label class="btn btn-primary">📷 Take photo
              <input type="file" accept="image/*" capture="environment" onchange="ReceiptsPage.onFileSelect(event)" hidden>
            </label>
            <label class="btn btn-secondary">🖼 Choose from phone
              <input type="file" accept="image/jpeg,image/png,image/webp,.pdf" onchange="ReceiptsPage.onFileSelect(event)" hidden>
            </label>
          </div>

          <div id="filePreview" style="display:none;margin-top:16px">
            <div class="card" id="previewCard">
              <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
                <span style="font-size:2rem" id="previewIcon">📄</span>
                <img id="previewThumb" class="receipt-thumb" alt="" style="display:none">
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
            <div class="card-title" style="margin-bottom:8px">🇹🇭 Thai & English receipts</div>
            <p style="font-size:0.82rem;color:var(--text-secondary)">
              The server reads the receipt and fills in the vendor, 13-digit tax ID, invoice number, date (พ.ศ. converted), VAT and total.
              Always check the fields before saving — warnings appear above the form.
            </p>
          </div>
        </div>

        <div id="ocrResultPanel" style="display:${this.ocrDone ? 'block' : 'none'}">
          ${this.renderOcrResult()}
        </div>
        <div id="ocrPlaceholder" style="${this.ocrDone ? 'display:none' : ''}">
          <div class="card" style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:300px;text-align:center">
            <div style="font-size:3rem;margin-bottom:16px">🤖</div>
            <div style="font-size:1.1rem;font-weight:700;margin-bottom:8px">AI OCR Ready</div>
            <p style="font-size:0.85rem;color:var(--text-secondary);max-width:240px">Upload a receipt to see the extracted data appear here</p>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">💳 Processed Receipts</div>
            <div class="card-subtitle" id="expensesSubtitle">${this.recordCount()}</div>
          </div>
        </div>
        <div class="filter-chips" id="statusFilterChips">${this.renderFilterChips()}</div>
        <div id="expensesTableContainer">
            ${this.renderExpensesTable()}
        </div>
      </div>
      <div class="modal-overlay" id="reviewModal" onclick="if (event.target === this) ReceiptsPage.closeReview()">
        <div class="modal review-modal" id="reviewModalBody"></div>
      </div>
    `;
  },

  renderFilterChips() {
    const filters = [
      ['all', 'All'], ['draft', 'Drafts'], ['confirmed', 'Awaiting approval'], ['approved', 'Approved'], ['disabled', 'Disabled'],
      ['fx', '💱 Needs THB amount'],
    ];
    return filters.map(([key, label]) => {
      const count = key === 'all' ? this.expenses.length
        : key === 'fx' ? this.expenses.filter(e => Money.fxPending(e)).length
        : this.expenses.filter(e => e.status === key).length;
      if (key === 'fx' && !count && this.statusFilter !== 'fx') return '';
      return `<button class="filter-chip ${this.statusFilter === key ? 'active' : ''}" onclick="ReceiptsPage.setFilter('${key}')">${label} · ${count}</button>`;
    }).join('');
  },

  recordCount() {
    const n = this.expenses.length;
    return `${n} record${n === 1 ? '' : 's'}`;
  },

  setFilter(status) {
    this.statusFilter = status;
    this.refreshList();
  },

  refreshList() {
    const container = document.getElementById('expensesTableContainer');
    if (container) container.innerHTML = this.renderExpensesTable();
    const chips = document.getElementById('statusFilterChips');
    if (chips) chips.innerHTML = this.renderFilterChips();
    const subtitle = document.getElementById('expensesSubtitle');
    if (subtitle) subtitle.textContent = this.recordCount();
  },

  renderExpensesTable() {
    if (this.loading && this.expenses.length === 0) {
      return [1, 2, 3].map(() => '<div class="skeleton" style="height:40px;margin-bottom:10px"></div>').join('');
    }
    if (this.loadError) return `<div style="padding:20px;text-align:center;color:var(--red)">⚠️ Couldn't load expenses: ${esc(this.loadError)} <button class="btn btn-secondary btn-sm" style="margin-left:8px" onclick="ReceiptsPage.loadExpenses(App.currentCompany)">↻ Retry</button></div>`;
    if (this.expenses.length === 0) return '<div style="padding:20px;text-align:center;color:var(--text-secondary)">No receipts yet — upload one above.</div>';

    // Keep each record's index into this.expenses: the row actions look it up by index
    const rows = this.expenses
      .map((e, idx) => ({ e, idx }))
      .filter(({ e }) => this.statusFilter === 'all' || (this.statusFilter === 'fx' ? Money.fxPending(e) : e.status === this.statusFilter));
    if (rows.length === 0) return `<div style="padding:20px;text-align:center;color:var(--text-secondary)">${this.statusFilter === 'fx' ? 'No receipts waiting for an exchange rate.' : 'Nothing here — no records with this status.'}</div>`;

    return `
        <div class="table-scroll"><table class="data-table">
          <thead><tr>
            <th>Vendor</th><th>Date</th><th>Amount</th><th>Category</th><th>Tax Info</th><th>Status</th><th style="text-align:right">Actions</th>
          </tr></thead>
          <tbody>
            ${rows.map(({ e, idx }) => {
              const hasTax = e.tax_amount && parseFloat(e.tax_amount) > 0;
              return `
            <tr>
              <td>${esc(e.vendor_name)}${e.invoice_number ? `<div style="font-size:0.72rem;color:var(--text-secondary)">#${esc(e.invoice_number)}</div>` : ''}</td>
              <td>${fmtDate(e.date)}</td>
              <td style="font-weight:700">${Money.cell(e)}</td>
              <td>${e.category ? `<span class="badge badge-info">${esc(e.category)}</span>` : ''}</td>
              <td>
                ${Money.isForeign(e)
                  ? `<span style="font-size:0.8rem;color:var(--text-secondary)">${hasTax ? `${Money.format(e.tax_amount, e.currency)} tax` : 'Foreign'}</span>`
                  : hasTax
                  ? `<span style="font-size:0.8rem;color:var(--green)">${fmtTHB(e.tax_amount)} VAT</span>` 
                  : `<span class="badge badge-error" style="background:rgba(239, 68, 68, 0.1);color:rgb(239, 68, 68);border:1px solid rgba(239, 68, 68, 0.2)">⚠️ No Tax</span>`}
              </td>
              <td><span class="badge badge-${esc(e.status)}">${esc(e.status)}</span></td>
              <td style="text-align:right">
                ${e.receipt_id ? `<button class="btn btn-ghost btn-sm" onclick="ReceiptsPage.openFile('${e.receipt_id}')">📎</button>` : ''}
                ${this.canApprove() && e.status === 'confirmed' && !Money.fxPending(e) ? `<button class="btn btn-ghost btn-sm" onclick="ReceiptsPage.approve(${idx})">✔ Approve</button>` : ''}
                <button class="btn btn-ghost btn-sm" onclick="ReceiptsPage.viewExpense(${idx})">✏️ Edit</button>
              </td>
            </tr>`;
            }).join('')}
          </tbody>
        </table></div>
    `;
  },

  async loadExpenses(companyId) {
    this.loading = true;
    this.loadError = null;
    this.refreshList();
    try {
      this.expenses = await window.ExpenseApi.listExpenses(companyId);
      App.setDraftCount(this.expenses);
    } catch (error) {
      console.error('Failed to load expenses:', error);
      this.loadError = error.message || 'Unknown error';
    } finally {
      this.loading = false;
      this.refreshList();
    }
  },

  categories() {
    const org = (App.organizations || []).find(o => (o._id || o.id) === App.currentCompany);
    return org && org.categories && org.categories.length ? org.categories : MockData.categories;
  },

  canApprove() {
    const org = (App.organizations || []).find(o => (o._id || o.id) === App.currentCompany);
    return !!org && ['owner', 'admin'].includes(org.role);
  },

  renderOcrResult(r) {
    r = r || this.ocrResult;
    if (!r) return '';
    const isEditing = !!r.id;
    const field = (name, label, value, attrs = '') =>
      `<div class="ocr-field"><div class="ocr-field-label">${label}</div><input class="ocr-field-input" data-field="${name}" value="${esc(value)}" ${attrs}></div>`;
    const cats = this.categories();
    const engine = { claude: 'Claude', typhoon: 'Typhoon OCR', tesseract: 'Tesseract (Thai + English)' }[r.engine] || r.engine || 'OCR';
    return `
    <div class="ocr-panel">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid var(--border)">
        <div style="width:36px;height:36px;background:${isEditing ? 'var(--blue-soft)' : 'var(--green-soft)'};border-radius:8px;display:flex;align-items:center;justify-content:center;color:${isEditing ? 'var(--indigo)' : 'var(--green)'};font-size:1.2rem">
          ${isEditing ? '✏️' : '✓'}
        </div>
        <div>
          <div style="font-weight:700">${isEditing ? 'Edit Expense' : 'Extraction Complete'}</div>
          <div style="font-size:0.78rem;color:var(--text-secondary)">
            ${isEditing ? 'Update details below' : `${engine}${r.confidence != null ? ` · Confidence ${r.confidence}%` : ''} · Review and confirm`}
          </div>
        </div>
        <span class="badge ${isEditing ? 'badge-info' : 'badge-confirmed'}" style="margin-left:auto">
          ${isEditing ? 'Existing Record' : (r.is_tax_invoice ? 'Tax invoice' : 'Receipt')}
        </span>
      </div>
      ${(r.duplicates || []).length ? `
      <div style="padding:10px 12px;border-radius:8px;margin-bottom:12px;background:var(--red-soft);color:var(--red);font-size:0.8rem">
        ⚠️ Possible duplicate of ${r.duplicates.map(d => `${esc(d.vendor_name)} ฿${Number(d.total).toLocaleString()}${d.invoice_number ? ` #${esc(d.invoice_number)}` : ''}`).join(', ')}
      </div>` : ''}
      ${(r.warnings || []).length ? `
      <div style="padding:10px 12px;border-radius:8px;margin-bottom:12px;background:var(--amber-soft);color:var(--amber);font-size:0.8rem">
        ${r.warnings.map(w => `• ${esc(w)}`).join('<br>')}
      </div>` : ''}
      ${field('vendor_name', '🏪 Vendor / Store', r.vendor_name)}
      ${field('vendor_taxid', '🆔 Vendor Tax ID', r.vendor_taxid, 'inputmode="numeric" maxlength="13" placeholder="13 digits"')}
      ${field('vendor_branch', '🏢 Head office / branch', r.vendor_branch || '', 'placeholder="00000 = head office, 00012 = สาขาที่ 12" title="As printed on the tax invoice: สำนักงานใหญ่ (00000) or สาขาที่ and its number"')}
      ${field('invoice_number', '🔢 Invoice / Receipt No.', r.invoice_number)}
      ${field('date', '📅 Date', r.date || '', 'type="date"')}
      <div class="ocr-field">
        <div class="ocr-field-label">💱 Currency</div>
        <select class="ocr-field-input" data-field="currency" onchange="ReceiptsPage.onCurrencyChange(this.value)">
          ${[...new Set([...this.currencies, r.currency || 'THB'])].map(c => `<option ${c === (r.currency || 'THB') ? 'selected' : ''}>${esc(c)}</option>`).join('')}
        </select>
      </div>
      ${field('total', '💰 Total Amount (incl. VAT)', r.total ?? '', 'inputmode="decimal" oninput="ReceiptsPage.onFxInput()"')}
      ${field('tax_amount', '🧾 VAT', r.tax_amount ?? '', 'inputmode="decimal"')}
      ${this.renderFx(r)}
      <div class="ocr-field">
        <div class="ocr-field-label">🏷 Category</div>
        <select class="ocr-field-input" data-field="category">
          <option value="">—</option>
          ${cats.map(c => `<option ${c === r.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}
        </select>
      </div>
      ${field('vendor_address', '📍 Vendor Address', r.vendor_address || '')}
      <div class="ocr-field" style="align-items: flex-start;">
        <div class="ocr-field-label" style="margin-top: 8px;">📝 Notes</div>
        <textarea class="ocr-field-input" data-field="notes" style="height: 70px; resize: vertical;">${esc(r.notes || '')}</textarea>
      </div>
      ${r.ocr_text ? `
      <details style="margin-top:8px;font-size:0.75rem;color:var(--text-secondary)">
        <summary style="cursor:pointer">Raw text read from the receipt</summary>
        <pre style="white-space:pre-wrap;font-size:0.72rem;max-height:200px;overflow:auto">${esc(r.ocr_text)}</pre>
      </details>` : ''}
      ${r.receipt_id ? `<button class="btn btn-ghost btn-sm" style="margin-top:8px" onclick="ReceiptsPage.openFile('${r.receipt_id}')">📎 View original</button>` : ''}
      <div class="ocr-field" style="flex-direction:row;align-items:center;padding:12px;background:var(--bg-base);border-radius:8px;margin-top:10px;border:1px dashed var(--border)">
        <div style="flex:1">
            <div style="font-weight:700;font-size:0.85rem">🚫 Disable Expense</div>
            <div style="font-size:0.75rem;color:var(--text-secondary)">Ignore in dashboard and reports</div>
        </div>
        <input type="checkbox" id="disableExpenseToggle" style="width:20px;height:20px;cursor:pointer" ${r.status === 'disabled' ? 'checked' : ''}>
      </div>
      <div style="display:flex;gap:10px;margin-top:20px">
        <button class="btn btn-primary" style="flex:1;justify-content:center" onclick="ReceiptsPage.confirmExpense()">
          ${isEditing ? '💾 Review & Update' : '🧐 Review & Submit'}
        </button>
        ${!isEditing ? `<button class="btn btn-secondary" onclick="ReceiptsPage.confirmExpense('draft')">Save draft</button>` : ''}
        <button class="btn btn-ghost" onclick="ReceiptsPage.discardOcr()">🗑 Discard</button>
      </div>
    </div>`;
  },

  /** Exchange-rate inputs for foreign-currency receipts; owners/admins enter the THB charged on the card statement. */
  renderFx(r) {
    const currency = r.currency || 'THB';
    const show = currency !== 'THB' ? '' : 'display:none';
    if (!this.canApprove()) {
      return `<div id="fxSection" style="${show};padding:10px 12px;border-radius:8px;margin:6px 0;background:var(--amber-soft);color:var(--amber);font-size:0.8rem">
        💱 ${r.total_thb != null ? `Converted: ${Money.format(r.total_thb)} at ${r.fx_rate}` : 'An owner or admin will enter the THB amount from the card statement before approval.'}
      </div>`;
    }
    const fx = (name, label, value, attrs) =>
      `<div class="ocr-field"><div class="ocr-field-label">${label}</div><input class="ocr-field-input" data-fx="${name}" value="${esc(value)}" ${attrs}></div>`;
    return `
      <div id="fxSection" style="${show};padding:10px 12px;border-radius:8px;margin:6px 0;border:1px dashed var(--border)">
        <div style="font-size:0.78rem;color:var(--text-secondary);margin-bottom:6px">💳 From the card statement — leave blank if it hasn't arrived yet</div>
        ${fx('total_thb', '฿ THB charged', r.total_thb ?? '', 'inputmode="decimal" oninput="ReceiptsPage.onFxInput(\'total_thb\')"')}
        ${fx('fx_rate', `Rate (THB per 1 <span id="fxCurrency">${esc(currency)}</span>)`, r.fx_rate ?? '', 'inputmode="decimal" oninput="ReceiptsPage.onFxInput(\'fx_rate\')"')}
        ${fx('fx_rate_date', '📅 Statement date', r.fx_rate_date || '', 'type="date"')}
      </div>`;
  },

  onCurrencyChange(currency) {
    const section = document.getElementById('fxSection');
    if (section) section.style.display = currency === 'THB' ? 'none' : '';
    const label = document.getElementById('fxCurrency');
    if (label) label.textContent = currency;
  },

  /** Keep THB charged and rate consistent while the owner types in either one. */
  onFxInput(source) {
    const num = el => parseFloat((el?.value || '').replace(/[฿,\s]/g, ''));
    const get = name => document.querySelector(`.ocr-panel [data-fx="${name}"]`);
    const total = num(document.querySelector('.ocr-panel [data-field="total"]'));
    if (source) this.fxEdited = source;
    const thb = get('total_thb'), rate = get('fx_rate');
    if (!thb || !rate || !(total > 0)) return;
    if (this.fxEdited === 'total_thb') rate.value = num(thb) > 0 ? +(num(thb) / total).toFixed(6) : '';
    else if (this.fxEdited === 'fx_rate') thb.value = num(rate) > 0 ? (total * num(rate)).toFixed(2) : '';
  },

  /** FX fields for the save payload: only what the owner changed, so untouched records keep their card-statement amount. */
  fxPayload(r, currency) {
    if (!this.canApprove() || currency === 'THB') return {};
    const get = name => (document.querySelector(`.ocr-panel [data-fx="${name}"]`)?.value || '').trim().replace(/[฿,\s]/g, '');
    const out = {};
    if (this.fxEdited) {
      const v = get(this.fxEdited);
      if (v === '') out.fx_rate = null;
      else out[this.fxEdited] = v;
    }
    const date = get('fx_rate_date');
    if (date !== (r.fx_rate_date || '')) out.fx_rate_date = date || null;
    return out;
  },

  showResult() {
    this.fxEdited = null;
    this.ocrDone = true;
    const panel = document.getElementById('ocrResultPanel');
    if (panel) {
      panel.style.display = 'block';
      panel.innerHTML = this.renderOcrResult();
    }
    const placeholder = document.getElementById('ocrPlaceholder');
    if (placeholder) placeholder.style.display = 'none';
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
    if (this.previewUrl) URL.revokeObjectURL(this.previewUrl);
    this.previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
    const thumb = document.getElementById('previewThumb');
    if (thumb) {
      thumb.style.display = this.previewUrl ? '' : 'none';
      if (this.previewUrl) thumb.src = this.previewUrl;
    }
    document.getElementById('previewIcon').style.display = this.previewUrl ? 'none' : '';
    document.getElementById('filePreview').style.display = 'block';
    document.getElementById('previewName').textContent = file.name;
    document.getElementById('previewSize').textContent = (file.size / 1024).toFixed(0) + ' KB';
    document.getElementById('previewIcon').textContent = file.type === 'application/pdf' ? '📄' : '🖼️';
    // On a phone, read the receipt straight away: one tap from camera to review
    if (window.matchMedia('(max-width: 680px)').matches) this.runOCR();
    else document.getElementById('filePreview').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  },

  viewExpense(idx) {
    const e = this.expenses[idx];
    this.ocrResult = {
      ...e,
      id: e.id || e._id,
      date: e.date && e.date.includes('T') ? e.date.split('T')[0] : e.date,
      tax_amount: e.tax_amount || 0,
      duplicates: [],
      warnings: [],
    };
    this.showResult();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  async openFile(receiptId) {
    try {
      const url = await ReceiptApi.fileUrl(receiptId);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (error) {
      App.showToast('error', error.message);
    }
  },

  async approve(idx) {
    const e = this.expenses[idx];
    try {
      await ExpenseApi.updateExpense(e.id || e._id, { status: 'approved' });
      App.showToast('success', '✔ Expense approved');
      this.loadExpenses(App.currentCompany);
    } catch (error) {
      App.showToast('error', '❌ ' + error.message);
    }
  },

  async runOCR() {
    if (this.ocrRunning || !this.currentFile) return;
    this.ocrRunning = true;
    const btn = document.getElementById('ocrBtn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Processing...'; }
    const progressArea = document.getElementById('ocrProgressArea');
    if (progressArea) progressArea.style.display = 'block';
    const prog = document.getElementById('ocrProgress');
    const stat = document.getElementById('ocrStatusText');
    prog.style.width = '30%';
    stat.textContent = 'Uploading and reading receipt (Thai + English)...';

    try {
      const res = await ReceiptApi.upload(App.currentCompany, this.currentFile);
      const f = res.fields;
      this.ocrResult = {
        ...f,
        receipt_id: res.receipt._id,
        engine: res.receipt.engine,
        confidence: res.receipt.confidence,
        ocr_text: res.receipt.ocr_text,
        warnings: res.warnings,
        duplicates: res.duplicates,
      };
      prog.style.width = '100%';
      stat.textContent = '✅ Extraction complete!';
      this.showResult();
      document.getElementById('ocrResultPanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      console.error('OCR Error:', error);
      stat.textContent = '❌ ' + error.message;
      App.showToast('error', 'Extraction failed: ' + error.message);
    } finally {
      this.ocrRunning = false;
      if (btn) { btn.disabled = false; btn.textContent = '🤖 Run AI OCR'; }
    }
  },

  /** Collect the form, then show a read-only summary to check before anything is saved. */
  confirmExpense(status) {
    if (!this.ocrResult) return;
    const panel = document.querySelector('.ocr-panel');
    if (!panel) return;

    const r = this.ocrResult;
    const isUpdate = !!r.id;
    const values = {};
    panel.querySelectorAll('[data-field]').forEach(el => { values[el.dataset.field] = el.value.trim(); });
    const isDisabled = document.getElementById('disableExpenseToggle')?.checked;
    const amount = v => (v === '' ? 0 : v.replace(/[฿,\s]/g, ''));

    const payload = {
      ...values,
      vendor_taxid: values.vendor_taxid.replace(/\D/g, ''),
      date: values.date || null,
      total: amount(values.total),
      tax_amount: amount(values.tax_amount),
      currency: values.currency || 'THB',
      ...this.fxPayload(r, values.currency || 'THB'),
      status: isDisabled ? 'disabled' : (status || (r.status === 'approved' ? 'approved' : 'confirmed')),
    };

    // Catch a rate typed the wrong way round (e.g. 0.0276 USD per THB instead of 36.25 THB per USD).
    const rate = payload.fx_rate ?? (payload.total_thb && Number(payload.total) ? payload.total_thb / payload.total : null);
    if (payload.currency === 'USD' && rate && (rate < 25 || rate > 45) &&
        !confirm(`The rate works out to ${(+rate).toFixed(4)} THB per USD, which looks wrong. Save anyway?`)) return;

    this.pendingPayload = payload;
    this.openReview(payload, r);
  },

  openReview(p, r) {
    const isUpdate = !!r.id;
    const issues = [];
    if (!p.vendor_name) issues.push('Vendor is empty');
    if (!p.date) issues.push('Date is empty');
    if (!(Number(p.total) > 0)) issues.push('Total is zero');
    if (p.vendor_taxid && p.vendor_taxid.length !== 13) issues.push('Tax ID is not 13 digits');
    if ((r.duplicates || []).length) issues.push('Possible duplicate of an existing receipt');
    const money = v => (v === '' || v == null ? '—' : Money.format(v, p.currency));
    const row = (label, value) => `<div class="review-row"><span>${label}</span><strong>${value || '—'}</strong></div>`;
    const statusLabel = { draft: 'Draft', confirmed: 'Submit for approval', approved: 'Approved', disabled: 'Disabled' }[p.status] || p.status;
    const body = document.getElementById('reviewModalBody');
    if (!body) return;
    body.innerHTML = `
      <div class="modal-header">
        <div style="font-weight:700;font-size:1.05rem">🧐 Review before ${isUpdate ? 'updating' : 'saving'}</div>
        <button class="modal-close" onclick="ReceiptsPage.closeReview()">✕</button>
      </div>
      ${this.previewUrl && !isUpdate ? `<img class="review-image" src="${this.previewUrl}" alt="Receipt">` : ''}
      ${issues.length ? `<div class="review-issues">${issues.map(i => `⚠️ ${esc(i)}`).join('<br>')}</div>` : ''}
      <div class="review-total">${money(p.total)}<small>VAT ${money(p.tax_amount)}</small></div>
      ${row('🏪 Vendor', esc(p.vendor_name))}
      ${row('🆔 Tax ID', esc(p.vendor_taxid))}
      ${row('🏢 Branch', esc(p.vendor_branch))}
      ${row('🔢 Invoice No.', esc(p.invoice_number))}
      ${row('📅 Date', p.date ? fmtDate(p.date) : '')}
      ${row('🏷 Category', esc(p.category))}
      ${p.currency !== 'THB' && p.total_thb ? row('฿ THB charged', Money.format(p.total_thb)) : ''}
      ${row('📝 Notes', esc(p.notes))}
      ${row('📌 Status', esc(statusLabel))}
      <div class="review-actions">
        <button class="btn btn-secondary" onclick="ReceiptsPage.closeReview()">✏️ Back to edit</button>
        <button class="btn btn-primary" id="reviewSubmitBtn" onclick="ReceiptsPage.submitExpense()">${isUpdate ? '💾 Update' : '✅ Submit'}</button>
      </div>`;
    document.getElementById('reviewModal').classList.add('open');
  },

  closeReview() {
    document.getElementById('reviewModal')?.classList.remove('open');
  },

  async submitExpense(allowDuplicate = false) {
    const r = this.ocrResult, payload = this.pendingPayload;
    if (!r || !payload) return;
    const isUpdate = !!r.id;
    const btn = document.getElementById('reviewSubmitBtn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Saving...'; }
    try {
      if (isUpdate) {
        await ExpenseApi.updateExpense(r.id, payload);
        App.showToast('success', '✅ Expense updated!');
      } else {
        await ExpenseApi.createExpense({
          ...payload,
          organization_id: App.currentCompany,
          receipt_id: r.receipt_id,
          subtotal: r.subtotal,
          allow_duplicate: allowDuplicate,
        });
        App.showToast('success', '✅ Receipt saved to database!');
      }
      this.closeReview();
      this.resetUpload();
      App.navigate('receipts');
    } catch (error) {
      if (error.status === 409 && !allowDuplicate) {
        const d = error.duplicates[0] || {};
        if (confirm(`This looks like a receipt already recorded (${d.vendor_name || ''} ฿${Number(d.total || 0).toLocaleString()}). Save anyway?`)) {
          return this.submitExpense(true);
        }
      } else {
        console.error('Action failed:', error);
        App.showToast('error', '❌ Could not complete: ' + error.message);
      }
      if (btn) { btn.disabled = false; btn.textContent = isUpdate ? '💾 Update' : '✅ Submit'; }
    }
  },

  resetUpload() {
    this.ocrDone = false; this.ocrResult = null; this.currentFile = null; this.pendingPayload = null;
    if (this.previewUrl) URL.revokeObjectURL(this.previewUrl);
    this.previewUrl = null;
  },

  discardOcr() {
    this.resetUpload();
    App.navigate('receipts');
  }
};
