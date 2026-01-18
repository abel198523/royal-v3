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
app.use(express.json());
app.use(express.static(__dirname));

// Trust proxy for Render/Replit
app.set('trust proxy', 1);

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
});

const STAKES = [5, 10, 20, 30, 40, 50, 100, 200, 500];
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
let pendingOTP = {}; // Store temporary signup data

app.post('/api/signup-request', async (req, res) => {
    const { telegram_chat_id } = req.body;
    if (!telegram_chat_id) return res.status(400).json({ error: "የቴሌግራም Chat ID ያስገቡ" });

    try {
        const otp = Math.floor(1000 + Math.random() * 9000).toString();
        pendingOTP[telegram_chat_id] = { otp, timestamp: Date.now() };
        
        // Send OTP via Telegram
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        if (!botToken) {
            console.error("TELEGRAM_BOT_TOKEN is missing!");
            return res.status(500).json({ error: "የቴሌግራም ቦት አልተዋቀረም" });
        }
        
        const telegramUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
        
        const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
        const response = await fetch(telegramUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: telegram_chat_id,
                text: `የ Fidel Bingo ማረጋገጫ ኮድ: ${otp}`
            })
        });

        const respData = await response.json();
        if (!respData.ok) {
            console.error("Telegram API Error:", respData);
            return res.status(400).json({ error: "ለዚህ Chat ID መልዕክት መላክ አልተቻለም። መጀመሪያ ቦቱን ስታርት (@fidel_bingo_bot) ማለታችሁን ያረጋግጡ" });
        }
        
        res.json({ message: "የማረጋገጫ ኮድ በቴሌግራም ተልኳል።" });
    } catch (err) {
        console.error("Signup Request Error:", err);
        res.status(500).json({ error: "የሰርቨር ስህተት አጋጥሟል" });
    }
});

app.post('/api/signup-verify', async (req, res) => {
    const { telegram_chat_id, password, name, phone, otp } = req.body;
    try {
        const record = pendingOTP[telegram_chat_id];
        if (!record || record.otp !== otp) {
            return res.status(400).json({ error: "የተሳሳተ የኦቲፒ ኮድ" });
        }

        delete pendingOTP[telegram_chat_id];

        const hash = await bcrypt.hash(password, 10);
        const playerId = 'PL' + Math.floor(1000 + Math.random() * 9000);
        
        // Use telegram_chat_id as phone if phone is not provided
        const finalPhone = phone || telegram_chat_id;

        const result = await db.query(
            'INSERT INTO users (phone_number, password_hash, username, name, balance, player_id, telegram_chat_id) VALUES ($1, $2, $3, $4, 0, $5, $6) RETURNING *',
            [finalPhone, hash, finalPhone, name, playerId, telegram_chat_id]
        );
        const user = result.rows[0];
        const token = jwt.sign({ id: user.id, username: user.username, is_admin: user.is_admin }, SECRET_KEY);
        res.json({ token, username: user.username, balance: user.balance, name: user.name, player_id: user.player_id, is_admin: user.is_admin });
    } catch (err) {
        console.error('Signup Verify Error:', err);
        res.status(500).json({ error: "ምዝገባው አልተሳካም" });
    }
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
        res.json({ 
            token, 
            username: user.username, 
            balance: user.balance,
            name: user.name,
            player_id: user.player_id,
            is_admin: user.is_admin
        });
    } catch (err) { res.status(500).send(err); }
});

// Middleware to check if user is admin
const adminOnly = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: "ያልተፈቀደ ሙከራ" });
    try {
        const decoded = jwt.verify(token, SECRET_KEY);
        // ጥብቅ ቁጥጥር፡ በስልክ ቁጥሩ ብቻ አድሚን መሆኑን ማረጋገጥ
        // 0980682889 በቋሚነት አድሚን ነው
        if (decoded.telegram_chat_id === '0980682889' || decoded.is_admin === true) {
            req.user = decoded;
            next();
        } else {
            res.status(403).json({ error: "ይህ ገጽ ለአድሚን ብቻ የተፈቀደ ነው" });
        }
    } catch (err) {
        res.status(401).json({ error: "ትክክለኛ ያልሆነ ቶከን" });
    }
};

