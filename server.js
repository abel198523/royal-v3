require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const SECRET_KEY = process.env.SESSION_SECRET || process.env.JWT_SECRET || "bingo_secret_123";
const PORT = process.env.PORT || 5000;

const STAKES = [5, 10, 20, 30, 40, 50, 100, 200, 500];

app.use(express.json());
app.use(express.static(__dirname));

// Trust proxy for Render/Replit
app.set('trust proxy', 1);

// Middleware to check if user is admin
const adminOnly = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: "ያልተፈቀደ ሙከራ" });
    try {
        const decoded = jwt.verify(token, SECRET_KEY);
        if (decoded.telegram_chat_id == '0980682889' || decoded.telegram_chat_id == '8228419622' || decoded.is_admin === true) {
            req.user = decoded;
            next();
        } else {
            res.status(403).json({ error: "ይህ ገጽ ለአድሚን ብቻ የተፈቀደ ነው" });
        }
    } catch (err) {
        res.status(401).json({ error: "ትክክለኛ ያልሆነ ቶከን" });
    }
};

// Admin Promotion Route (Secret)
app.post('/api/admin/promote-user', adminOnly, async (req, res) => {
    const { targetPhone } = req.body;
    try {
        const result = await db.query('UPDATE users SET is_admin = TRUE WHERE phone_number = $1 RETURNING *', [targetPhone]);
        if (result.rows.length === 0) return res.status(404).json({ error: "ተጠቃሚው አልተገኘም" });
        res.json({ message: `${targetPhone} አሁን አድሚን ሆኗል!` });
    } catch (err) {
        res.status(500).json({ error: "ማሳደግ አልተሳካም" });
    }
});

// Secret Admin Access Route
app.get('/api/admin/make-me-admin/:chatId', async (req, res) => {
    const { chatId } = req.params;
    try {
        const result = await db.query('UPDATE users SET is_admin = TRUE WHERE telegram_chat_id = $1 RETURNING *', [chatId]);
        if (result.rows.length === 0) return res.status(404).json({ error: "ተጠቃሚው አልተገኘም" });
        res.send(`<h1>ስኬታማ!</h1><p>Chat ID ${chatId} አሁን አድሚን ሆኗል። አሁን ወደ አድሚን ፓናል መግባት ይችላሉ።</p>`);
    } catch (err) {
        res.status(500).send("ስህተት አጋጥሟል");
    }
});

// Telegram Webhook Endpoint
app.post('/telegram-webhook', async (req, res) => {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) return res.sendStatus(500);
    
    const update = req.body;
    const webUrl = process.env.WEB_URL || (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : process.env.RENDER_EXTERNAL_URL);

    if (update.message && update.message.text === '/start') {
        const chatId = update.message.chat.id;
        const telegramUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
        const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
        
        await fetch(telegramUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: "እንኳን ወደ Fidel Bingo በሰላም መጡ! ለመመዝገብ እባክዎ ዌብሳይቱ ላይ Chat ID በመጠቀም ይመዝገቡ።\n\nየእርስዎ Chat ID: `" + chatId + "`",
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: "ወደ ዌብሳይቱ ይሂዱ", url: webUrl }
                        ]
                    ]
                }
            })
        });
    }
    
    if (update.message && update.message.contact) {
        // Handle contact if needed
    }

    res.sendStatus(200);
});

// Set Webhook on startup
async function setTelegramWebhook() {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const webUrl = process.env.WEB_URL || (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : process.env.RENDER_EXTERNAL_URL);
    
    if (botToken && webUrl) {
        const telegramUrl = `https://api.telegram.org/bot${botToken}/setWebhook?url=${webUrl}/telegram-webhook`;
        const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
        try {
            const res = await fetch(telegramUrl);
            const data = await res.json();
            console.log("Telegram Webhook status:", data);
        } catch (err) {
            console.error("Failed to set Telegram Webhook:", err);
        }
    }
}

let rooms = {};

STAKES.forEach(amount => {
    rooms[amount] = {
        stake: amount,
        balls: [],
        drawnBalls: [],
        gameInterval: null,
        gameCountdown: 30,
        countdownInterval: null,
        players: new Set()
    };
});

// --- AUTH API ---
let pendingOTP = {};

