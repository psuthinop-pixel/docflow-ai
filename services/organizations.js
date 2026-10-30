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
    },

    /**
     * Update an organization (owner/admin only)
     * @param {string} id - Organization ID
     * @param {Object} data - Any of { organization_name, color, categories }
     * @returns {Promise<Object>} Updated organization
     */
    async update(id, data) {
        const token = localStorage.getItem('docflow-auth');
        if (!token) throw new Error('No auth token found');

        const response = await fetch(`${window.docflow_url}/organizations/${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(data)
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ detail: 'Failed to update organization' }));
            throw new Error(error.detail || 'Failed to update organization');
        }

        return await response.json();
    }
};

// DocFlow AI - Server status (OCR engine configuration)
window.SystemApi = {
    async status() {
        const token = localStorage.getItem('docflow-auth');
        if (!token) throw new Error('No auth token found');

        const response = await fetch(`${window.docflow_url}/system/status`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ detail: 'Failed to load server status' }));
            throw new Error(error.detail || 'Failed to load server status');
        }

        return await response.json();
    }
};