// Admin Route (Hidden)
app.get('/api/admin/user/:phone', adminOnly, async (req, res) => {
    const { phone } = req.params;
    try {
        const result = await db.query('SELECT * FROM users WHERE phone_number = $1', [phone]);
        if (result.rows.length === 0) return res.status(404).json({ error: "ተጠቃሚው አልተገኘም" });
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: "የሰርቨር ስህተት" });
    }
});

app.get('/api/admin/deposits', adminOnly, async (req, res) => {
    try {
        const result = await db.query(`
            SELECT dr.*, u.phone_number, u.name 
            FROM deposit_requests dr 
            JOIN users u ON dr.user_id = u.id 
            WHERE dr.status = 'pending' 
            ORDER BY dr.created_at DESC
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: "መረጃውን ማምጣት አልተቻለም" });
    }
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
        
        // Log history
        const userRes = await db.query('SELECT balance FROM users WHERE id = $1', [user_id]);
        await db.query(
            'INSERT INTO balance_history (user_id, type, amount, balance_after, description) VALUES ($1, $2, $3, $4, $5)',
            [user_id, 'deposit', amount, userRes.rows[0].balance, `Approved Deposit (${deposit.rows[0].method})`]
        );
        
        await db.query('COMMIT');
        res.json({ message: "ዲፖዚቱ በትክክል ተፈቅዷል" });
    } catch (err) {
        await db.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/reject-deposit', adminOnly, async (req, res) => {
    const { depositId } = req.body;
    try {
        const result = await db.query('UPDATE deposit_requests SET status = $1 WHERE id = $2 RETURNING *', ['rejected', depositId]);
        if (result.rows.length === 0) return res.status(404).json({ error: "ጥያቄው አልተገኘም" });
        res.json({ message: "ጥያቄው ውድቅ ተደርጓል" });
    } catch (err) {
        res.status(500).json({ error: "ውድቅ ማድረግ አልተቻለም" });
    }
});

// --- SMS WEBHOOK ---
// ይህ API ከስልክ ወይም ከሌላ ሲስተም የኤስኤምኤስ መረጃዎችን ለመቀበል ያገለግላል
app.post('/api/sms-webhook', async (req, res) => {
    const { message, sender, secret } = req.body;
    
    // ለደህንነት ሲባል ሚስጥራዊ ቁልፍ (Secret Key) ማረጋገጥ ይቻላል
    if (secret !== "85Ethiopia@") {
        return res.status(401).json({ error: "Unauthorized" });
    }

    if (!message) return res.status(400).json({ error: "No message provided" });

    try {
        console.log(`Received SMS from ${sender}: ${message}`);

        // የትራንዛክሽን ኮድ (Transaction Code) ከሜሴጁ ውስጥ ፈልጎ ማውጣት
        // ቴሌብር ፎርማት፡ "ቁጥርዎ DAE4T2UI9Q ነዉ" ወይም ከሊንክ መጨረሻ "receipt/DAE4T2UI9Q"
        
        let transactionCode = null;
        
        // 1. መጀመሪያ ከሊንኩ መጨረሻ ለመፈለግ (ይህ የበለጠ አስተማማኝ ሊሆን ይችላል)
        const linkMatch = message.match(/receipt\/([A-Z0-9]+)/);
        if (linkMatch) {
            transactionCode = linkMatch[1];
        } else {
            // 2. ካልተገኘ "ቁጥርዎ [CODE] ነዉ" ወይም "ቁጥርዎ [CODE] ነዉ" (በሁለቱም የፊደል አይነቶች)
            const codeMatch = message.match(/ቁጥርዎ\s+([A-Z0-9]{10,12})\s+ነዉ/);
            if (codeMatch) {
                transactionCode = codeMatch[1];
            } else {
                // 3. በቀጥታ 10-12 ፊደላት/ቁጥሮች የያዘውን ኮድ መፈለግ (Fallback)
                const genericMatch = message.match(/[A-Z0-9]{10,12}/);
                if (genericMatch) {
                    transactionCode = genericMatch[0];
                }
            }
        }

        if (!transactionCode) {
            return res.json({ message: "No transaction code found in SMS" });
        }
        
        console.log(`Extracted Transaction Code: ${transactionCode}`);

        // በዲቢ ውስጥ ይህ ኮድ ያለው የፔንዲንግ ጥያቄ መኖሩን ማረጋገጥ
        await db.query('BEGIN');
        
        const depositReq = await db.query(
            'SELECT * FROM deposit_requests WHERE transaction_code = $1 AND status = $2',
            [transactionCode, 'pending']
        );

        if (depositReq.rows.length === 0) {
            await db.query('ROLLBACK');
            return res.json({ message: "No matching pending deposit request found" });
        }

        const { id, user_id, amount } = depositReq.rows[0];

        // 1. የዲፖዚት ጥያቄውን አፕሩቭ (Approve) ማድረግ
        await db.query('UPDATE deposit_requests SET status = $1 WHERE id = $2', ['approved', id]);

        // 2. የተጠቃሚውን ባላንስ መጨመር
        await db.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [amount, user_id]);

        // 3. ሂስትሪ (History) መመዝገብ
        const userRes = await db.query('SELECT balance FROM users WHERE id = $1', [user_id]);
        await db.query(
            'INSERT INTO balance_history (user_id, type, amount, balance_after, description) VALUES ($1, $2, $3, $4, $5)',
            [user_id, 'deposit', amount, userRes.rows[0].balance, `Auto-Approved SMS Deposit (${transactionCode})`]
        );

        await db.query('COMMIT');
        
        console.log(`Successfully auto-approved deposit for user ${user_id}, amount: ${amount}`);
        res.json({ message: "Deposit automatically approved" });

    } catch (err) {
        await db.query('ROLLBACK');
        console.error("SMS Webhook Error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

app.post('/api/deposit-request', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: "Login required" });
    
    try {
        const decoded = jwt.verify(token, SECRET_KEY);
        const { amount, method, code } = req.body;
        
        await db.query(
            'INSERT INTO deposit_requests (user_id, amount, method, transaction_code) VALUES ($1, $2, $3, $4)',
            [decoded.id, amount, method, code]
        );
        
        res.json({ message: "የዲፖዚት ጥያቄዎ ለአድሚን ተልኳል። እባክዎን ጥቂት ደቂቃዎችን ይጠብቁ።" });
    } catch (err) {
        res.status(500).json({ error: "ጥያቄውን መላክ አልተቻለም" });
    }
});

app.post('/api/admin/update-balance', adminOnly, async (req, res) => {
    const { phone, balance } = req.body;
    try {
        const result = await db.query(
            'UPDATE users SET balance = $1 WHERE phone_number = $2 RETURNING *',
            [balance, phone]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: "ተጠቃሚው አልተገኘም" });
        res.json({ message: "ሂሳብ በትክክል ተስተካክሏል", user: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: "ማስተካከሉ አልተሳካም" });
    }
});

app.post('/api/withdraw-request', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: "Login required" });
    
    try {
        const decoded = jwt.verify(token, SECRET_KEY);
        const { amount, method, account } = req.body;
        
        if (amount < 50) return res.status(400).json({ error: "Minimum withdrawal is 50 ETB" });
        
        await db.query('BEGIN');
        const user = await db.query('SELECT balance FROM users WHERE id = $1', [decoded.id]);
        if (user.rows[0].balance < amount) {
            throw new Error("በቂ ባላንስ የልዎትም");
        }
        
        await db.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [amount, decoded.id]);
        await db.query(
            'INSERT INTO withdraw_requests (user_id, amount, method, account_details) VALUES ($1, $2, $3, $4)',
            [decoded.id, amount, method, account]
        );
        
        // Log history
        const userRes = await db.query('SELECT balance FROM users WHERE id = $1', [decoded.id]);
        await db.query(
            'INSERT INTO balance_history (user_id, type, amount, balance_after, description) VALUES ($1, $2, $3, $4, $5)',
            [decoded.id, 'withdrawal', -amount, userRes.rows[0].balance, `Withdrawal Request (${method})`]
        );
        
        await db.query('COMMIT');
        res.json({ message: "የዊዝድሮው ጥያቄዎ ለአድሚን ተልኳል።" });
    } catch (err) {
        await db.query('ROLLBACK');
        res.status(500).json({ error: err.message || "ጥያቄውን መላክ አልተቻለም" });
    }
});

app.get('/api/admin/withdrawals', adminOnly, async (req, res) => {
    try {
        const result = await db.query(`
            SELECT wr.*, u.phone_number, u.name 
            FROM withdraw_requests wr 
            JOIN users u ON wr.user_id = u.id 
            WHERE wr.status = 'pending' 
            ORDER BY wr.created_at DESC
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: "መረጃውን ማምጣት አልተቻለም" });
    }
});

