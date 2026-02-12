const cds = require('@sap/cds');

cds.on('bootstrap', (app) => {
    const bodyParser = require('body-parser');
    // Increase body parser limits for large ABAP source code uploads
    // Default is 100KB, but ABAP programs can be thousands of lines (several MB)
    app.use(bodyParser.text({ type: 'multipart/mixed', limit: '50mb' }));
    app.use(bodyParser.json({ limit: '50mb' }));
    app.use(bodyParser.text({ limit: '50mb' }));
});

module.exports = cds.server;
