const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    Browsers
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');
const { askNemotron, clearHistory, NIM_MODEL } = require('./ai');

const AUTH_DIR = path.join(__dirname, 'auth_info_baileys');

const botSettings = {
    autoReply: true,
    onlyDm: false,
    selfTag: true,
    swipeReply: true,
    allTag: true,
    systemPrompt: process.env.SYSTEM_PROMPT || 'You are a helpful, friendly, and smart WhatsApp AI assistant powered by NVIDIA Nemotron 3.5 Bolt. Keep your responses conversational, natural, and concise suitable for WhatsApp messages. Match the language of the user (e.g. Hindi, Hinglish, English, etc.).'
};

// Bot State Object
const botState = {
    status: 'initializing', // 'initializing', 'qr_ready', 'connected', 'disconnected', 'reconnecting'
    qrCodeDataUrl: null,
    qrRaw: null,
    pairingCode: null,
    pairingPhone: null,
    pairingCodeExpiresAt: null,
    user: null,
    autoReply: true,
    settings: botSettings,
    logs: [],
    model: NIM_MODEL,
    startedAt: new Date().toISOString()
};

function addLog(type, message, details = null) {
    const logEntry = {
        id: Date.now() + Math.random().toString(36).substring(2, 6),
        time: new Date().toLocaleTimeString('en-US', { hour12: false }),
        type, // 'info', 'incoming', 'reply', 'error', 'qr'
        message,
        details
    };
    botState.logs.unshift(logEntry);
    if (botState.logs.length > 100) {
        botState.logs.pop();
    }
    console.log(`[${logEntry.time}] [${type.toUpperCase()}] ${message}`);
}

let sock = null;
let isReconnecting = false;
let isSocketReady = false;

// Recursively unwrap ephemeral, viewOnce, or forwarded container messages
function unwrapMessage(m) {
    if (!m) return null;
    let current = m;
    while (
        current?.ephemeralMessage?.message ||
        current?.viewOnceMessage?.message ||
        current?.viewOnceMessageV2?.message ||
        current?.viewOnceMessageV2Extension?.message ||
        current?.documentWithCaptionMessage?.message
    ) {
        current = (
            current.ephemeralMessage?.message ||
            current.viewOnceMessage?.message ||
            current.viewOnceMessageV2?.message ||
            current.viewOnceMessageV2Extension?.message ||
            current.documentWithCaptionMessage?.message
        );
    }
    return current;
}

// Extract text from WhatsApp message object
function extractMessageText(msg) {
    if (!msg.message) return null;
    const m = unwrapMessage(msg.message);
    if (!m) return null;

    return (
        m.conversation ||
        m.extendedTextMessage?.text ||
        m.imageMessage?.caption ||
        m.videoMessage?.caption ||
        m.documentMessage?.caption ||
        m.buttonsResponseMessage?.selectedButtonId ||
        m.templateButtonReplyMessage?.selectedId ||
        m.listResponseMessage?.singleSelectReply?.selectedRowId ||
        null
    );
}

// Extract contextInfo for mention and quote detection
function getContextInfo(msg) {
    if (!msg.message) return {};
    const m = unwrapMessage(msg.message);
    if (!m) return {};

    return (
        m.extendedTextMessage?.contextInfo ||
        m.imageMessage?.contextInfo ||
        m.videoMessage?.contextInfo ||
        m.documentMessage?.contextInfo ||
        m.buttonsResponseMessage?.contextInfo ||
        m.templateButtonReplyMessage?.contextInfo ||
        m.listResponseMessage?.contextInfo ||
        {}
    );
}