app.post('/api/admin/handle-withdraw', adminOnly, async (req, res) => {
    const { withdrawId, action } = req.body;
    try {
        await db.query('BEGIN');
        const withdraw = await db.query('SELECT * FROM withdraw_requests WHERE id = $1', [withdrawId]);
        if (withdraw.rows.length === 0) throw new Error("ጥያቄው አልተገኘም");
        
        if (action === 'approve') {
            await db.query('UPDATE withdraw_requests SET status = $1 WHERE id = $2', ['approved', withdrawId]);
        } else {
            const { user_id, amount } = withdraw.rows[0];
            await db.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [amount, user_id]);
            await db.query('UPDATE withdraw_requests SET status = $1 WHERE id = $2', ['rejected', withdrawId]);
            
            // Log history for refund
            const userRes = await db.query('SELECT balance FROM users WHERE id = $1', [user_id]);
            await db.query(
                'INSERT INTO balance_history (user_id, type, amount, balance_after, description) VALUES ($1, $2, $3, $4, $5)',
                [user_id, 'refund', amount, userRes.rows[0].balance, 'Withdrawal Refund (Rejected)']
            );
        }
        
        await db.query('COMMIT');
        res.json({ message: "ተግባሩ በተሳካ ሁኔታ ተከናውኗል" });
    } catch (err) {
        await db.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/balance-history', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: "Login required" });
    try {
        const decoded = jwt.verify(token, SECRET_KEY);
        const result = await db.query('SELECT * FROM balance_history WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', [decoded.id]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch history" });
    }
});

app.post('/api/admin/broadcast', adminOnly, async (req, res) => {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "መልዕክት ያስገቡ" });

    try {
        const result = await db.query('SELECT telegram_chat_id FROM users WHERE telegram_chat_id IS NOT NULL');
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        const telegramUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
        
        const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
        
        let successCount = 0;
        let failCount = 0;

        for (const user of result.rows) {
            try {
                await fetch(telegramUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: user.telegram_chat_id,
                        text: message
                    })
                });
                successCount++;
            } catch (err) {
                console.error(`Failed to send broadcast to ${user.telegram_chat_id}:`, err);
                failCount++;
            }
        }

        res.json({ message: `ብሮድካስት ተጠናቋል! ለ ${successCount} ተጠቃሚዎች ተልኳል: ${failCount} አልተሳካም።` });
    } catch (err) {
        console.error('Broadcast Error:', err);
        res.status(500).json({ error: "ብሮድካስት ማድረግ አልተቻለም: " + err.message });
    }
});

