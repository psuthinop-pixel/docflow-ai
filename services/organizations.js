// DocFlow AI - Organizations API Service
window.OrganizationApi = {
    /**
     * List all organizations the user belongs to
     * @returns {Promise<Array>} List of organizations
     */
    async list() {
        const token = localStorage.getItem('docflow-auth');
        if (!token) throw new Error('No auth token found');

        const response = await fetch(`${window.docflow_url}/organizations`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            throw new Error('Failed to fetch organizations');
        }

        return await response.json();
    },

    /**
     * Create a new organization
     * @param {Object} data - { organization_name, currency, timezone, categories }
     * @returns {Promise<Object>} Created organization details
     */
    async create(data) {
        const token = localStorage.getItem('docflow-auth');
        if (!token) throw new Error('No auth token found');

        const response = await fetch(`${window.docflow_url}/organizations`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(data)
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ detail: 'Failed to create organization' }));
            throw new Error(error.detail || 'Failed to create organization');
        }

        return await response.json();
    }
};
