// DocFlow AI — App Router & State Manager
window.App = {
    currentPage: 'dashboard',
    currentCompany: 'all',
    currentTheme: localStorage.getItem('docflow-theme') || 'dark',

    init() {
        this.applyTheme();
        this.updateCompanySelector();
        this.navigate('dashboard');
        document.getElementById('companySwitcher').addEventListener('change', (e) => {
            this.currentCompany = e.target.value;
            this.updateCompanyDot();
            this.navigate(this.currentPage);
        });
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
        this.currentPage = page;
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

        const content = document.getElementById('mainContent');
        const companyId = this.currentCompany;

        // Render page
        const pageRenderers = {
            dashboard: () => DashboardPage.render(companyId),
            receipts: () => ReceiptsPage.render(companyId),
            email: () => EmailPage.render(companyId),
            line: () => LinePage.render(companyId),
            drive: () => DrivePage.render(companyId),
            sheets: () => SheetsPage.render(companyId),
            reports: () => ReportsPage.render(companyId),
            settings: () => SettingsPage.render(companyId),
        };
        content.innerHTML = '';
        content.style.opacity = '0';
        setTimeout(() => {
            content.innerHTML = (pageRenderers[page] || pageRenderers.dashboard)();
            content.style.opacity = '1';
            // Init charts after DOM update
            if (page === 'reports') setTimeout(() => ReportsPage.initCharts(), 100);
        }, 80);
    },

    updateCompanySelector() {
        const sel = document.getElementById('companySwitcher');
        sel.innerHTML = `<option value="all">All Companies</option>` +
            MockData.companies.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    },

    updateCompanyDot() {
        const dot = document.getElementById('companyDot');
        if (this.currentCompany === 'all') {
            dot.style.background = 'var(--accent)';
        } else {
            const comp = MockData.companies.find(c => c.id === this.currentCompany);
            if (comp) dot.style.background = comp.color;
        }
        // Update sidebar badges
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

    showToast(type, message) {
        const container = document.getElementById('toastContainer');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        const icons = { success: '✅', info: 'ℹ️', error: '❌' };
        toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span style="flex:1">${message}</span>`;
        container.appendChild(toast);
        setTimeout(() => {
            toast.style.animation = 'slideOut 0.3s ease forwards';
            setTimeout(() => toast.remove(), 300);
        }, 3500);
    }
};

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

document.addEventListener('DOMContentLoaded', () => App.init());