// Check if bot was tagged (@), quote/swipe-replied, or group tag-all (@everyone / @all) was used
function checkGroupTrigger(msg, rawText, botUser) {
    if (!botUser) return { triggered: false };

    // Bot Phone ID & LID
    const botPhoneDigits = botUser.id ? botUser.id.split('@')[0].split(':')[0].replace(/[^0-9]/g, '') : '';
    const botLidDigits = botUser.lid ? botUser.lid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '') : '';

    const contextInfo = getContextInfo(msg);
    const mentionedJids = contextInfo.mentionedJid || [];

    // 1. Check WhatsApp Group Mentions (@all / @everyone native feature)
    if (contextInfo.groupMentions && Array.isArray(contextInfo.groupMentions) && contextInfo.groupMentions.length > 0) {
        return { triggered: true, reason: 'NATIVE_GROUP_ALL_MENTION' };
    }

    // 2. Check Text for Tag-All patterns (@all, @everyone, @tagall, @everybody, @group, @members)
    const ALL_TAG_REGEX = /@(?:all|everyone|tagall|everybody|group|members)\b/i;
    if (rawText && ALL_TAG_REGEX.test(rawText)) {
        return { triggered: true, reason: 'ALL_TAG_MENTION' };
    }

    // 3. Check if group JID itself is in mentionedJid (community/announcement group all-tag)
    if (msg.key?.remoteJid && mentionedJids.includes(msg.key.remoteJid)) {
        return { triggered: true, reason: 'GROUP_JID_MENTION' };
    }

    // 4. Check mentioned JIDs in contextInfo for bot's Phone or LID
    for (const jid of mentionedJids) {
        const cleanJid = jid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
        if ((botPhoneDigits && cleanJid === botPhoneDigits) || (botLidDigits && cleanJid === botLidDigits)) {
            return { triggered: true, reason: 'MENTION_TAG' };
        }
    }

    // 5. Check text for @botPhone or @botLid
    if (rawText) {
        if (botPhoneDigits && rawText.includes(`@${botPhoneDigits}`)) {
            return { triggered: true, reason: 'MENTION_TEXT_PHONE' };
        }
        if (botLidDigits && rawText.includes(`@${botLidDigits}`)) {
            return { triggered: true, reason: 'MENTION_TEXT_LID' };
        }
    }

    // 6. Check Swipe-Reply / Quote of a message sent by the bot
    if (contextInfo.quotedMessage && contextInfo.participant) {
        const quotedSender = contextInfo.participant.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
        if ((botPhoneDigits && quotedSender === botPhoneDigits) || (botLidDigits && quotedSender === botLidDigits)) {
            return { triggered: true, reason: 'QUOTE_SWIPE_REPLY' };
        }
    }

    return { triggered: false };
}

