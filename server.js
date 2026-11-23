const express = require('express');
const path = require('path');
const { getBotState, setAutoReply, restartBot, requestPairingCode } = require('./whatsapp');

function createServer(port = 3000) {
    const app = express();
    app.use(express.json());
    app.use(express.static(path.join(__dirname, 'public')));

    // Status API
    app.get('/api/status', (req, res) => {
        res.json(getBotState());
    });

    // Request Pairing Code
    app.post('/api/request-pairing-code', async (req, res) => {
        try {
            const { phoneNumber } = req.body;
            if (!phoneNumber) {
                return res.status(400).json({ success: false, error: 'Phone number zaroori hai (with country code).' });
            }
            const code = await requestPairingCode(phoneNumber);
            res.json({ success: true, pairingCode: code });
        } catch (err) {
            res.status(400).json({ success: false, error: err.message });
        }
    });

    // Toggle Auto-reply
    app.post('/api/toggle-autoreply', (req, res) => {
        const { enabled } = req.body;
        const state = setAutoReply(enabled !== undefined ? enabled : !getBotState().autoReply);
        res.json({ success: true, autoReply: state });
    });

    // Restart Bot
    app.post('/api/restart', async (req, res) => {
        await restartBot();
        res.json({ success: true, message: 'Restart triggered.' });
    });

    return app;
}

module.exports = { createServer };
