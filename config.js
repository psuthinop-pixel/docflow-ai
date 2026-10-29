// DocFlow AI — Runtime config. Local dev talks to the local API; any deployed copy talks to the Vercel API project.
(function () {
    const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
    window.DOCFLOW_CONFIG = window.DOCFLOW_CONFIG || {
        apiUrl: isLocal ? 'http://localhost:8000' : 'https://docflow-ai-serve-property.vercel.app'
    };
})();