function startRoomCountdown(amount) {
    const room = rooms[amount];
    if (!room) return;
    
    console.log(`Starting countdown for room ${amount}`);
    room.gameCountdown = 30;
    if (room.countdownInterval) clearInterval(room.countdownInterval);
    
    room.countdownInterval = setInterval(() => {
        if (room.gameInterval) {
            // If a game is already running, don't count down
            return;
        }

        room.gameCountdown--;
        
        // Broadcast ONLY to clients in this specific room
        broadcastToRoom(amount, { 
            type: 'COUNTDOWN', 
            value: room.gameCountdown, 
            room: amount 
        });

        // Update global stats so Stake Screen timers update
        updateGlobalStats();

        if (room.gameCountdown <= 0) {
            clearInterval(room.countdownInterval);
            room.countdownInterval = null;
            
            const playersWithCards = Array.from(room.players).filter(p => p.cardNumber);
            if (playersWithCards.length > 0) {
                startRoomGame(amount);
            } else {
                startRoomCountdown(amount);
            }
        }
    }, 1000);
}

function startRoomGame(amount) {
    const room = rooms[amount];
    if (!room) return;
    
    room.balls = Array.from({length: 75}, (_, i) => i + 1);
    room.drawnBalls = [];
    
    broadcastToRoom(amount, { 
        type: 'GAME_START', 
        message: `${amount} ETB ጨዋታ ተጀምሯል!`, 
        room: amount 
    });

    updateGlobalStats();

    if (room.gameInterval) clearInterval(room.gameInterval);
    room.gameInterval = setInterval(() => {
        if (room.balls.length > 0) {
            const randomIndex = Math.floor(Math.random() * room.balls.length);
            const ball = room.balls.splice(randomIndex, 1)[0];
            room.drawnBalls.push(ball);
            
            // Log for debugging
            console.log(`Room ${amount}: Ball drawn ${ball}. History: ${room.drawnBalls.join(',')}`);

            broadcastToRoom(amount, { 
                type: 'NEW_BALL', 
                ball, 
                history: room.drawnBalls, 
                room: amount 
            });
        } else { 
            clearInterval(room.gameInterval);
            room.gameInterval = null;
            
            // Reset player card data after game ends
            room.players.forEach(p => {
                p.cardNumber = null;
                p.cardData = null;
            });
            
            updateGlobalStats();
            // Wait 5s then restart the continuous countdown
            setTimeout(() => startRoomCountdown(amount), 5000);
        }
    }, 3000);
}

