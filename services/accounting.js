// DocFlow AI - Accounting API (chart of accounts, category mapping, month readiness)
// See backend/src/routes/accounting.ts and docs/ACCOUNTING.md
window.AccountingApi = {
    async request(method, path, body) {
        const token = localStorage.getItem('docflow-auth');
        if (!token) throw new Error('No auth token found');
        const response = await fetch(`${window.docflow_url}/accounting${path}`, {
            method,
            headers: { 'Authorization': `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
            body: body ? JSON.stringify(body) : undefined,
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.detail || 'Accounting request failed');
        return data;
    },

    accounts(orgId) { return this.request('GET', `/accounts?organization_id=${encodeURIComponent(orgId)}`); },
    createAccount(orgId, account) { return this.request('POST', '/accounts', { organization_id: orgId, ...account }); },
    updateAccount(id, fields) { return this.request('PUT', `/accounts/${encodeURIComponent(id)}`, fields); },
    mapping(orgId) { return this.request('GET', `/mapping?organization_id=${encodeURIComponent(orgId)}`); },
    saveMapping(orgId, body) { return this.request('PUT', '/mapping', { organization_id: orgId, ...body }); },
    journal(orgId, month) {
        return this.request('GET', `/journal?organization_id=${encodeURIComponent(orgId)}&month=${encodeURIComponent(month)}`);
    },
    readiness(orgId, month) {
        return this.request('GET', `/readiness?organization_id=${encodeURIComponent(orgId)}&month=${encodeURIComponent(month)}`);
    },
};
