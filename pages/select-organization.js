// Select Organization Page
window.SelectOrganizationPage = {
  render() {
    const hasCompany = !!localStorage.getItem('docflow-company');
    return `
      <div class="login-wrapper" style="align-items: flex-start; padding-top: 10vh; flex-direction: column;">
        
        ${hasCompany ? `
          <div style="width: 100%; max-width: 600px; margin: 0 auto 16px;">
            <button class="btn btn-ghost" onclick="App.navigate('dashboard')" style="padding: 0; color: var(--text-secondary);">
              ← Back to Dashboard
            </button>
          </div>
        ` : ''}

        <div class="login-card" style="width: 100%; max-width: 600px; margin: 0 auto;">
          <div class="login-header">
            <div class="sidebar-logo-icon" style="width:48px;height:48px;font-size:24px;margin:0 auto 16px">📂</div>
            <h1>Select Organization</h1>
            <p>Choose an organization to continue or create a new one.</p>
          </div>
          
          <div id="orgListContainer" style="margin-top: 24px;">
            <div style="text-align:center; padding: 20px;">⏳ Loading organizations...</div>
          </div>
          
          <div id="createOrgFormContainer" style="display:none; margin-top: 24px; border-top: 1px solid var(--border); padding-top: 24px;">
            <h3 style="margin-bottom: 16px; font-size: 1.1rem;">Create New Organization</h3>
            <form id="createOrgForm" onsubmit="SelectOrganizationPage.handleCreateOrganization(event)">
              <div class="form-group">
                <label class="form-label">Organization Name</label>
                <input type="text" id="org_name" class="form-input" placeholder="Acme Corp" required>
              </div>
              <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                  <div class="form-group">
                    <label class="form-label">Currency</label>
                    <select id="org_currency" class="form-input">
                        <option value="THB">THB</option>
                        <option value="USD">USD</option>
                        <option value="EUR">EUR</option>
                        <option value="SGD">SGD</option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label class="form-label">Timezone</label>
                    <input type="text" id="org_timezone" class="form-input" value="Asia/Bangkok" required>
                  </div>
              </div>
              
              <div style="display:flex; gap: 12px; margin-top: 16px;">
                <button type="button" class="btn btn-secondary" style="flex:1; justify-content:center;" onclick="SelectOrganizationPage.hideCreateForm()">Cancel</button>
                <button type="submit" class="btn btn-primary" id="createOrgBtn" style="flex:1; justify-content:center;">Create & Join</button>
              </div>
              <div id="createOrgError" style="margin-top:12px;color:var(--red);font-size:0.85rem;text-align:center;display:none"></div>
            </form>
          </div>

          <div class="login-footer" id="createOrgPrompt" style="margin-top: 24px;">
            <button class="btn btn-secondary" style="width:100%; justify-content:center; border-style: dashed;" onclick="SelectOrganizationPage.showCreateForm()">
              <span style="margin-right:8px">➕</span> Create New Organization
            </button>
          </div>
        </div>
        
        <div class="login-decoration">
          <div class="blob blob-1"></div>
          <div class="blob blob-2"></div>
        </div>
      </div>
    `;
  },

  async loadOrganizations() {
    const container = document.getElementById('orgListContainer');
    try {
      const orgs = await OrganizationApi.list();

      if (orgs.length === 0) {
        container.innerHTML = `
                    <div style="text-align:center; padding: 30px; background: var(--bg-surface); border-radius: 8px; border: 1px dashed var(--border);">
                        <div style="font-size: 2rem; margin-bottom: 12px;">🏢</div>
                        <h3 style="margin-bottom: 8px;">No Organizations Found</h3>
                        <p style="color: var(--text-muted); font-size: 0.9rem;">You don't belong to any organizations yet.</p>
                    </div>
                `;
        this.showCreateForm();
        document.getElementById('createOrgPrompt').style.display = 'none';
        return;
      }

      let html = '<div style="display:flex; flex-direction:column; gap:12px;">';
      orgs.forEach(org => {
        html += `
                    <div class="org-card" onclick="SelectOrganizationPage.selectOrganization('${org._id || org.id}')" style="padding: 16px; border: 1px solid var(--border); border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: space-between; transition: all 0.2s ease;">
                        <div>
                            <div style="font-weight: 600; font-size: 1.05rem; margin-bottom: 4px;">${org.organization_name}</div>
                            <div style="font-size: 0.8rem; color: var(--text-muted);">
                                Role: <strong>${org.role || 'Member'}</strong> • Currency: ${org.currency || 'N/A'}
                            </div>
                        </div>
                        <div style="color: var(--accent); font-size: 1.2rem;">→</div>
                    </div>
                `;
      });
      html += '</div>';

      // Add hover effects dynamically since inline styles don't support pseudo-classes well
      html += `
                <style>
                    .org-card:hover { border-color: var(--accent) !important; background: rgba(99,102,241,0.05); transform: translateY(-1px); }
                </style>
            `;

      container.innerHTML = html;
    } catch (error) {
      console.error('Failed to load organizations:', error);
      container.innerHTML = `
                <div style="text-align:center; padding: 20px; color: var(--red);">
                    ❌ Error loading organizations: ${error.message}
                    <button class="btn btn-secondary" style="margin-top:12px; margin-left:auto; margin-right:auto; justify-content:center" onclick="SelectOrganizationPage.loadOrganizations()">Retry</button>
                </div>
            `;
    }
  },

  async selectOrganization(orgId) {
    localStorage.setItem('docflow-company', orgId);
    App.currentCompany = orgId;
    await App.refreshOrganizations();
    App.showToast('success', 'Organization selected');
    App.navigate('dashboard');
  },

  showCreateForm() {
    document.getElementById('createOrgFormContainer').style.display = 'block';
    document.getElementById('createOrgPrompt').style.display = 'none';
    document.getElementById('org_name').focus();
  },

  hideCreateForm() {
    document.getElementById('createOrgFormContainer').style.display = 'none';
    document.getElementById('createOrgPrompt').style.display = 'flex';
    document.getElementById('createOrgError').style.display = 'none';
  },

  async handleCreateOrganization(e) {
    e.preventDefault();
    const btn = document.getElementById('createOrgBtn');
    const errorDiv = document.getElementById('createOrgError');

    const orgName = document.getElementById('org_name').value;
    const currency = document.getElementById('org_currency').value;
    const timezone = document.getElementById('org_timezone').value;

    btn.disabled = true;
    btn.textContent = '⏳ Creating...';
    errorDiv.style.display = 'none';

    try {
      const newOrg = await OrganizationApi.create({
        organization_name: orgName,
        currency: currency,
        timezone: timezone,
        categories: ['Office Supplies', 'Transport', 'Software', 'Meals'] // Default categories
      });

      App.showToast('success', `✅ Created ${orgName}!`);

      // Automatically select the newly created organization
      this.selectOrganization(newOrg._id || newOrg.id);

    } catch (error) {
      console.error('Create org error:', error);
      errorDiv.style.display = 'block';
      errorDiv.textContent = `❌ ${error.message}`;
      btn.disabled = false;
      btn.textContent = 'Create & Join';
    }
  }
};