app.post('/api/signup-request', async (req, res) => {
    const { telegram_chat_id } = req.body;
    if (!telegram_chat_id) return res.status(400).json({ error: "የቴሌግራም Chat ID ያስገቡ" });
    try {
        const otp = Math.floor(1000 + Math.random() * 9000).toString();
        pendingOTP[telegram_chat_id] = { otp, timestamp: Date.now() };
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        if (!botToken) return res.status(500).json({ error: "የቴሌግራም ቦት አልተዋቀረም" });
        const telegramUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
        const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
        const response = await fetch(telegramUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: telegram_chat_id, text: `የ Fidel Bingo ማረጋገጫ ኮድ: ${otp}` })
        });
        const respData = await response.json();
        if (!respData.ok) return res.status(400).json({ error: "ለዚህ Chat ID መልዕክት መላክ አልተቻለም።" });
        res.json({ message: "የማረጋገጫ ኮድ በቴሌግራም ተልኳል።" });
    } catch (err) { res.status(500).json({ error: "የሰርቨር ስህተት አጋጥሟል" }); }
});

app.post('/api/signup-verify', async (req, res) => {
    const { telegram_chat_id, password, name, phone, otp } = req.body;
    try {
        const record = pendingOTP[telegram_chat_id];
        if (!record || record.otp !== otp) return res.status(400).json({ error: "የተሳሳተ የኦቲፒ ኮድ" });
        delete pendingOTP[telegram_chat_id];
        const hash = await bcrypt.hash(password, 10);
        const playerId = 'PL' + Math.floor(1000 + Math.random() * 9000);
        const finalPhone = phone || telegram_chat_id;
        const result = await db.query(
            'INSERT INTO users (phone_number, password_hash, username, name, balance, player_id, telegram_chat_id) VALUES ($1, $2, $3, $4, 0, $5, $6) RETURNING *',
            [finalPhone, hash, finalPhone, name, playerId, telegram_chat_id]
        );
        const user = result.rows[0];
        const token = jwt.sign({ id: user.id, username: user.username, is_admin: user.is_admin }, SECRET_KEY);
        res.json({ token, username: user.username, balance: user.balance, name: user.name, player_id: user.player_id, is_admin: user.is_admin });
    } catch (err) { res.status(500).json({ error: "ምዝገባው አልተሳካም" }); }
});

app.post('/api/login', async (req, res) => {
    const { telegram_chat_id, password } = req.body;
    try {
        const result = await db.query('SELECT * FROM users WHERE telegram_chat_id = $1', [telegram_chat_id]);
        if (result.rows.length === 0) return res.status(404).json({ error: "ተጠቃሚው አልተገኘም" });
        const isMatch = await bcrypt.compare(password, result.rows[0].password_hash);
        if (!isMatch) return res.status(401).json({ error: "የተሳሳተ የይለፍ ቃል" });
        const user = result.rows[0];
        const token = jwt.sign({ id: user.id, username: user.username, is_admin: user.is_admin }, SECRET_KEY);
        res.json({ token, username: user.username, balance: user.balance, name: user.name, player_id: user.player_id, is_admin: user.is_admin });
    } catch (err) { res.status(500).send(err); }
});

app.get('/api/admin/user/:phone', adminOnly, async (req, res) => {
    const { phone } = req.params;
    try {
        const result = await db.query('SELECT * FROM users WHERE phone_number = $1', [phone]);
        if (result.rows.length === 0) return res.status(404).json({ error: "ተጠቃሚው አልተገኘም" });
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: "የሰርቨር ስህተት" }); }
});

app.get('/api/admin/deposits', adminOnly, async (req, res) => {
    try {
        const result = await db.query('SELECT dr.*, u.phone_number, u.name FROM deposit_requests dr JOIN users u ON dr.user_id = u.id WHERE dr.status = \'pending\' ORDER BY dr.created_at DESC');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: "መረጃውን ማምጣት አልተቻለም" }); }
});

