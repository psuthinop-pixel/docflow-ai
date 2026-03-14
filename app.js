// DocFlow AI — App Router & State Manager
window.docflow_url = 'http://localhost:8000'; // Backend API URL
window.App = {
    currentPage: 'dashboard',
    currentCompany: null,
    currentTheme: localStorage.getItem('docflow-theme') || 'dark',
    currentUser: null,
    organizations: [],

    async init() {
        this.applyTheme();

        // Check authentication
        const token = localStorage.getItem('docflow-auth');
        if (token) {
            try {
                this.currentUser = await AuthApi.getMe();

                // Fetch organizations
                this.organizations = await OrganizationApi.list();

                // Check if organization is selected
                const savedCompany = localStorage.getItem('docflow-company');

                // Verify saved company exists in user's organizations
                const companyExists = savedCompany && this.organizations.some(o => (o._id || o.id) === savedCompany);

                if (companyExists) {
                    this.currentCompany = savedCompany;
                    this.navigate('dashboard');
                } else {
                    localStorage.removeItem('docflow-company');
                    this.navigate('select-organization');
                }
            } catch (error) {
                console.error('Auth init failed:', error);
                localStorage.removeItem('docflow-auth');
                localStorage.removeItem('docflow-company');
                this.navigate('login');
            }
        } else {
            this.navigate('login');
        }

        const switcher = document.getElementById('companySwitcher');
        if (switcher) {
            switcher.addEventListener('change', (e) => {
                if (e.target.value === 'manage') {
                    this.navigate('select-organization');
                    // We'll update the selector again to remove the "manage" selection visually if they come back
                    this.updateCompanySelector();
                    return;
                }
                this.currentCompany = e.target.value;
                localStorage.setItem('docflow-company', this.currentCompany);
                this.updateCompanyDot();
                this.navigate(this.currentPage);
            });
        }
    },

    toggleTheme() {
        this.currentTheme = this.currentTheme === 'dark' ? 'light' : 'dark';
        localStorage.setItem('docflow-theme', this.currentTheme);
        this.applyTheme();
    },

    applyTheme() {
        document.documentElement.setAttribute('data-theme', this.currentTheme);
        const icon = document.getElementById('themeIcon');
        if (icon) icon.textContent = this.currentTheme === 'dark' ? '🌙' : '☀️';
    },

    navigate(page) {
        // Auth Guard
        const token = localStorage.getItem('docflow-auth');
        const savedCompany = localStorage.getItem('docflow-company');

        if (page !== 'login' && !token) {
            page = 'login';
        } else if (token) {
            if (!savedCompany && page !== 'logout') {
                page = 'select-organization';
            } else if (page === 'login') {
                // If they have a company and go to login, send to dashboard
                if (savedCompany) page = 'dashboard';
                else page = 'select-organization';
            }
            // Removed the redirect from select-organization to dashboard if savedCompany exists,
            // to allow "Manage Organizations" to function.
        }

        this.currentPage = page;

        // Ensure user UI is up to date if we have a user
        if (this.currentUser) {
            this.updateUserPanel();
            this.updateCompanySelector();
            this.updateCompanyDot();
        }

        // Hide sidebar and topbar on login & select-organization pages
        const isAuthPage = page === 'login' || page === 'select-organization';
        const sidebar = document.querySelector('.sidebar');
        const topbar = document.querySelector('.topbar');
        const layout = document.querySelector('.app-layout');

        if (sidebar) sidebar.style.display = isAuthPage ? 'none' : 'flex';
        if (topbar) topbar.style.display = isAuthPage ? 'none' : 'flex';
        if (layout) layout.style.gridTemplateColumns = isAuthPage ? '1fr' : 'var(--sidebar-w) 1fr';

        const content = document.getElementById('mainContent');
        if (!content) return;

        // Reset opacity for direct page swaps
        content.style.opacity = '1';

        if (page === 'login') {
            content.innerHTML = LoginPage.render();
            return;
        }

        if (page === 'select-organization') {
            content.innerHTML = SelectOrganizationPage.render();
            setTimeout(() => SelectOrganizationPage.loadOrganizations(), 50);
            return;
        }

        // Update nav active state
        document.querySelectorAll('.nav-item').forEach(el => {
            el.classList.toggle('active', el.dataset.page === page);
        });

        // Update topbar title
        const titles = {
            dashboard: { title: 'Dashboard', sub: 'Overview' },
            receipts: { title: 'AI OCR Receipt Reader', sub: 'Upload & Extract' },
            email: { title: 'Email Scraper', sub: 'Inbox Automation' },
            line: { title: 'LINE Chatbot', sub: 'Messaging Workflow' },
            drive: { title: 'Google Drive', sub: 'File Automation' },
            sheets: { title: 'Google Sheets', sub: 'Expense Database' },
            reports: { title: 'Reports & Analytics', sub: 'Charts & Comparisons' },
            settings: { title: 'Settings', sub: 'Configuration' },
        };
        const t = titles[page] || titles.dashboard;
        document.getElementById('topbarTitle').innerHTML = `${t.title} <span>/ ${t.sub}</span>`;

        // Render page
        const pageRenderers = {
            dashboard: () => DashboardPage.render(this.currentCompany),
            receipts: () => ReceiptsPage.render(this.currentCompany),
            email: () => EmailPage.render(this.currentCompany),
            line: () => LinePage.render(this.currentCompany),
            drive: () => DrivePage.render(this.currentCompany),
            sheets: () => SheetsPage.render(this.currentCompany),
            reports: () => ReportsPage.render(this.currentCompany),
            settings: () => SettingsPage.render(this.currentCompany),
        };

        content.innerHTML = '';
        content.style.opacity = '0';
        setTimeout(() => {
            content.innerHTML = (pageRenderers[page] || pageRenderers.dashboard)();
            content.style.opacity = '1';
            if (page === 'reports') setTimeout(() => ReportsPage.initCharts(), 100);
        }, 80);
    },

    updateUserPanel() {
        if (!this.currentUser) return;
        const panel = document.getElementById('userPanel');
        if (!panel) return;
        panel.innerHTML = `
            <div class="user-dropdown-overlay" id="userDropdownOverlay" onclick="App.closeUserDropdown()"></div>
            <div class="user-panel" onclick="App.toggleUserDropdown()">
                <div class="topbar-avatar">${this.currentUser.name.charAt(0)}</div>
                <div class="user-info">
                    <div class="user-name">${this.currentUser.name}</div>
                    <div class="user-role">${this.currentUser.role}</div>
                </div>
                <div style="font-size: 0.6rem; opacity: 0.5; margin-left: 4px;">▼</div>

                <div class="user-dropdown" id="userDropdown">
                    <div class="user-dropdown-header">
                        <div class="user-dropdown-avatar">${this.currentUser.name.charAt(0)}</div>
                        <div class="user-dropdown-info">
                            <div class="user-name">${this.currentUser.name}</div>
                            <div style="font-size: 0.75rem; color: var(--text-muted)">${this.currentUser.email || 'user@docflow.ai'}</div>
                        </div>
                    </div>
                    <div class="user-dropdown-actions">
                        <div class="user-dropdown-item" onclick="App.navigate('settings')">
                            <span>⚙️</span> Account Settings
                        </div>
                        <div class="user-dropdown-item logout" onclick="App.handleLogout()">
                            <span>🚪</span> Sign Out
                        </div>
                    </div>
                </div>
            </div>
        `;
    },

    toggleUserDropdown() {
        const dropdown = document.getElementById('userDropdown');
        const overlay = document.getElementById('userDropdownOverlay');
        if (!dropdown || !overlay) return;
        
        const isVisible = dropdown.style.display === 'flex';
        dropdown.style.display = isVisible ? 'none' : 'flex';
        overlay.style.display = isVisible ? 'none' : 'block';
    },

    closeUserDropdown() {
        const dropdown = document.getElementById('userDropdown');
        const overlay = document.getElementById('userDropdownOverlay');
        if (dropdown) dropdown.style.display = 'none';
        if (overlay) overlay.style.display = 'none';
    },

    async handleLogout() {
        this.closeUserDropdown();
        try {
            await AuthApi.logout();
        } catch (error) {
            console.error('Logout error:', error);
        }
        this.currentUser = null;
        this.currentCompany = null;
        this.organizations = [];
        localStorage.removeItem('docflow-company');
        this.navigate('login');
    },

    async refreshOrganizations() {
        try {
            this.organizations = await OrganizationApi.list();
            this.updateCompanySelector();
            this.updateCompanyDot();
        } catch (error) {
            console.error('Failed to refresh organizations:', error);
        }
    },

    updateCompanySelector() {
        const sel = document.getElementById('companySwitcher');
        if (!sel || !this.organizations) return;

        let html = this.organizations.map(o => {
            const id = o._id || o.id;
            return `<option value="${id}" ${this.currentCompany === id ? 'selected' : ''}>${o.organization_name}</option>`;
        }).join('');

        html += `<option value="manage">⚙️ Manage Organizations</option>`;

        sel.innerHTML = html;
    },

    updateCompanyDot() {
        const dot = document.getElementById('companyDot');
        if (!dot) return;

        const org = this.organizations?.find(o => (o._id || o.id) === this.currentCompany);
        if (org) {
            dot.style.background = org.color || 'var(--accent)';
        } else {
            dot.style.background = 'var(--accent)';
        }
        this.updateSidebarBadges();
    },

    updateSidebarBadges() {
        const pending = MockData.expenses.filter(e =>
            e.status === 'pending' &&
            (this.currentCompany === 'all' || e.companyId === this.currentCompany)
        ).length;
        const badge = document.getElementById('receiptsBadge');
        if (badge) { badge.textContent = pending; badge.style.display = pending ? 'inline-flex' : 'none'; }
    },

    showToast(type, message, duration = 2000) {
        const container = document.getElementById('toastContainer');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        const icons = { success: '✅', info: 'ℹ️', error: '❌' };
        toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span style="flex:1">${message}</span>`;
        container.appendChild(toast);
        setTimeout(() => {
            toast.style.animation = 'slideOut 0.3s ease forwards';
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }
};

document.addEventListener('DOMContentLoaded', () => App.init());

// Page nav shortcuts
window.Pages = {
    receipts: () => App.navigate('receipts'),
    email: () => App.navigate('email'),
    sheets: () => App.navigate('sheets'),
    reports: () => App.navigate('reports'),
    line: () => App.navigate('line'),
    drive: () => App.navigate('drive'),
    settings: () => App.navigate('settings'),
};
