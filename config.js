// DocFlow AI — Runtime config. Local dev talks to the local API; any deployed host uses the production API.
// Set PRODUCTION_API_URL to the backend Vercel project's URL (or its custom domain, e.g. https://api.docflow.ai).
(function () {
    var PRODUCTION_API_URL = 'https://docflow-api.vercel.app';
    var local = ['localhost', '127.0.0.1'].indexOf(location.hostname) !== -1;
    window.DOCFLOW_CONFIG = window.DOCFLOW_CONFIG || {
        apiUrl: local ? 'http://localhost:8000' : PRODUCTION_API_URL
    };
})();