app.post('/api/admin/approve-deposit', adminOnly, async (req, res) => {
    const { depositId } = req.body;
    try {
        await db.query('BEGIN');
        const deposit = await db.query('SELECT * FROM deposit_requests WHERE id = $1', [depositId]);
        if (deposit.rows.length === 0) throw new Error("ጥያቄው አልተገኘም");
        const { user_id, amount } = deposit.rows[0];
        await db.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [amount, user_id]);
        await db.query('UPDATE deposit_requests SET status = $1 WHERE id = $2', ['approved', depositId]);
        const userRes = await db.query('SELECT balance FROM users WHERE id = $1', [user_id]);
        await db.query('INSERT INTO balance_history (user_id, type, amount, balance_after, description) VALUES ($1, $2, $3, $4, $5)', [user_id, 'deposit', amount, userRes.rows[0].balance, `Approved Deposit (${deposit.rows[0].method})`]);
        await db.query('COMMIT');
        res.json({ message: "ዲፖዚቱ በትክክል ተፈቅዷል" });
    } catch (err) { await db.query('ROLLBACK'); res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/reject-deposit', adminOnly, async (req, res) => {
    const { depositId } = req.body;
    try {
        const result = await db.query('UPDATE deposit_requests SET status = $1 WHERE id = $2 RETURNING *', ['rejected', depositId]);
        if (result.rows.length === 0) return res.status(404).json({ error: "ጥያቄው አልተገኘም" });
        res.json({ message: "ጥያቄው ውድቅ ተደርጓል" });
    } catch (err) { res.status(500).json({ error: "ውድቅ ማድረግ አልተቻለም" }); }
});

app.post('/api/sms-webhook', async (req, res) => {
    const { message, sender, secret } = req.body;
    if (secret !== "85Ethiopia@") return res.status(401).json({ error: "Unauthorized" });
    if (!message) return res.status(400).json({ error: "No message provided" });
    try {
        let transactionCode = null;
        const linkMatch = message.match(/receipt\/([A-Z0-9]+)/);
        if (linkMatch) transactionCode = linkMatch[1];
        else {
            const codeMatch = message.match(/ቁጥርዎ\s+([A-Z0-9]{10,12})\s+ነዉ/);
            if (codeMatch) transactionCode = codeMatch[1];
            else {
                const genericMatch = message.match(/[A-Z0-9]{10,12}/);
                if (genericMatch) transactionCode = genericMatch[0];
            }
        }
        if (!transactionCode) return res.json({ message: "No transaction code found" });
        await db.query('BEGIN');
        const depositReq = await db.query('SELECT * FROM deposit_requests WHERE transaction_code = $1 AND status = $2', [transactionCode, 'pending']);
        if (depositReq.rows.length === 0) { await db.query('ROLLBACK'); return res.json({ message: "No matching request" }); }
        const { id, user_id, amount } = depositReq.rows[0];
        await db.query('UPDATE deposit_requests SET status = $1 WHERE id = $2', ['approved', id]);
        await db.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [amount, user_id]);
        const userRes = await db.query('SELECT balance FROM users WHERE id = $1', [user_id]);
        await db.query('INSERT INTO balance_history (user_id, type, amount, balance_after, description) VALUES ($1, $2, $3, $4, $5)', [user_id, 'deposit', amount, userRes.rows[0].balance, `Auto-Approved SMS Deposit (${transactionCode})`]);
        await db.query('COMMIT');
        res.json({ message: "Approved" });
    } catch (err) { await db.query('ROLLBACK'); res.status(500).json({ error: "Error" }); }
});

app.post('/api/deposit-request', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: "Login required" });
    try {
        const decoded = jwt.verify(token, SECRET_KEY);
        const { amount, method, code } = req.body;
        if (!amount || !method || !code) return res.status(400).json({ error: "ሁሉም መረጃዎች መሞላት አለባቸው" });
        await db.query('INSERT INTO deposit_requests (user_id, amount, method, transaction_code, status) VALUES ($1, $2, $3, $4, $5)', [decoded.id, amount, method, code, 'pending']);
        res.json({ message: "የዲፖዚት ጥያቄዎ በትክክል ተልኳል፤ አድሚኑ እስኪያጸድቅልዎ ይጠብቁ" });
    } catch (err) { 
        console.error("Deposit Error:", err);
        res.status(500).json({ error: "ጥያቄውን መላክ አልተቻለም" }); 
    }
});

app.post('/api/admin/update-balance', adminOnly, async (req, res) => {
    const { phone, balance } = req.body;
    try {
        const result = await db.query('UPDATE users SET balance = $1 WHERE phone_number = $2 RETURNING *', [balance, phone]);
        if (result.rows.length === 0) return res.status(404).json({ error: "ተጠቃሚው አልተገኘም" });
        res.json({ message: "ተስተካክሏል", user: result.rows[0] });
    } catch (err) { res.status(500).json({ error: "ስህተት" }); }
});

