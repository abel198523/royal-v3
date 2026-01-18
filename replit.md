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
- **Environment Variables**: 
  - `DATABASE_URL`: PostgreSQL connection string.
  - `SESSION_SECRET` / `JWT_SECRET`: Secret key for auth.
  - `TELEGRAM_BOT_TOKEN`: Your Telegram Bot token from @BotFather.
  - `WEB_URL`: Your Render public URL (e.g., `https://fidel-bingo.onrender.com`). **Required for Webhook**.
- **Build Command**: `npm install`
- **Start Command**: `node server.js`
- **Port**: 5000

## Telegram Webhook Setup
The application automatically sets the Telegram webhook on startup if `TELEGRAM_BOT_TOKEN` and `WEB_URL` are provided. 
1. Go to Render Dashboard -> Settings -> Environment Variables.
2. Add `WEB_URL` with your Render app URL.
3. Restart the service.
4. The server will call `setWebhook` automatically.