function broadcastToRoom(amount, data) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client.room == amount) {
            client.send(JSON.stringify(data));
        }
    });
}

function broadcastAll(data) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}

function updateGlobalStats() {
    const stats = {};
    const timers = {};
    const takenCards = {};
    const prizes = {};
    
    STAKES.forEach(amount => {
        if (rooms[amount]) {
            const playersWithCards = Array.from(rooms[amount].players).filter(p => {
                const roomData = p.roomData ? p.roomData[amount] : null;
                return p.cardNumber || (roomData && roomData.cardNumber);
            });
            
            stats[amount] = playersWithCards.length;
            timers[amount] = rooms[amount].gameInterval ? 'PLAYING' : rooms[amount].gameCountdown;
            
            // Prize calculation logic
            const playersCount = playersWithCards.length;
            const totalPool = amount * playersCount;
            
            let winAmount = 0;
            if (amount === 5) {
                // For 5 ETB room: 1 ETB per player goes to app, rest to winner
                // If 10 players: 10 * 5 = 50 total. 10 * 1 = 10 for app. 40 for winner.
                // Wait, the user said "10 ሰው ቢጫወት 5 ብር ለአፑ 45 ብር ለአሸናፊው"
                // That means 0.50 ETB per player for the app? 
                // Let's re-read: "5 ብር ለአፑ 45 ብር ለአሸናፊው" -> 5/50 = 10%
                // So for 5 ETB room, it's 10% commission.
                winAmount = totalPool * 0.9;
            } else {
                winAmount = totalPool * 0.8; // 20% commission for others
            }
            prizes[amount] = winAmount;
            
            // Collect taken card numbers for this room
            const roomTaken = [];
            rooms[amount].players.forEach(p => {
                const rData = p.roomData ? p.roomData[amount] : null;
                const cNum = rData ? rData.cardNumber : p.cardNumber;
                if (cNum) roomTaken.push(cNum);
            });
            takenCards[amount] = roomTaken;
        }
    });
    broadcastAll({ type: 'ROOM_STATS', stats, timers, takenCards, prizes });
}

function checkWin(cardData, drawnBalls) {
    if (!cardData) return null;
    const drawnSet = new Set(drawnBalls);
    drawnSet.add('FREE');

    const letters = ['B', 'I', 'N', 'G', 'O'];
    const grid = letters.map(l => cardData[l]);

    // Check Rows
    for (let r = 0; r < 5; r++) {
        let win = true;
        let pattern = [];
        for (let c = 0; c < 5; c++) {
            pattern.push(grid[c][r]);
            if (!drawnSet.has(grid[c][r])) { win = false; break; }
        }
        if (win) return { type: 'ROW', pattern };
    }

    // Check Columns
    for (let c = 0; c < 5; c++) {
        let win = true;
        let pattern = [];
        for (let r = 0; r < 5; r++) {
            pattern.push(grid[c][r]);
            if (!drawnSet.has(grid[c][r])) { win = false; break; }
        }
        if (win) return { type: 'COLUMN', pattern };
    }

    // Check Diagonals
    let diag1 = true;
    let diag1Pattern = [];
    let diag2 = true;
    let diag2Pattern = [];
    for (let i = 0; i < 5; i++) {
        diag1Pattern.push(grid[i][i]);
        if (!drawnSet.has(grid[i][i])) diag1 = false;
        
        diag2Pattern.push(grid[i][4 - i]);
        if (!drawnSet.has(grid[i][4 - i])) diag2 = false;
    }
    if (diag1) return { type: 'DIAGONAL', pattern: diag1Pattern };
    if (diag2) return { type: 'DIAGONAL', pattern: diag2Pattern };

    // Check Corners
    if (drawnSet.has(grid[0][0]) && drawnSet.has(grid[4][0]) && 
        drawnSet.has(grid[0][4]) && drawnSet.has(grid[4][4])) {
        return { type: 'CORNERS', pattern: [grid[0][0], grid[4][0], grid[0][4], grid[4][4]] };
    }

    return null;
}

