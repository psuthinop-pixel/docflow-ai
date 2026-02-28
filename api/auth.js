// DocFlow AI — Auth API Service
window.AuthApi = {
    /**
     * Login user and get auth token
     * @param {string} email
     * @param {string} password
     * @returns {Promise<Object>} { auth: "token" }
     */
    async login(email, password) {
        const response = await fetch(`${window.docflow_url}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ detail: 'Login failed' }));
            throw new Error(error.detail || 'Login failed');
        }

        return await response.json();
    },

    /**
     * Get current user information
     * @returns {Promise<Object>} User details
     */
    async getMe() {
        const token = localStorage.getItem('docflow-auth');
        if (!token) throw new Error('No auth token found');

        const response = await fetch(`${window.docflow_url}/auth/me`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ detail: 'Session expired' }));
            throw new Error(error.detail || 'Session expired');
        }

        return await response.json();
    },

    /**
     * Logout user
     */
    async logout() {
        const token = localStorage.getItem('docflow-auth');
        const response = await fetch(`${window.docflow_url}/auth/logout`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        // Clear local session regardless of server response
        localStorage.removeItem('docflow-auth');
        return response.ok;
    }
};
