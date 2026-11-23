const express = require('express');
const path = require('path');
const cors = require('cors');
const { getBotState, getBotSettings, updateBotSettings, setAutoReply, restartBot, requestPairingCode } = require('./whatsapp');

function createServer(port = 3000) {
    const app = express();
    app.use(express.json());

    // Enable CORS for external dashboard / Vercel
    app.use((req, res, next) => {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
        if (req.method === 'OPTIONS') {
            return res.sendStatus(200);
        }
        next();
    });

    app.use(express.static(path.join(__dirname, 'public')));

    // Status API
    app.get('/api/status', (req, res) => {
        res.json(getBotState());
    });

    // Settings API (Get & Update all settings)
    app.get('/api/settings', (req, res) => {
        res.json({ success: true, settings: getBotSettings() });
    });

    app.post('/api/settings', (req, res) => {
        const updated = updateBotSettings(req.body);
        res.json({ success: true, settings: updated });
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
