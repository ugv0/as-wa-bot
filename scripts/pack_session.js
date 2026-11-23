const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const AUTH_DIR = path.join(__dirname, '..', 'auth_info_baileys');
const OUT_FILE = path.join(__dirname, '..', 'session.enc');
const SECRET = process.env.SESSION_SECRET || 'as-wa-default-key-change-me';

function getAllFiles(dir, files = []) {
    if (!fs.existsSync(dir)) return files;
    for (const f of fs.readdirSync(dir)) {
        const full = path.join(dir, f);
        if (fs.statSync(full).isDirectory()) {
            getAllFiles(full, files);
        } else {
            files.push(full);
        }
    }
    return files;
}

function pack() {
    console.log('[PACK] Scanning auth_info_baileys directory...');
    const allFiles = getAllFiles(AUTH_DIR);
    if (allFiles.length === 0) {
        console.log('[PACK] No auth files found to pack.');
        return;
    }

    console.log(`[PACK] Packing ${allFiles.length} session files...`);
    const sessionMap = {};
    for (const f of allFiles) {
        const rel = path.relative(AUTH_DIR, f).replace(/\\/g, '/');
        sessionMap[rel] = fs.readFileSync(f).toString('base64');
    }

    const jsonBuffer = Buffer.from(JSON.stringify(sessionMap));
    const compressed = zlib.gzipSync(jsonBuffer);

    // Derive key
    const salt = Buffer.from('as-wa-session-salt');
    const key = crypto.scryptSync(SECRET, salt, 32);
    const iv = crypto.randomBytes(16);

    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    const encrypted = Buffer.concat([iv, cipher.update(compressed), cipher.final()]);

    fs.writeFileSync(OUT_FILE, encrypted);
    console.log(`[PACK] Successfully wrote encrypted session to ${OUT_FILE} (${(encrypted.length / 1024).toFixed(1)} KB)`);
}

pack();