async function connectToWhatsApp(forcedPhone = null) {
    try {
        if (!fs.existsSync(AUTH_DIR)) {
            fs.mkdirSync(AUTH_DIR, { recursive: true });
        }

        const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
        const { version, isLatest } = await fetchLatestBaileysVersion();
        addLog('info', `Using Baileys v${version.join('.')}${isLatest ? ' (latest)' : ''}`);

        isSocketReady = false;

        sock = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
            auth: state,
            browser: Browsers.ubuntu('Chrome'),
            connectTimeoutMs: 120000,
            defaultQueryTimeoutMs: 120000,
            qrTimeout: 300000, // 5 minutes timeout to give plenty of time for pairing
            syncFullHistory: false,
            generateHighQualityLinkPreview: false,
            markOnlineOnConnect: true
        });

        // Save session credentials whenever updated
        sock.ev.on('creds.update', saveCreds);

        // Connection update handler
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                isSocketReady = true;
                botState.qrRaw = qr;
                botState.status = 'qr_ready';
                try {
                    botState.qrCodeDataUrl = await QRCode.toDataURL(qr, { scale: 8, margin: 2 });
                } catch (qrErr) {
                    console.error('Failed to generate QR data URL:', qrErr);
                }

                if (!botState.pairingCode) {
                    console.log('\n=============================================');
                    console.log('       SCAN QR CODE OR USE PAIRING CODE      ');
                    console.log(' (Open http://localhost:3000 in your browser) ');
                    console.log('=============================================\n');
                    qrcodeTerminal.generate(qr, { small: true });
                    addLog('qr', 'QR Code ready. (Or use 8-digit Pairing Code on dashboard).');
                }
            }

            if (connection === 'close') {
                isSocketReady = false;
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                botState.status = 'disconnected';
                botState.qrCodeDataUrl = null;
                botState.qrRaw = null;
                botState.user = null;

                addLog('info', `Connection closed. Reason status: ${statusCode || 'unknown'}. Reconnecting: ${shouldReconnect}`);

                if (shouldReconnect) {
                    if (!isReconnecting) {
                        isReconnecting = true;
                        botState.status = 'reconnecting';
                        setTimeout(() => {
                            isReconnecting = false;
                            connectToWhatsApp();
                        }, 5000);
                    }
                } else {
                    addLog('error', 'Device logged out. Clearing auth credentials...');
                    try {
                        fs.rmSync(AUTH_DIR, { recursive: true, force: true });
                    } catch (e) {
                        console.error('Error clearing auth:', e);
                    }
                    botState.pairingCode = null;
                    botState.pairingPhone = null;
                    botState.status = 'disconnected';
                    setTimeout(() => connectToWhatsApp(), 3000);
                }
            } else if (connection === 'open') {
                isSocketReady = true;
                botState.status = 'connected';
                botState.qrCodeDataUrl = null;
                botState.qrRaw = null;
                botState.pairingCode = null;
                botState.pairingPhone = null;
                botState.user = sock.user;

                const userPhone = sock.user?.id ? sock.user.id.split(':')[0] : 'Unknown';
                const userLid = sock.user?.lid ? sock.user.lid.split(':')[0] : 'Unknown';
                const userName = sock.user?.name || sock.user?.notify || 'WhatsApp User';

                console.log('\n=============================================');
                console.log(` ✅ WHATSAPP CONNECTED: +${userPhone} (LID: ${userLid})`);
                console.log(` Name: ${userName}`);
                console.log('=============================================\n');

                addLog('info', `WhatsApp connected successfully as: ${userName} (+${userPhone}, LID: ${userLid})`);
            }
        });

        // Messages upsert handler
        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type !== 'notify') return;

            for (const msg of messages) {
                try {
                    if (!msg.message) continue;

                    const remoteJid = msg.key.remoteJid;
                    if (!remoteJid) continue;

                    // Filter 1: Ignore status broadcasts
                    if (remoteJid === 'status@broadcast' || remoteJid.includes('@broadcast')) {
                        continue;
                    }

                    // Filter 2: Ignore messages sent by bot itself to avoid infinite loops
                    if (msg.key.fromMe) {
                        continue;
                    }

                    // Extract text
                    const rawText = extractMessageText(msg);
                    if (!rawText || !rawText.trim()) {
                        continue;
                    }

                    const isGroup = remoteJid.endsWith('@g.us');
                    const botUser = sock.user || sock.authState?.creds?.me;

                    let shouldReply = false;
                    let chatTypeLabel = 'PRIVATE';
                    let triggerReason = 'DIRECT_MESSAGE';

                    if (!isGroup) {
                        // In Private Chats: Always reply!
                        shouldReply = true;
                        chatTypeLabel = 'PRIVATE';
                        triggerReason = 'PRIVATE_CHAT';
                    } else {
                        // In Group Chats
                        if (botSettings.onlyDm) {
                            // Only DM mode is active -> ignore all groups!
                            continue;
                        }

                        const check = checkGroupTrigger(msg, rawText, botUser);
                        if (!check.triggered) {
                            // Silently ignore other messages in group
                            continue;
                        }

                        // Check specific trigger toggles
                        if (check.reason === 'ALL_TAG_MENTION' || check.reason === 'NATIVE_GROUP_ALL_MENTION' || check.reason === 'GROUP_JID_MENTION') {
                            if (!botSettings.allTag) continue;
                        } else if (check.reason === 'QUOTE_SWIPE_REPLY') {
                            if (!botSettings.swipeReply) continue;
                        } else if (check.reason === 'MENTION_TAG' || check.reason === 'MENTION_TEXT_PHONE' || check.reason === 'MENTION_TEXT_LID') {
                            if (!botSettings.selfTag) continue;
                        }

                        shouldReply = true;
                        chatTypeLabel = 'GROUP';
                        triggerReason = check.reason;
                    }

                    if (!shouldReply) continue;

                    // Clean prompt text (remove @botPhone, @botLid, and @all/@everyone from prompt)
                    let promptText = rawText.trim();
                    if (botUser) {
                        const botPhoneDigits = botUser.id ? botUser.id.split('@')[0].split(':')[0].replace(/[^0-9]/g, '') : '';
                        const botLidDigits = botUser.lid ? botUser.lid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '') : '';
                        if (botPhoneDigits) {
                            promptText = promptText.replace(new RegExp(`@${botPhoneDigits}`, 'g'), '').trim();
                        }
                        if (botLidDigits) {
                            promptText = promptText.replace(new RegExp(`@${botLidDigits}`, 'g'), '').trim();
                        }
                    }
                    promptText = promptText.replace(/@(?:all|everyone|tagall|everybody|group|members)\b/gi, '').trim();
                    if (!promptText) promptText = rawText.trim();

                    // Sender identity
                    const senderJid = isGroup ? (msg.key.participant || remoteJid) : remoteJid;
                    const senderPhone = senderJid.replace(/[^0-9]/g, '');
                    const pushName = msg.pushName || senderPhone;

                    // Distinct context key for conversation memory
                    const memoryKey = isGroup ? `${remoteJid}:${senderPhone}` : remoteJid;

                    addLog('incoming', `[${chatTypeLabel} - ${triggerReason}] From ${pushName} (+${senderPhone}): "${rawText.trim()}"`, {
                        chatType: chatTypeLabel,
                        triggerReason,
                        isGroup,
                        from: senderPhone,
                        senderName: pushName,
                        text: rawText.trim()
                    });

                    // Check if auto-reply is enabled
                    if (!botSettings.autoReply) {
                        addLog('info', `Auto-reply is paused in settings. Skipped reply to ${pushName}.`);
                        continue;
                    }

                    // Send "typing..." presence
                    try {
                        await sock.sendPresenceUpdate('composing', remoteJid);
                    } catch (pErr) {
                        // ignore
                    }

                    // Call NVIDIA Nemotron 3.5 Bolt with dynamic system prompt
                    const replyText = await askNemotron(memoryKey, promptText, botSettings.systemPrompt);

                    // Stop typing indicator
                    try {
                        await sock.sendPresenceUpdate('paused', remoteJid);
                    } catch (pErr) {
                        // ignore
                    }

                    // Send reply to WhatsApp (quote the triggering message, mention sender if in group)
                    await sock.sendMessage(remoteJid, {
                        text: replyText,
                        mentions: isGroup ? [senderJid] : undefined
                    }, { quoted: msg });

                    addLog('reply', `[${chatTypeLabel} REPLY] To ${pushName}: "${replyText.substring(0, 100)}${replyText.length > 100 ? '...' : ''}"`, {
                        to: senderPhone,
                        reply: replyText
                    });

                } catch (msgErr) {
                    addLog('error', `Error processing message: ${msgErr.message}`);
                }
            }
        });

    } catch (err) {
        addLog('error', `Failed to connect WhatsApp: ${err.message}`);
    }
}