wss.on('connection', (ws) => {
    ws.on('message', async (message) => {
        const data = JSON.parse(message);
        
        if (data.type === 'BINGO_CLAIM') {
            const room = rooms[data.room];
            if (!room || !room.gameInterval) return;

            console.log(`Bingo claim received for Room ${data.room}, Card ${data.cardNumber}`);

            // Find the player who claimed in THIS room
            let playerWs = null;
            room.players.forEach(p => {
                // Check both direct property and roomData object
                const pCard = (p.roomData && p.roomData[data.room]) ? p.roomData[data.room].cardNumber : p.cardNumber;
                if (pCard == data.cardNumber) {
                    playerWs = p;
                }
            });

            if (playerWs && playerWs.userId) {
                // Use the room-specific card data if available
                const roomData = (playerWs.roomData && playerWs.roomData[data.room]) ? playerWs.roomData[data.room] : { cardData: playerWs.cardData };
                const cardData = roomData.cardData;

                if (cardData) {
                    const winInfo = checkWin(cardData, room.drawnBalls);
                    if (winInfo) {
                        // Winner found! Stop the game
                        clearInterval(room.gameInterval);
                        room.gameInterval = null;

                        // Calculate reward distribution
                        const stake = room.stake;
                        const playersCount = Array.from(room.players).filter(p => {
                            const roomData = p.roomData ? p.roomData[data.room] : null;
                            return p.cardNumber || (roomData && roomData.cardNumber);
                        }).length;
                        const totalPool = stake * playersCount;
                        
                        let winnerShare = 0.8; // Default 80%
                        if (stake === 5) {
                            winnerShare = 0.9; // 90% for 5 ETB room (10% to app)
                        }
                        
                        const winAmount = totalPool * winnerShare;
                        
                        // Update winner balance in DB
                        try {
                            await db.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [winAmount, playerWs.userId]);
                            const winnerRes = await db.query('SELECT balance FROM users WHERE id = $1', [playerWs.userId]);
                            await db.query(
                                'INSERT INTO balance_history (user_id, type, amount, balance_after, description) VALUES ($1, $2, $3, $4, $5)',
                                [playerWs.userId, 'win', winAmount, winnerRes.rows[0].balance, `Bingo Win (Room ${data.room})`]
                            );
                            console.log(`User ${playerWs.userId} won ${winAmount} in Room ${data.room}`);
                        } catch (err) {
                            console.error('Win Update Error:', err);
                        }

                        broadcastToRoom(data.room, {
                            type: 'GAME_OVER',
                            winner: playerWs.name || playerWs.username || 'ተጫዋች',
                            message: `🎉 ቢንጎ! ${playerWs.name || playerWs.username} ${winAmount.toFixed(2)} ETB አሸንፏል!`,
                            winCard: cardData,
                            winPattern: winInfo.pattern,
                            room: data.room
                        });

                        // Reset for next game
                        room.players.forEach(p => {
                            if (p.roomData) delete p.roomData[data.room];
                            p.cardNumber = null;
                            p.cardData = null;
                        });
                        
                        updateGlobalStats();
                        setTimeout(() => startRoomCountdown(data.room), 5000);
                    } else {
                        ws.send(JSON.stringify({ type: 'ERROR', message: 'ቢንጎ ገና አልሞላም!' }));
                    }
                }
            }
        }
        if (data.type === 'JOIN_ROOM') {
            // Validate token and attach user ID if not already attached
            if (data.token) {
                try {
                    const decoded = jwt.verify(data.token, SECRET_KEY);
                    ws.userId = decoded.id;
                    ws.username = decoded.username;
                    const userRes = await db.query('SELECT name FROM users WHERE id = $1', [ws.userId]);
                    if (userRes.rows.length > 0) ws.name = userRes.rows[0].name;
                } catch (e) { console.error("Token verification failed in JOIN_ROOM"); }
            }

            // Remove from old room if any
            if (ws.room && rooms[ws.room]) {
                rooms[ws.room].players.delete(ws);
            }
            
            ws.room = data.room;
            const room = rooms[ws.room];
            if (room) {
                room.players.add(ws);
                // Also get taken cards for this specific room
                const roomTaken = [];
                room.players.forEach(p => {
                    if (p.cardNumber) roomTaken.push(p.cardNumber);
                });
                
                ws.send(JSON.stringify({ 
                    type: 'INIT', 
                    history: room.drawnBalls,
                    countdown: room.gameCountdown,
                    room: ws.room,
                    takenCards: roomTaken,
                    isGameRunning: room.gameInterval !== null
                }));
                updateGlobalStats();
            }
        }
        
        if (data.type === 'BUY_CARD') {
            if (!ws.room || !ws.userId) return;

            // Deduct balance from DB
            try {
                const stake = rooms[ws.room].stake;
                const user = await db.query('SELECT balance FROM users WHERE id = $1', [ws.userId]);
                if (user.rows[0].balance < stake) {
                    return ws.send(JSON.stringify({ type: 'ERROR', message: 'በቂ ባላንስ የልዎትም!' }));
                }

                await db.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [stake, ws.userId]);
                const updatedUser = await db.query('SELECT balance FROM users WHERE id = $1', [ws.userId]);
                
                // Log history
                await db.query(
                    'INSERT INTO balance_history (user_id, type, amount, balance_after, description) VALUES ($1, $2, $3, $4, $5)',
                    [ws.userId, 'stake', -stake, updatedUser.rows[0].balance, `Game Stake (Room ${ws.room})`]
                );

                // Notify client of new balance
                ws.send(JSON.stringify({ 
                    type: 'BALANCE_UPDATE', 
                    balance: updatedUser.rows[0].balance 
                }));

                // Store card data per room on the connection object
                if (!ws.roomData) ws.roomData = {};
                ws.roomData[ws.room] = {
                    cardNumber: data.cardNumber,
                    cardData: data.cardData
                };
                
                // For backward compatibility/simplicity in broadcasting
                ws.cardNumber = data.cardNumber;
                ws.cardData = data.cardData;

                console.log(`Room ${ws.room}: Card ${data.cardNumber} bought by User ${ws.userId}`);
                updateGlobalStats();
            } catch (err) {
                console.error('Buy Card Error:', err);
                ws.send(JSON.stringify({ type: 'ERROR', message: 'የካርድ ግዢ አልተሳካም!' }));
            }
        }
    });

    ws.on('close', () => {
        if (ws.room && rooms[ws.room]) {
            rooms[ws.room].players.delete(ws);
            updateGlobalStats();
        }
    });
});