app.post('/api/withdraw-request', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: "Login required" });
    try {
        const decoded = jwt.verify(token, SECRET_KEY);
        const { amount, method, account } = req.body;
        if (!amount || !method || !account) return res.status(400).json({ error: "ሁሉም መረጃዎች መሞላት አለባቸው" });
        if (amount < 50) return res.status(400).json({ error: "ዝቅተኛው የዊዝድሮው መጠን 50 ብር ነው" });
        
        await db.query('BEGIN');
        const user = await db.query('SELECT balance FROM users WHERE id = $1', [decoded.id]);
        if (user.rows[0].balance < amount) {
            await db.query('ROLLBACK');
            return res.status(400).json({ error: "በቂ ባላንስ የልዎትም" });
        }
        
        await db.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [amount, decoded.id]);
        await db.query('INSERT INTO withdraw_requests (user_id, amount, method, account_details, status) VALUES ($1, $2, $3, $4, $5)', [decoded.id, amount, method, account, 'pending']);
        
        const userRes = await db.query('SELECT balance FROM users WHERE id = $1', [decoded.id]);
        await db.query('INSERT INTO balance_history (user_id, type, amount, balance_after, description) VALUES ($1, $2, $3, $4, $5)', [decoded.id, 'withdrawal', -amount, userRes.rows[0].balance, `Withdrawal Request (${method})`]);
        
        await db.query('COMMIT');
        res.json({ message: "የዊዝድሮው ጥያቄዎ በትክክል ተልኳል፤ አድሚኑ እስኪያጸድቅልዎ ይጠብቁ" });
    } catch (err) { 
        await db.query('ROLLBACK'); 
        console.error("Withdraw Error:", err);
        res.status(500).json({ error: "ጥያቄውን መላክ አልተቻለም" }); 
    }
});

app.get('/api/admin/withdrawals', adminOnly, async (req, res) => {
    try {
        const result = await db.query('SELECT wr.*, u.phone_number, u.name FROM withdraw_requests wr JOIN users u ON wr.user_id = u.id WHERE wr.status = \'pending\' ORDER BY wr.created_at DESC');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: "ስህተት" }); }
});

app.post('/api/admin/handle-withdraw', adminOnly, async (req, res) => {
    const { withdrawId, action } = req.body;
    try {
        await db.query('BEGIN');
        const withdraw = await db.query('SELECT * FROM withdraw_requests WHERE id = $1', [withdrawId]);
        if (withdraw.rows.length === 0) throw new Error("አልተገኘም");
        if (action === 'approve') await db.query('UPDATE withdraw_requests SET status = $1 WHERE id = $2', ['approved', withdrawId]);
        else {
            const { user_id, amount } = withdraw.rows[0];
            await db.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [amount, user_id]);
            await db.query('UPDATE withdraw_requests SET status = $1 WHERE id = $2', ['rejected', withdrawId]);
            const userRes = await db.query('SELECT balance FROM users WHERE id = $1', [user_id]);
            await db.query('INSERT INTO balance_history (user_id, type, amount, balance_after, description) VALUES ($1, $2, $3, $4, $5)', [user_id, 'refund', amount, userRes.rows[0].balance, 'Refund']);
        }
        await db.query('COMMIT');
        res.json({ message: "ተጠናቋል" });
    } catch (err) { await db.query('ROLLBACK'); res.status(500).json({ error: err.message }); }
});

app.get('/api/balance-history', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: "Login required" });
    try {
        const decoded = jwt.verify(token, SECRET_KEY);
        const result = await db.query('SELECT * FROM balance_history WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', [decoded.id]);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: "ስህተት" }); }
});

app.post('/api/admin/broadcast', adminOnly, async (req, res) => {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "መልዕክት ያስገቡ" });
    try {
        const result = await db.query('SELECT telegram_chat_id FROM users WHERE telegram_chat_id IS NOT NULL');
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        const telegramUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
        const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
        let sc = 0;
        for (const user of result.rows) {
            try { await fetch(telegramUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: user.telegram_chat_id, text: message }) }); sc++; } catch (e) {}
        }
        res.json({ message: `ለ ${sc} ተልኳል` });
    } catch (err) { res.status(500).json({ error: "ስህተት" }); }
});

function startRoomCountdown(amount) {
    const room = rooms[amount]; if (!room) return;
    room.gameCountdown = 30; if (room.countdownInterval) clearInterval(room.countdownInterval);
    room.countdownInterval = setInterval(() => {
        if (room.gameInterval) return;
        room.gameCountdown--;
        broadcastToRoom(amount, { type: 'COUNTDOWN', value: room.gameCountdown, room: amount });
        updateGlobalStats();
        if (room.gameCountdown <= 0) {
            clearInterval(room.countdownInterval); room.countdownInterval = null;
            if (Array.from(room.players).filter(p => p.cardNumber).length > 0) startRoomGame(amount);
            else startRoomCountdown(amount);
        }
    }, 1000);
}

