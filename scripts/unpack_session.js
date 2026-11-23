const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const AUTH_DIR = path.join(__dirname, '..', 'auth_info_baileys');
const ENC_FILE = path.join(__dirname, '..', 'session.enc');
const SECRET = process.env.SESSION_SECRET || 'as-wa-default-key-change-me';

function unpack() {
    if (!fs.existsSync(ENC_FILE)) {
        console.log('[UNPACK] No session.enc file found. Skipping unpack.');
        return;
    }

    console.log('[UNPACK] Decrypting session.enc...');
    const encrypted = fs.readFileSync(ENC_FILE);
    if (encrypted.length < 17) {
        console.error('[UNPACK] Invalid session.enc format.');
        return;
    }

    const salt = Buffer.from('as-wa-session-salt');
    const key = crypto.scryptSync(SECRET, salt, 32);
    const iv = encrypted.subarray(0, 16);
    const ciphertext = encrypted.subarray(16);

    try {
        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
        const compressed = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        const jsonBuffer = zlib.gunzipSync(compressed);
        const sessionMap = JSON.parse(jsonBuffer.toString());

        if (!fs.existsSync(AUTH_DIR)) {
            fs.mkdirSync(AUTH_DIR, { recursive: true });
        }

        let count = 0;
        for (const [relPath, b64Content] of Object.entries(sessionMap)) {
            const dest = path.join(AUTH_DIR, relPath);
            const parent = path.dirname(dest);
            if (!fs.existsSync(parent)) {
                fs.mkdirSync(parent, { recursive: true });
            }
            fs.writeFileSync(dest, Buffer.from(b64Content, 'base64'));
            count++;
        }

        console.log(`[UNPACK] Successfully unpacked ${count} session files to auth_info_baileys/`);
    } catch (err) {
        console.error('[UNPACK] Failed to decrypt session:', err.message);
        process.exit(1);
    }
}

unpack();