// --- HEALTH CHECK ---
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// --- DATABASE INITIALIZATION ---
async function initDatabase() {
    try {
        await db.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                phone_number VARCHAR(20) UNIQUE NOT NULL,
                password_hash VARCHAR(256) NOT NULL,
                username VARCHAR(64),
                name VARCHAR(100),
                balance DECIMAL(10, 2) DEFAULT 0,
                player_id VARCHAR(20),
                telegram_chat_id VARCHAR(50),
                is_admin BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS balance_history (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                type VARCHAR(50), -- 'deposit', 'withdrawal', 'stake', 'win'
                amount DECIMAL(10, 2) NOT NULL,
                balance_after DECIMAL(10, 2),
                description TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS deposit_requests (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                amount DECIMAL(10, 2) NOT NULL,
                method VARCHAR(50),
                transaction_code VARCHAR(100),
                status VARCHAR(20) DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS withdraw_requests (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                amount DECIMAL(10, 2) NOT NULL,
                method VARCHAR(50),
                account_details TEXT,
                status VARCHAR(20) DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- Ensure columns exist for existing tables
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='player_id') THEN
                    ALTER TABLE users ADD COLUMN player_id VARCHAR(20);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='is_admin') THEN
                    ALTER TABLE users ADD COLUMN is_admin BOOLEAN DEFAULT FALSE;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='telegram_chat_id') THEN
                    ALTER TABLE users ADD COLUMN telegram_chat_id VARCHAR(50);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='created_at') THEN
                    ALTER TABLE users ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
                END IF;
            END $$;
        `);
        console.log("Database initialized successfully.");
    } catch (err) {
        console.error("Database initialization failed:", err);
    }
}

server.listen(PORT, '0.0.0.0', async () => {
    console.log(`Server running on port ${PORT}`);
    
    // Start countdowns immediately
    STAKES.forEach(amount => {
        startRoomCountdown(amount);
    });

    await initDatabase();
});