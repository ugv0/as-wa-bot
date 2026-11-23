require('dotenv').config();
const { createServer } = require('./server');
const { connectToWhatsApp } = require('./whatsapp');

const PORT = process.env.PORT || 3000;

async function main() {
    console.log('====================================================');
    console.log(' 🚀 WhatsApp AI Bot (NVIDIA Nemotron 3.5 Bolt) ');
    console.log('====================================================');

    const app = createServer(PORT);

    app.listen(PORT, () => {
        console.log(`[HTTP Server] Localhost web dashboard running at: http://localhost:${PORT}`);
        console.log(`[Status] Open http://localhost:${PORT} in your browser to view QR Code & Live Logs.`);
        console.log('----------------------------------------------------');
        
        // Start WhatsApp Connection
        connectToWhatsApp();
    });
}

main().catch((err) => {
    console.error('Fatal initialization error:', err);
    process.exit(1);
});