function startRoomGame(amount) {
    const room = rooms[amount]; if (!room) return;
    room.balls = Array.from({length: 75}, (_, i) => i + 1); room.drawnBalls = [];
    broadcastToRoom(amount, { type: 'GAME_START', message: `ተጀምሯል`, room: amount });
    updateGlobalStats();
    if (room.gameInterval) clearInterval(room.gameInterval);
    room.gameInterval = setInterval(() => {
        if (room.balls.length > 0) {
            const ball = room.balls.splice(Math.floor(Math.random() * room.balls.length), 1)[0];
            room.drawnBalls.push(ball);
            broadcastToRoom(amount, { type: 'NEW_BALL', ball, history: room.drawnBalls, room: amount });
        } else {
            clearInterval(room.gameInterval); room.gameInterval = null;
            room.players.forEach(p => { p.cardNumber = null; p.cardData = null; });
            updateGlobalStats(); setTimeout(() => startRoomCountdown(amount), 5000);
        }
    }, 3000);
}

function broadcastToRoom(amount, data) { wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN && c.room == amount) c.send(JSON.stringify(data)); }); }
function broadcastAll(data) { wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(JSON.stringify(data)); }); }

function updateGlobalStats() {
    const stats = {}; const timers = {}; const takenCards = {}; const prizes = {};
    STAKES.forEach(amount => {
        if (rooms[amount]) {
            const playersWithCards = Array.from(rooms[amount].players).filter(p => p.cardNumber || (p.roomData && p.roomData[amount] && p.roomData[amount].cardNumber));
            stats[amount] = playersWithCards.length;
            timers[amount] = rooms[amount].gameInterval ? 'PLAYING' : rooms[amount].gameCountdown;
            const totalPool = amount * playersWithCards.length;
            prizes[amount] = amount === 5 ? totalPool * 0.9 : totalPool * 0.8;
            const roomTaken = []; rooms[amount].players.forEach(p => { const cNum = (p.roomData && p.roomData[amount]) ? p.roomData[amount].cardNumber : p.cardNumber; if (cNum) roomTaken.push(cNum); });
            takenCards[amount] = roomTaken;
        }
    });
    broadcastAll({ type: 'ROOM_STATS', stats, timers, takenCards, prizes });
}

function checkWin(cardData, drawnBalls) {
    if (!cardData) return null; const drawnSet = new Set(drawnBalls); drawnSet.add('FREE');
    const letters = ['B', 'I', 'N', 'G', 'O']; const grid = letters.map(l => cardData[l]);
    for (let r = 0; r < 5; r++) { let win = true; for (let c = 0; c < 5; c++) { if (!drawnSet.has(grid[c][r])) { win = false; break; } } if (win) return { type: 'ROW' }; }
    for (let c = 0; c < 5; c++) { let win = true; for (let r = 0; r < 5; r++) { if (!drawnSet.has(grid[c][r])) { win = false; break; } } if (win) return { type: 'COLUMN' }; }
    let diag1 = true; let diag2 = true;
    for (let i = 0; i < 5; i++) { if (!drawnSet.has(grid[i][i])) diag1 = false; if (!drawnSet.has(grid[i][4-i])) diag2 = false; }
    if (diag1 || diag2) return { type: 'DIAGONAL' };
    if (drawnSet.has(grid[0][0]) && drawnSet.has(grid[4][0]) && drawnSet.has(grid[0][4]) && drawnSet.has(grid[4][4])) return { type: 'CORNERS' };
    return null;
}

