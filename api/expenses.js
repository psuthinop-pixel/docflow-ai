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
            throw new Error(error.detail || 'Failed to save to backend');
        }

        return await response.json();
    },

    /**
     * List expenses from the backend
     * @param {string} organizationId - Optional organization ID to filter by
     * @returns {Promise<Array>} List of expenses
     */
    async listExpenses(organizationId) {
        const token = localStorage.getItem('docflow-auth');
        if (!token) throw new Error('No auth token found');

        let url = `${window.docflow_url}/expenses`;
        if (organizationId) {
            url += `?organization_id=${organizationId}`;
        }

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
    }
};
