// DocFlow AI — Expense API Service
window.ExpenseApi = {
    /**
     * Create a new expense in the backend
     * @param {Object} payload - The expense data
     * @returns {Promise<Object>} The saved expense data
     */
    async createExpense(payload) {
        const response = await fetch(`${window.docflow_url}/expenses`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
            throw new Error(error.detail || 'Failed to save to backend');
        }

        return await response.json();
    }
};
