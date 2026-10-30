// DocFlow AI — Receipts API Service (server-side OCR + extraction)
window.ReceiptApi = {
    /**
     * Upload a receipt file and get extracted fields
     * @param {string} organizationId
     * @param {File} file - JPEG, PNG, WebP or PDF
     * @returns {Promise<Object>} { receipt, fields, warnings, duplicates }
     */
    async upload(organizationId, file) {
        const token = localStorage.getItem('docflow-auth');
        if (!token) throw new Error('No auth token found');

        const form = new FormData();
        form.append('organization_id', organizationId);
        form.append('file', file);

        const response = await fetch(`${window.docflow_url}/receipts`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            },
            body: form
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ detail: 'Upload failed' }));
            throw new Error(error.detail || 'Upload failed');
        }

        return await response.json();
    },

    /**
     * Fetch the original receipt file as an object URL (caller should revoke it)
     * @param {string} receiptId
     * @returns {Promise<string>} Object URL
     */
    async fileUrl(receiptId) {
        const token = localStorage.getItem('docflow-auth');
        if (!token) throw new Error('No auth token found');

        const response = await fetch(`${window.docflow_url}/receipts/${receiptId}/file`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) throw new Error('Failed to load receipt file');
        return URL.createObjectURL(await response.blob());
    }
};
