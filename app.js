// DocFlow AI — App Router & State Manager
window.docflow_url = (window.DOCFLOW_CONFIG && window.DOCFLOW_CONFIG.apiUrl) || 'http://localhost:8000'; // Backend API URL (see config.js)
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

                // Invited users must replace their temporary password before anything else loads
                if (this.currentUser.must_change_password) {
                    this.navigate('set-password');
                    return this.bindSwitcher();
                }

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

        this.bindSwitcher();
    },

    bindSwitcher() {
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
                this.draftCount = 0;
                localStorage.setItem('docflow-company', this.currentCompany);
                this.updateCompanyDot();
                this.refreshDraftCount();
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
        document.documentElement.setAttribute('data-mode', this.currentTheme);
        const icon = document.getElementById('themeIcon');
        if (icon) icon.textContent = this.currentTheme === 'dark' ? '🌙' : '☀️';
    },

    navigate(page) {
        // Auth Guard
        const token = localStorage.getItem('docflow-auth');
        const savedCompany = localStorage.getItem('docflow-company');

        if (page !== 'login' && !token) {
            page = 'login';
        } else if (token && this.currentUser?.must_change_password) {
            page = 'set-password';
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
        const isAuthPage = ['login', 'select-organization', 'set-password'].includes(page);
        document.body.classList.toggle('auth-page', isAuthPage);
        this.toggleSidebar(false);

        const content = document.getElementById('mainContent');
        if (!content) return;

        // Reset opacity for direct page swaps
        content.style.opacity = '1';

        if (page === 'login') {
            content.innerHTML = LoginPage.render();
            return;
        }

        if (page === 'set-password') {
            content.innerHTML = SetPasswordPage.render();
            return;
        }

        if (page === 'select-organization') {
            content.innerHTML = SelectOrganizationPage.render();
            setTimeout(() => SelectOrganizationPage.loadOrganizations(), 50);
            return;
        }

        // Update nav active state
        document.querySelectorAll('.nav-item').forEach(el => {
            const active = el.dataset.page === page;
            el.classList.toggle('active', active);
            if (active) el.setAttribute('aria-current', 'page');
            else el.removeAttribute('aria-current');
        });

        const titles = {
            dashboard: 'Dashboard',
            receipts: 'Receipts',
            email: 'Email intake',
            line: 'LINE bot',
            drive: 'Google Drive',
            sheets: 'Google Sheets',
            reports: 'Reports',
            settings: 'Settings',
        };
        const title = titles[page] || titles.dashboard;
        document.getElementById('topbarTitle').textContent = title;
        document.title = `${title} · DocFlow AI`;

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
            content.innerHTML = this.previewBanner(page) + (pageRenderers[page] || pageRenderers.dashboard)();
            content.style.opacity = '1';
        }, 80);
    },

    // Pages still running on MockData: say so, so nobody mistakes sample figures for their own
    previewBanner(page) {
        const notes = {
            email: 'Email intake is not connected yet — this page is a preview with sample messages.',
            line: 'The LINE bot is not connected yet — this page is a preview with sample messages.',
            drive: 'Google Drive filing is not connected yet — this page is a preview with sample files.',
            sheets: 'The table below is your real data, but Google Sheets sync is not connected yet.',
        };
        return notes[page] ? `<div class="preview-banner"><span>🚧</span><span>${notes[page]}</span></div>` : '';
    },

    toggleSidebar(open) {
        const isOpen = open ?? !document.body.classList.contains('sidebar-open');
        document.body.classList.toggle('sidebar-open', isOpen);
        const btn = document.getElementById('menuToggle');
        if (btn) btn.setAttribute('aria-expanded', String(isOpen));
    },

    async refreshDraftCount() {
        const companyId = this.currentCompany;
        try {
            const m = thisMonth();
            const summary = await ReportApi.summary(companyId, m, m);
            if (companyId === this.currentCompany) this.setDraftCountFromSummary(summary);
        } catch (error) {
            console.error('Draft count refresh failed:', error);
        }
    },

    updateUserPanel() {
        if (!this.currentUser) return;
        const panel = document.getElementById('userPanel');
        if (!panel) return;
        panel.innerHTML = `
            <div class="user-dropdown-overlay" id="userDropdownOverlay" onclick="App.closeUserDropdown()"></div>
            <div class="user-panel" onclick="App.toggleUserDropdown()">
                <div class="topbar-avatar">${esc(this.currentUser.name.charAt(0))}</div>
                <div class="user-info">
                    <div class="user-name">${esc(this.currentUser.name)}</div>
                    <div class="user-role">${esc(this.currentUser.email)}</div>
                </div>
                <div style="font-size: 0.6rem; opacity: 0.5; margin-left: 4px;">▼</div>

                <div class="user-dropdown" id="userDropdown">
                    <div class="user-dropdown-header">
                        <div class="user-dropdown-avatar">${esc(this.currentUser.name.charAt(0))}</div>
                        <div class="user-dropdown-info">
                            <div class="user-name">${esc(this.currentUser.name)}</div>
                            <div style="font-size: 0.75rem; color: var(--text-muted)">${esc(this.currentUser.email || '')}</div>
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
            return `<option value="${esc(id)}" ${this.currentCompany === id ? 'selected' : ''}>${esc(o.organization_name)}</option>`;
        }).join('');

        html += `<option value="manage">⚙️ Manage Organizations</option>`;

        sel.innerHTML = html;
    },

    updateCompanyDot() {
        const dot = document.getElementById('companyDot');
        if (!dot) return;

        const org = this.organizations?.find(o => (o._id || o.id) === this.currentCompany);
        const color = org ? orgColor(org) : 'var(--accent)';
        dot.style.background = color;
        document.documentElement.style.setProperty('--org-color', color);
        this.updateSidebarBadges();
    },

    // Drafts of the current organization, refreshed whenever a page loads its expenses
    draftCount: 0,

    setDraftCount(expenses) {
        this.draftCount = expenses.filter(e => e.status === 'draft').length;
        this.updateSidebarBadges();
    },

    // From a /reports/summary response (its status counts ignore the date range)
    setDraftCountFromSummary(summary) {
        this.draftCount = summary.status_counts.filter(x => x.status === 'draft').reduce((t, x) => t + x.count, 0);
        this.updateSidebarBadges();
    },

    updateSidebarBadges() {
        const badge = document.getElementById('receiptsBadge');
        if (badge) {
            badge.textContent = this.draftCount;
            badge.title = `${this.draftCount} draft${this.draftCount === 1 ? '' : 's'} to review`;
            badge.style.display = this.draftCount ? 'inline-flex' : 'none';
        }
    },

    showToast(type, message, duration = 2000) {
        const container = document.getElementById('toastContainer');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        const icons = { success: '✅', info: 'ℹ️', error: '❌' };
        // Many messages already start with their own emoji; don't add a second icon
        const hasIcon = /^\p{Extended_Pictographic}/u.test(String(message));
        toast.innerHTML = `${hasIcon ? '' : `<span>${icons[type] || 'ℹ️'}</span>`}<span style="flex:1">${esc(message)}</span>`;
        container.appendChild(toast);
        setTimeout(() => {
            toast.style.animation = 'slideOut 0.3s ease forwards';
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }
};

document.addEventListener('DOMContentLoaded', () => App.init());

// A session can end server-side (password changed on another device, logout elsewhere, expiry).
// Any 401 from the API outside the login call sends the user back to the login screen once.
(function watchSessions() {
    const nativeFetch = window.fetch.bind(window);
    let ending = false;
    window.fetch = async (input, init) => {
        const res = await nativeFetch(input, init);
        const url = typeof input === 'string' ? input : input.url;
        if (res.status === 401 && url.startsWith(window.docflow_url) && !url.endsWith('/auth/login')
            && localStorage.getItem('docflow-auth') && !ending) {
            ending = true;
            localStorage.removeItem('docflow-auth');
            localStorage.removeItem('docflow-company');
            App.currentUser = null;
            App.currentCompany = null;
            App.organizations = [];
            App.showToast('info', 'Your session ended. Please sign in again.', 4000);
            App.navigate('login');
            setTimeout(() => { ending = false; }, 1000);
        }
        return res;
    };
})();
// Printed reports include the table views that are collapsed on screen
window.addEventListener('beforeprint', () => {
    document.querySelectorAll('details.table-view').forEach(d => { d.dataset.wasOpen = d.open; d.open = true; });
});
window.addEventListener('afterprint', () => {
    document.querySelectorAll('details.table-view').forEach(d => { d.open = d.dataset.wasOpen === 'true'; });
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') App.toggleSidebar(false);
});

// Page nav shortcuts
window.Pages = {
    receipts: () => App.navigate('receipts'),
    receiptsFiltered: (status) => { ReceiptsPage.statusFilter = status; App.navigate('receipts'); },
    email: () => App.navigate('email'),
    sheets: () => App.navigate('sheets'),
    reports: () => App.navigate('reports'),
    line: () => App.navigate('line'),
    drive: () => App.navigate('drive'),
    settings: () => App.navigate('settings'),
};

// ─── Shared formatting helpers ───
function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtTHB(v) {
    const n = parseFloat(v) || 0;
    return '฿' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Receipt dates are stored as 'YYYY-MM-DD'; format them without a timezone shift
function fmtDate(v) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ''));
    if (!m) return '—';
    return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtDateTime(v) {
    const d = new Date(v);
    if (!v || isNaN(d)) return '—';
    return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// An organization's own colour, or a stable one picked from its id so each property is recognisable
const ORG_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#06b6d4', '#ec4899', '#8b5cf6', '#ef4444', '#84cc16'];
function orgColor(org) {
    if (/^#[0-9a-f]{3,8}$/i.test(org.color || '')) return org.color;
    const id = String(org._id || org.id || '');
    let h = 0;
    for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return ORG_COLORS[h % ORG_COLORS.length];
}

// 'YYYY-MM' shifted by n months
function monthAdd(ym, n) {
    const d = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + n, 1));
    return d.toISOString().slice(0, 7);
}

function thisMonth() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function fmtMonth(ym, opts = { month: 'short', year: 'numeric' }) {
    return new Date(+ym.slice(0, 4), +ym.slice(5, 7) - 1, 1).toLocaleDateString('en-GB', opts);
}

// ─── CSV export ───
// Text cells from receipts are untrusted: they must never run as a spreadsheet formula,
// and 13-digit tax IDs must keep their leading zero when Excel opens the file.
function csvCell(value, { taxId = false, numeric = false } = {}) {
    let s = String(value ?? '');
    if (taxId && /^\d+$/.test(s)) return `="${s}"`;
    if (!numeric && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// rows: array of arrays of already-encoded cells. BOM so Excel reads UTF-8 (Thai) correctly.
function downloadCsv(filename, rows) {
    const blob = new Blob(['\ufeff' + rows.map(r => r.join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename.replace(/[^\w\u0E00-\u0E7F.-]+/g, '_');
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

// Revenue Department branch code → what Thai tax documents print
function branchLabel(b) {
    return b === '00000' ? 'สำนักงานใหญ่' : b ? `สาขาที่ ${b}` : '';
}

// "+ 2 foreign receipts not in the total yet (USD 412.50)" from a summary's fx_pending, or ''
function fxPendingNote(list) {
    const n = (list || []).reduce((t, x) => t + x.count, 0);
    if (!n) return '';
    return `+ ${n} foreign receipt${n === 1 ? '' : 's'} not in the total yet (${list.map(x => Money.format(x.total, x.currency)).join(', ')})`;
}

function sourceLabel(e) {
    return e.receipt_id ? '📤 Upload' : '✍️ Manual';
}