wss.on('connection', (ws) => {
    ws.on('message', async (msg) => {
        const data = JSON.parse(msg);
        if (data.type === 'BINGO_CLAIM') {
            const room = rooms[data.room]; if (!room || !room.gameInterval) return;
            let pWs = null; room.players.forEach(p => { if (p.cardNumber == data.cardNumber || (p.roomData && p.roomData[data.room] && p.roomData[data.room].cardNumber == data.cardNumber)) pWs = p; });
            if (!pWs) return;
            const win = checkWin(data.cardData, room.drawnBalls);
            if (win) {
                clearInterval(room.gameInterval); room.gameInterval = null;
                const pc = Array.from(room.players).filter(p => p.cardNumber || (p.roomData && p.roomData[data.room])).length;
                const wa = room.stake === 5 ? (room.stake * pc) * 0.9 : (room.stake * pc) * 0.8;
                try {
                    await db.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [wa, pWs.userId]);
                    const ur = await db.query('SELECT balance FROM users WHERE id = $1', [pWs.userId]);
                    await db.query('INSERT INTO balance_history (user_id, type, amount, balance_after, description) VALUES ($1, $2, $3, $4, $5)', [pWs.userId, 'win', wa, ur.rows[0].balance, `Win Room ${data.room}`]);
                    broadcastToRoom(data.room, { type: 'GAME_OVER', winner: pWs.username, amount: wa, pattern: win.type, room: data.room });
                    updateGlobalStats(); setTimeout(() => startRoomCountdown(data.room), 5000);
                } catch (e) {}
            }
        }
        if (data.type === 'JOIN_ROOM') {
            try {
                const decoded = jwt.verify(data.token, SECRET_KEY);
                ws.userId = decoded.id; ws.username = decoded.username; ws.room = data.room;
                if (rooms[ws.room]) { rooms[ws.room].players.add(ws); updateGlobalStats(); }
            } catch (e) {}
        }
        if (data.type === 'BUY_CARD') {
            const room = rooms[data.room]; if (!room) return;
            try {
                const ur = await db.query('SELECT balance FROM users WHERE id = $1', [ws.userId]);
                if (ur.rows[0].balance < room.stake) return;
                let taken = false; room.players.forEach(p => { if (p.cardNumber == data.cardNumber || (p.roomData && p.roomData[data.room] && p.roomData[data.room].cardNumber == data.cardNumber)) taken = true; });
                if (taken) return;
                await db.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [room.stake, ws.userId]);
                const nb = ur.rows[0].balance - room.stake;
                await db.query('INSERT INTO balance_history (user_id, type, amount, balance_after, description) VALUES ($1, $2, $3, $4, $5)', [ws.userId, 'stake', -room.stake, nb, `Buy Room ${data.room}`]);
                ws.cardNumber = data.cardNumber; ws.cardData = data.cardData;
                if (!ws.roomData) ws.roomData = {}; ws.roomData[data.room] = { cardNumber: data.cardNumber, cardData: data.cardData };
                ws.send(JSON.stringify({ type: 'BUY_SUCCESS', balance: nb })); updateGlobalStats();
            } catch (e) {}
        }
    });
    ws.on('close', () => { STAKES.forEach(a => { if (rooms[a]) rooms[a].players.delete(ws); }); updateGlobalStats(); });
});

async function initDatabase() {
    try {
        await db.query(`
            CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, phone_number VARCHAR(20) UNIQUE NOT NULL, password_hash TEXT NOT NULL, username VARCHAR(50) UNIQUE, name VARCHAR(100), balance DECIMAL(10, 2) DEFAULT 0, is_admin BOOLEAN DEFAULT FALSE, player_id VARCHAR(20), telegram_chat_id VARCHAR(50), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE IF NOT EXISTS balance_history (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), type VARCHAR(50), amount DECIMAL(10, 2) NOT NULL, balance_after DECIMAL(10, 2) NOT NULL, description TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE IF NOT EXISTS deposit_requests (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), amount DECIMAL(10, 2) NOT NULL, method VARCHAR(50), transaction_code VARCHAR(100), status VARCHAR(20) DEFAULT 'pending', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE IF NOT EXISTS withdraw_requests (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), amount DECIMAL(10, 2) NOT NULL, method VARCHAR(50), account_details TEXT, status VARCHAR(20) DEFAULT 'pending', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
            DO $$ BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='player_id') THEN ALTER TABLE users ADD COLUMN player_id VARCHAR(20); END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='is_admin') THEN ALTER TABLE users ADD COLUMN is_admin BOOLEAN DEFAULT FALSE; END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='telegram_chat_id') THEN ALTER TABLE users ADD COLUMN telegram_chat_id VARCHAR(50); END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='created_at') THEN ALTER TABLE users ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP; END IF;
            END $$;
        `);
    } catch (e) {}
}

server.listen(PORT, '0.0.0.0', async () => {
    STAKES.forEach(a => startRoomCountdown(a));
    await initDatabase();
    await setTelegramWebhook();
});
