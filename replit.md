# Fidel Bingo

## Overview
A web-based Bingo game application with real-time gameplay using WebSockets.

## Tech Stack
- **Backend**: Node.js, Express.js
- **WebSockets**: ws library for real-time game updates
- **Database**: PostgreSQL (Replit built-in)
- **Authentication**: bcryptjs + jsonwebtoken

## Project Structure
```
├── server.js      # Express server, WebSocket handler, API routes
├── db.js          # PostgreSQL connection pool
├── game.js        # Client-side game logic
├── index.html     # Main game interface
├── style.css      # Game styling
└── package.json   # Dependencies
```

## Running the Application
- Server runs on port 5000 (bound to 0.0.0.0)
- WebSocket connection established automatically on page load
- Game starts automatically with 5-second ball draw intervals

## Database Schema
- `users` table: id, phone_number, password_hash, username, name, balance
- `deposit_requests` table: id, user_id, amount, method, transaction_code, status, created_at
- `withdraw_requests` table: id, user_id, amount, method, account_details, status, created_at

## API Endpoints
- `POST /api/login` - User authentication with phone and password

## Deployment (Render.com / Replit)
- **Environment Variables**: Ensure `DATABASE_URL` (PostgreSQL), `SESSION_SECRET`, `JWT_SECRET`, and `TELEGRAM_BOT_TOKEN` are configured.
- **Build Command**: `npm install && pip install pyTelegramBotAPI psycopg2-binary python-dotenv requests bcrypt`
- **Start Command**: `node server.js` (Web) and `python telegram_bot.py` (Worker)
- **Port**: 5000
