# ⚡ WhatsApp AI Bot (NVIDIA Nemotron 3.5 Bolt)

Baileys WhatsApp bot jo incoming private chats ka jawab NVIDIA NIM API ke **Nemotron 3.5 Bolt** (`nvidia/nemotron-3.5-bolt-e4b`) model se generate karke deta hai. Isme ek live Localhost Web Dashboard aur QR Code scanner bhi shamil hai.

---

## 🌟 Features

- **NVIDIA NIM API Integration**: Powered by `nvidia/nemotron-3.5-bolt-e4b`.
- **Private Chat Filtering**: Sirf private 1-on-1 chats me reply karta hai (groups aur status broadcasts automatically ignore hote hain).
- **Infinite Loop Protection**: Apne khud ke messages ko ignore karta hai.
- **Smart Context History**: Pichli baatchit ka context yaad rakhta hai taaki natural conversation ho sake.
- **Typing Indicator**: AI reply generate karte samay user ko WhatsApp par "typing..." show hota hai.
- **Localhost Web Dashboard**: `http://localhost:3000` par real-time QR Code, connection status, aur live message activity logs dekh sakte hain.
- **Auto-Reply Toggle**: Dashboard se kabhi bhi auto-reply ko pause ya resume kiya ja sakta hai.

---

## 🚀 Kaise Chalayein (Run on Localhost)

### 1. Dependencies Install Karein
```bash
npm install
```

### 2. Environment Configuration
`.env` file me apni NIM API Key aur Port set karein:
```env
PORT=3000
NIM_API_KEY=nvapi-...
NIM_MODEL=nvidia/nemotron-3.5-bolt-e4b
```

### 3. Server Start Karein
```bash
npm start
```

### 4. WhatsApp Account Link Karein
1. Browser me open karein: **[http://localhost:3000](http://localhost:3000)** (ya terminal me print hua QR code dekhein).
2. Apne phone me WhatsApp open karein -> **Settings** -> **Linked Devices** -> **Link a Device**.
3. Screen par dikh rahe QR code ko scan karein.
4. Scan hote hi status **Connected** ho jayega.

Ab koi bhi aapko private chat me message karega, Nemotron 3.5 Bolt automatic reply dega!
