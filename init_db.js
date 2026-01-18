const db = require('./db');

async function initDB() {
    try {
        console.log('Initializing database tables...');
        
        // Users Table
        await db.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(255) UNIQUE,
                telegram_chat_id VARCHAR(255) UNIQUE,
                name VARCHAR(255),
                balance DOUBLE PRECISION DEFAULT 0,
                player_id VARCHAR(50),
                phone_number VARCHAR(50),
                password_hash VARCHAR(255),
                is_admin BOOLEAN DEFAULT FALSE,
                referred_by VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Deposit Requests Table
        await db.query(`
            CREATE TABLE IF NOT EXISTS deposit_requests (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                amount DOUBLE PRECISION NOT NULL,
                method VARCHAR(50),
                transaction_code VARCHAR(255),
                status VARCHAR(20) DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Withdraw Requests Table
        await db.query(`
            CREATE TABLE IF NOT EXISTS withdraw_requests (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                amount DOUBLE PRECISION NOT NULL,
                method VARCHAR(50),
                account_details TEXT,
                status VARCHAR(20) DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Balance History Table
        await db.query(`
            CREATE TABLE IF NOT EXISTS balance_history (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                type VARCHAR(50),
                amount DOUBLE PRECISION,
                balance_after DOUBLE PRECISION,
                description TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        console.log('Database tables initialized successfully.');
    } catch (err) {
        console.error('Error initializing database tables:', err);
    }
}

module.exports = initDB;
