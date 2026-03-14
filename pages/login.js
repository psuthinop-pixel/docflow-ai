// Login Page
window.LoginPage = {
  render() {
    return `
      <div class="login-wrapper">
        <div class="login-card">
          <div class="login-header">
            <div class="sidebar-logo-icon" style="width:48px;height:48px;font-size:24px;margin:0 auto 16px">📂</div>
            <h1>Welcome Back</h1>
            <p>Enter your credentials to access your dashboard</p>
          </div>
          
          <form id="loginForm" onsubmit="LoginPage.handleLogin(event)">
            <div class="form-group">
              <label class="form-label">Email Address</label>
              <input type="email" id="login_email" class="form-input" placeholder="jane@example.com" required>
            </div>
            <div class="form-group">
              <label class="form-label">Password</label>
              <input type="password" id="login_password" class="form-input" placeholder="••••••••" required>
            </div>
            
            <button type="submit" class="btn btn-primary" id="loginBtn" style="width:100%;justify-content:center;margin-top:10px;padding:12px">
              🚀 Sign In
            </button>
          </form>
          
          <div id="loginError" style="margin-top:16px;color:var(--red);font-size:0.85rem;text-align:center;display:none">
            ❌ Invalid email or password. Please try again.
          </div>
          
          <div class="login-footer">
            <p>Don't have an account? <a href="#" onclick="App.showToast('info', 'Contact your administrator for access')">Contact Admin</a></p>
          </div>
        </div>
        
        <div class="login-decoration">
          <div class="blob blob-1"></div>
          <div class="blob blob-2"></div>
        </div>
      </div>
    `;
  },

  async handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('login_email').value;
    const password = document.getElementById('login_password').value;
    const btn = document.getElementById('loginBtn');
    const errorDiv = document.getElementById('loginError');

    btn.disabled = true;
    btn.textContent = '⏳ Signing in...';
    errorDiv.style.display = 'none';

    try {
      const res = await AuthApi.login(email, password);
      if (res.auth) {
        localStorage.setItem('docflow-auth', res.auth);
        localStorage.removeItem('docflow-company'); // Force organization re-selection
        App.showToast('success', 'Login successful! Redirecting...');

        // Fetch user info to populate app state
        const user = await AuthApi.getMe();
        window.App.currentUser = user;

        // Redirect to selection page (guard will handle if already selected)
        setTimeout(() => App.navigate('select-organization'), 100);
      }
    } catch (error) {
      console.error('Login error:', error);
      errorDiv.style.display = 'block';
      errorDiv.textContent = `❌ ${error.message}`;
      btn.disabled = false;
      btn.textContent = '🚀 Sign In';
    }
  }
};
