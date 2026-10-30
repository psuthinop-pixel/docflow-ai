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

// DocFlow AI - Organization members
window.MemberApi = {
    async request(method, orgId, path = '', body) {
        const token = localStorage.getItem('docflow-auth');
        if (!token) throw new Error('No auth token found');

        const response = await fetch(`${window.docflow_url}/organizations/${encodeURIComponent(orgId)}/members${path}`, {
            method,
            headers: {
                ...(body ? { 'Content-Type': 'application/json' } : {}),
                'Authorization': `Bearer ${token}`
            },
            body: body ? JSON.stringify(body) : undefined
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ detail: 'Request failed' }));
            throw new Error(error.detail || 'Request failed');
        }

        return response.status === 204 ? null : await response.json();
    },

    /** @returns {Promise<Array>} [{ user_id, name, email, role }] */
    list(orgId) {
        return this.request('GET', orgId);
    },

    /** @returns {Promise<Object>} the new member; `temporary_password` is set when an account was created */
    add(orgId, { email, name, role }) {
        return this.request('POST', orgId, '', { email, name, role });
    },

    setRole(orgId, userId, role) {
        return this.request('PUT', orgId, `/${encodeURIComponent(userId)}`, { role });
    },

    remove(orgId, userId) {
        return this.request('DELETE', orgId, `/${encodeURIComponent(userId)}`);
    },

    /** New temporary password for an invite that was never completed */
    resetInvite(orgId, userId) {
        return this.request('POST', orgId, `/${encodeURIComponent(userId)}/reset-invite`);
    }
};