async function requestPairingCode(phoneNumber) {
    const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
    if (!cleanNumber || cleanNumber.length < 8) {
        throw new Error('Invalid phone number. Kripya country code ke sath dalein (e.g. 919876543210).');
    }

    if (sock?.authState?.creds?.registered) {
        throw new Error('Account pehle se connected hai!');
    }

    // If socket is not ready or null, reconnect fresh
    if (!sock || !isSocketReady) {
        addLog('info', 'Starting fresh socket for pairing code...');
        await connectToWhatsApp();
        for (let i = 0; i < 10; i++) {
            if (isSocketReady) break;
            await new Promise(r => setTimeout(r, 500));
        }
    }

    try {
        const rawCode = await sock.requestPairingCode(cleanNumber);
        const formattedCode = rawCode?.match(/.{1,4}/g)?.join('-') || rawCode;
        botState.pairingCode = formattedCode;
        botState.pairingPhone = cleanNumber;
        botState.pairingCodeExpiresAt = Date.now() + 3 * 60 * 1000;

        console.log('\n=============================================');
        console.log(`       WHATSAPP PAIRING CODE: ${formattedCode}`);
        console.log(`       Target Phone: +${cleanNumber}`);
        console.log('=============================================\n');

        addLog('info', `Pairing Code generated: ${formattedCode} for +${cleanNumber}`);
        return formattedCode;
    } catch (err) {
        addLog('error', `Pairing code generation failed: ${err.message}`);
        throw err;
    }
}

function getBotState() {
    botState.settings = botSettings;
    return botState;
}

function getBotSettings() {
    return botSettings;
}

function updateBotSettings(newSettings) {
    if (!newSettings || typeof newSettings !== 'object') return botSettings;
    if (newSettings.autoReply !== undefined) botSettings.autoReply = Boolean(newSettings.autoReply);
    if (newSettings.onlyDm !== undefined) botSettings.onlyDm = Boolean(newSettings.onlyDm);
    if (newSettings.selfTag !== undefined) botSettings.selfTag = Boolean(newSettings.selfTag);
    if (newSettings.swipeReply !== undefined) botSettings.swipeReply = Boolean(newSettings.swipeReply);
    if (newSettings.allTag !== undefined) botSettings.allTag = Boolean(newSettings.allTag);
    if (newSettings.systemPrompt && typeof newSettings.systemPrompt === 'string') {
        botSettings.systemPrompt = newSettings.systemPrompt.trim();
    }
    botState.autoReply = botSettings.autoReply;
    botState.settings = botSettings;
    addLog('info', `Settings updated: ${JSON.stringify(botSettings)}`);
    return botSettings;
}

function setAutoReply(enabled) {
    botSettings.autoReply = Boolean(enabled);
    botState.autoReply = botSettings.autoReply;
    addLog('info', `Auto-reply set to: ${botSettings.autoReply ? 'ENABLED' : 'DISABLED'}`);
    return botSettings.autoReply;
}

async function restartBot() {
    addLog('info', 'Manual restart requested.');
    if (sock) {
        try {
            sock.end(undefined);
        } catch (e) {
            // ignore
        }
    }
    setTimeout(() => {
        connectToWhatsApp();
    }, 1500);
}

module.exports = {
    connectToWhatsApp,
    requestPairingCode,
    getBotState,
    getBotSettings,
    updateBotSettings,
    setAutoReply,
    restartBot
};
