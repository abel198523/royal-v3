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

const SECRET_KEY = "bingo_secret_123";
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let balls = [];
let drawnBalls = [];
let gameInterval;
let players = {}; // ተሳታፊዎችን ለመያዝ

// --- AUTH API ---
app.post('/api/login', async (req, res) => {
    const { phone, password } = req.body;
    try {
        const result = await db.query('SELECT * FROM users WHERE phone_number = $1', [phone]);
        if (result.rows.length === 0) return res.status(404).json({ error: "ተጠቃሚው አልተገኘም" });
        const isMatch = await bcrypt.compare(password, result.rows[0].password_hash);
        if (!isMatch) return res.status(401).json({ error: "ስህተት" });
        
        const token = jwt.sign({ id: result.rows[0].id, username: result.rows[0].username }, SECRET_KEY);
        res.json({ token, username: result.rows[0].username, balance: result.rows[0].balance });
    } catch (err) { res.status(500).send(err); }
});

// --- BINGO LOGIC ---
function startNewGame() {
    balls = Array.from({length: 75}, (_, i) => i + 1);
    drawnBalls = [];
    players = {}; 
    broadcast({ type: 'GAME_START', message: "አዲስ ጨዋታ ተጀምሯል!" });

    gameInterval = setInterval(() => {
        if (balls.length > 0) {
            const randomIndex = Math.floor(Math.random() * balls.length);
            const ball = balls.splice(randomIndex, 1)[0];
            drawnBalls.push(ball);
            broadcast({ type: 'NEW_BALL', ball, history: drawnBalls });
        } else { clearInterval(gameInterval); }
    }, 5000);
}

function broadcast(data) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(data));
    });
}

wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'INIT', history: drawnBalls }));
    
    ws.on('message', async (message) => {
        const data = JSON.parse(message);
        if (data.type === 'BUY_CARD') {
            // እዚህ ጋር የገንዘብ ቅነሳ እና የካርድ ምዝገባ ሎጂክ ይገባል
            console.log(`${data.cardNumber} ተገዝቷል`);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    startNewGame();
});