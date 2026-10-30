// Set Password Page — shown after signing in with a temporary password from an invite.
// The server refuses every other request until this is done.
window.SetPasswordPage = {
  render() {
    const user = App.currentUser || {};
    return `
      <div class="login-wrapper">
        <div class="login-card">
          <div class="login-header">
            <div class="sidebar-logo-icon" style="width:48px;height:48px;font-size:24px;margin:0 auto 16px">🔑</div>
            <h1>Set your password</h1>
            <p>Welcome${user.name ? `, ${esc(user.name)}` : ''}. You signed in with a temporary password, so choose your own to continue.</p>
          </div>

          <form id="setPasswordForm" onsubmit="SetPasswordPage.submit(event)">
            <input type="email" value="${esc(user.email || '')}" autocomplete="username" hidden>
            <div class="form-group">
              <label class="form-label" for="sp_current">Temporary password</label>
              <input type="password" id="sp_current" class="form-input" autocomplete="current-password" required>
            </div>
            <div class="form-group">
              <label class="form-label" for="sp_new">New password</label>
              <input type="password" id="sp_new" class="form-input" minlength="8" autocomplete="new-password" placeholder="At least 8 characters" required>
            </div>
            <div class="form-group">
              <label class="form-label" for="sp_confirm">Repeat new password</label>
              <input type="password" id="sp_confirm" class="form-input" minlength="8" autocomplete="new-password" required>
            </div>
            <button type="submit" class="btn btn-primary" id="spBtn" style="width:100%;justify-content:center;margin-top:10px;padding:12px">
              Save and continue
            </button>
          </form>

          <div id="spError" role="alert" style="margin-top:16px;color:var(--red);font-size:0.85rem;text-align:center;display:none"></div>

          <div class="login-footer">
            <p>Not you? <a href="#" onclick="event.preventDefault();App.handleLogout()">Sign out</a></p>
          </div>
        </div>

        <div class="login-decoration">
          <div class="blob blob-1"></div>
          <div class="blob blob-2"></div>
        </div>
      </div>
    `;
  },

  async submit(e) {
    e.preventDefault();
    const current = document.getElementById('sp_current').value;
    const next = document.getElementById('sp_new').value;
    const errorDiv = document.getElementById('spError');
    const btn = document.getElementById('spBtn');
    errorDiv.style.display = 'none';

    if (next !== document.getElementById('sp_confirm').value) {
      errorDiv.textContent = 'The new passwords do not match.';
      errorDiv.style.display = 'block';
      return;
    }

    btn.disabled = true;
    btn.textContent = '⏳ Saving...';
    try {
      await AuthApi.changePassword(current, next);
      App.currentUser.must_change_password = false;
      App.organizations = await OrganizationApi.list();
      App.showToast('success', '🔑 Password set. Welcome to DocFlow AI');
      App.navigate('select-organization');
    } catch (error) {
      errorDiv.textContent = error.message;
      errorDiv.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Save and continue';
    }
  }
};
