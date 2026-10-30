// DocFlow AI — Expense API Service
window.ExpenseApi = {
    /**
     * Create a new expense in the backend
     * @param {Object} payload - The expense data
     * @returns {Promise<Object>} The saved expense data
     */
    async createExpense(payload) {
        const token = localStorage.getItem('docflow-auth');
        if (!token) throw new Error('No auth token found');

        const response = await fetch(`${window.docflow_url}/expenses`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
            const err = new Error(error.detail || 'Failed to save to backend');
            err.status = response.status;
            err.duplicates = error.duplicates || [];
            throw err;
        }

        return await response.json();
    },

    /**
     * List expenses from the backend
     * @param {string} organizationId - Optional organization ID to filter by
     * @param {Object} [opts] - { limit, sort: 'updated' } (organization lists only)
     * @returns {Promise<Array>} List of expenses
     */
    async listExpenses(organizationId, { limit, sort } = {}) {
        const token = localStorage.getItem('docflow-auth');
        if (!token) throw new Error('No auth token found');

        const q = new URLSearchParams();
        if (organizationId) q.set('organization_id', organizationId);
        if (limit) q.set('limit', limit);
        if (sort) q.set('sort', sort);
        const url = `${window.docflow_url}/expenses${q.toString() ? `?${q}` : ''}`;

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ detail: 'Failed to fetch expenses' }));
            throw new Error(error.detail || 'Failed to fetch expenses');
        }

        return await response.json();
    },

    /**
     * Update an existing expense
     * @param {string} expenseId - The ID of the expense to update
     * @param {Object} payload - The updated expense data
     */
    async updateExpense(expenseId, payload) {
        const token = localStorage.getItem('docflow-auth');
        if (!token) throw new Error('No auth token found');

        const response = await fetch(`${window.docflow_url}/expenses/${expenseId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
            throw new Error(error.detail || 'Failed to update expense');
        }

        return await response.json();
    },

    /**
     * Delete an expense
     * @param {string} expenseId - The ID of the expense to delete
     */
    async deleteExpense(expenseId) {
        const token = localStorage.getItem('docflow-auth');
        if (!token) throw new Error('No auth token found');

        const response = await fetch(`${window.docflow_url}/expenses/${expenseId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
            throw new Error(error.detail || 'Failed to delete expense');
        }

        return true;
    }
};

// Amount helpers shared by the pages. Reports add up THB only: foreign-currency expenses count
// once an owner/admin has entered the THB charged on the card statement (total_thb).
window.Money = {
    isForeign(e) {
        return (e.currency || 'THB') !== 'THB';
    },

    /** True when a foreign-currency expense has no THB amount yet. */
    fxPending(e) {
        return this.isForeign(e) && e.total_thb == null;
    },

    /** THB amount to add to totals, or null while FX is pending. Falls back to total for rows saved before total_thb existed. */
    thb(e) {
        if (e.total_thb != null) return Number(e.total_thb);
        return this.isForeign(e) ? null : Number(e.total || 0);
    },

    format(n, currency = 'THB') {
        const s = Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        return currency === 'THB' ? `฿${s}` : `${currency} ${s}`;
    },

    /** Table cell content: THB as before; foreign amounts show the original plus THB or an "FX pending" badge. */
    cell(e) {
        if (!this.isForeign(e)) return this.format(this.thb(e));
        const thb = this.thb(e);
        return `${this.format(e.total, e.currency)}<div style="font-size:0.72rem;font-weight:500;color:var(--text-secondary)">${
            thb == null ? '<span class="badge badge-pending">FX pending</span>' : `≈ ${this.format(thb)}`}</div>`;
    },

    /** "USD 412.50, EUR 30.00" for expenses still waiting for a rate. */
    pendingSummary(expenses) {
        const sums = {};
        expenses.filter(e => this.fxPending(e)).forEach(e => { sums[e.currency] = (sums[e.currency] || 0) + Number(e.total || 0); });
        return Object.entries(sums).map(([c, n]) => this.format(n, c)).join(', ');
    }
};
