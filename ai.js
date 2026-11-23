require('dotenv').config();

const NIM_API_KEY = process.env.NIM_API_KEY;
const NIM_MODEL = process.env.NIM_MODEL || 'nvidia/nemotron-3.5-bolt-e4b';
const SYSTEM_PROMPT = process.env.SYSTEM_PROMPT || 'You are a helpful, smart WhatsApp AI assistant powered by NVIDIA Nemotron 3.5 Bolt. Keep replies friendly, concise and in the same language as the user.';

// In-memory conversation store: Map<remoteJid, Array<{ role, content, timestamp }>>
const chatHistories = new Map();
const MAX_HISTORY = 10;
const SESSION_EXPIRY_MS = 60 * 60 * 1000; // 1 hour idle expiry

function cleanOldHistories() {
    const now = Date.now();
    for (const [jid, messages] of chatHistories.entries()) {
        const lastMsg = messages[messages.length - 1];
        if (lastMsg && (now - lastMsg.timestamp > SESSION_EXPIRY_MS)) {
            chatHistories.delete(jid);
        }
    }
}

// Clean every 15 minutes
const cleanupTimer = setInterval(cleanOldHistories, 15 * 60 * 1000);
if (cleanupTimer.unref) cleanupTimer.unref();

async function askNemotron(remoteJid, userMessage, customSystemPrompt = null) {
    if (!NIM_API_KEY) {
        throw new Error('NIM_API_KEY is not defined in environment variables.');
    }

    // Retrieve or initialize history
    let history = chatHistories.get(remoteJid) || [];

    // Append new user message
    history.push({
        role: 'user',
        content: userMessage,
        timestamp: Date.now()
    });

    // Trim history to MAX_HISTORY
    if (history.length > MAX_HISTORY) {
        history = history.slice(-MAX_HISTORY);
    }
    chatHistories.set(remoteJid, history);

    const activePrompt = customSystemPrompt || SYSTEM_PROMPT;

    // Prepare payload for NIM OpenAI-compatible API
    const messages = [
        { role: 'system', content: activePrompt },
        ...history.map(item => ({ role: item.role, content: item.content }))
    ];

    try {
        const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${NIM_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: NIM_MODEL,
                messages: messages,
                temperature: 0.7,
                max_tokens: 1024
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error(`[NIM API Error] Status: ${response.status} - ${errText}`);
            throw new Error(`NIM API responded with status ${response.status}: ${errText}`);
        }

        const data = await response.json();
        const reply = data.choices?.[0]?.message?.content?.trim();

        if (!reply) {
            return "Maaf kijiye, mujhe koi response nahi mila. Kripya dubara try karein.";
        }

        // Save assistant reply to history
        history.push({
            role: 'assistant',
            content: reply,
            timestamp: Date.now()
        });
        chatHistories.set(remoteJid, history);

        return reply;
    } catch (err) {
        console.error('[askNemotron Error]', err);
        return "NIM AI se connect karne me dikkat aayi. Kripya thodi der baad prayas karein.";
    }
}

function clearHistory(remoteJid) {
    chatHistories.delete(remoteJid);
}

module.exports = {
    askNemotron,
    clearHistory,
    NIM_MODEL
};
