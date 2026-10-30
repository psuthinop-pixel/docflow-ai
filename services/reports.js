// DocFlow AI - Reports API Service (server-side totals; see backend/src/routes/reports.ts for definitions)
window.ReportApi = {
    async get(path) {
        const token = localStorage.getItem('docflow-auth');
        if (!token) throw new Error('No auth token found');

        const response = await fetch(`${window.docflow_url}${path}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ detail: 'Failed to load report' }));
            throw new Error(error.detail || 'Failed to load report');
        }

        return await response.json();
    },

    /**
     * Totals by month, category and property
     * @param {string} organizationId - an organization id, or 'all' for every property the user belongs to
     * @param {string} from - 'YYYY-MM' (inclusive)
     * @param {string} to - 'YYYY-MM' (inclusive)
     */
    summary(organizationId, from, to) {
        const q = new URLSearchParams({ organization_id: organizationId });
        if (from) q.set('from', from);
        if (to) q.set('to', to);
        return this.get(`/reports/summary?${q}`);
    },

    /** Input VAT listing for one property and month */
    vat(organizationId, month) {
        return this.get(`/reports/vat?${new URLSearchParams({ organization_id: organizationId, month })}`);
    }
};
