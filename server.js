const express = require('express');
const cors = require('cors');
const path = require('path');
const sqlite3 = require('sqlite3').verbose(); // Load SQLite Engine

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 1. INITIALIZE DATABASE FILE SYSTEM
const db = new sqlite3.Database('./bank.db', (err) => {
    if (err) console.error("Database connection failed:", err.message);
    else console.log("Connected to the secure permanent database file (bank.db).");
});

// Create tables and inject a default demo account if empty
db.serialize(() => {
    // Table for User Balances and Profiles
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT,
        upi_id TEXT,
        pin TEXT,
        balance REAL
    )`);

    // Table for Storing Transaction Ledgers
    db.run(`CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT,
        message TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Inject demo administrative identity profile if it doesn't exist
    db.get("SELECT * FROM users WHERE username = 'admin'", [], (err, row) => {
        if (!row) {
            db.run("INSERT INTO users (username, password, upi_id, pin, balance) VALUES (?, ?, ?, ?, ?)",
                ['admin', '1234', 'admin@okbank', '9999', 1500.00]);
        }
    });
});

// Tracks active session state in local memory
let currentSessionUser = null;

// Helper to quickly pull up dynamic history lines via SQL
function getHistory(username, callback) {
    db.all("SELECT message FROM transactions WHERE username = ? ORDER BY id DESC", [username], (err, rows) => {
        if (err) return callback([]);
        const messages = rows.map(r => r.message);
        callback(messages);
    });
}

// 2. BACKEND API ENDPOINTS WITH SQL QUERIES

// Session Login Path
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    db.get("SELECT * FROM users WHERE username = ? AND password = ?", [username, password], (err, user) => {
        if (user) {
            currentSessionUser = username;
            return res.json({ success: true, message: "Authorized identity profile match." });
        }
        res.status(401).json({ success: false, message: "Wrong username or password!" });
    });
});

// Fetch Dashboard Profiles Live Data Stream
app.get('/api/account', (req, res) => {
    if (!currentSessionUser) {
        return res.json({ isLoggedIn: false, balance: 0, upiId: "", history: [] });
    }

    db.get("SELECT balance, upi_id FROM users WHERE username = ?", [currentSessionUser], (err, user) => {
        getHistory(currentSessionUser, (historyLogs) => {
            res.json({
                isLoggedIn: true,
                balance: user.balance,
                upiId: user.upi_id,
                history: historyLogs
            });
        });
    });
});

// Add Cash Capital Injection Route
app.post('/api/deposit', (req, res) => {
    const { amount } = req.body;
    if (!currentSessionUser || !amount || amount <= 0) {
        return res.status(400).json({ success: false, message: "Operation denied." });
    }

    const logMessage = `Deposited $${parseFloat(amount).toFixed(2)}`;

    db.serialize(() => {
        // Update money directly inside the SQL profile record
        db.run("UPDATE users SET balance = balance + ? WHERE username = ?", [amount, currentSessionUser]);
        // Insert record log down inside database transaction audit system rows
        db.run("INSERT INTO transactions (username, message) VALUES (?, ?)", [currentSessionUser, logMessage], () => {
            
            // Return fresh system calculations back out into frontend components
            db.get("SELECT balance FROM users WHERE username = ?", [currentSessionUser], (err, user) => {
                getHistory(currentSessionUser, (historyLogs) => {
                    res.json({ success: true, balance: user.balance, history: historyLogs });
                });
            });
        });
    });
});

// Instant Wire Transfer Routing Engine Endpoint Route
app.post('/api/upi-transfer', (req, res) => {
    const { upiId, amount, pin } = req.body;

    if (!currentSessionUser) return res.status(401).json({ success: false, message: "Session expired." });

    db.get("SELECT balance, pin FROM users WHERE username = ?", [currentSessionUser], (err, user) => {
        if (pin !== user.pin) {
            return res.status(403).json({ success: false, message: "Wrong PIN! Transfer cancelled." });
        }
        if (amount > user.balance) {
            return res.status(400).json({ success: false, message: "You do not have enough money!" });
        }

        const logMessage = `Sent $${parseFloat(amount).toFixed(2)} to ${upiId}`;

        db.serialize(() => {
            db.run("UPDATE users SET balance = balance - ? WHERE username = ?", [amount, currentSessionUser]);
            db.run("INSERT INTO transactions (username, message) VALUES (?, ?)", [currentSessionUser, logMessage], () => {
                
                db.get("SELECT balance FROM users WHERE username = ?", [currentSessionUser], (err, updatedUser) => {
                    getHistory(currentSessionUser, (historyLogs) => {
                        res.json({ success: true, balance: updatedUser.balance, history: historyLogs });
                    });
                });
            });
        });
    });
});

// Utility Bills Processing Routing Endpoint Route
app.post('/api/pay-bill', (req, res) => {
    const { type, accountNumber, amount, pin } = req.body;

    if (!currentSessionUser) return res.status(401).json({ success: false, message: "Session expired." });

    db.get("SELECT balance, pin FROM users WHERE username = ?", [currentSessionUser], (err, user) => {
        if (pin !== user.pin) {
            return res.status(403).json({ success: false, message: "Wrong PIN! Payment cancelled." });
        }
        if (amount > user.balance) {
            return res.status(400).json({ success: false, message: "Declined: Insufficient funds!" });
        }

        const logMessage = `${type} Bill Paid: $${parseFloat(amount).toFixed(2)} [Ref: ${accountNumber}]`;

        db.serialize(() => {
            db.run("UPDATE users SET balance = balance - ? WHERE username = ?", [amount, currentSessionUser]);
            db.run("INSERT INTO transactions (username, message) VALUES (?, ?)", [currentSessionUser, logMessage], () => {
                
                db.get("SELECT balance FROM users WHERE username = ?", [currentSessionUser], (err, updatedUser) => {
                    getHistory(currentSessionUser, (historyLogs) => {
                        res.json({ success: true, balance: updatedUser.balance, history: historyLogs });
                    });
                });
            });
        });
    });
});

// Session Logout Route
app.post('/api/logout', (req, res) => {
    currentSessionUser = null;
    res.json({ success: true });
});

app.listen(PORT, () => {
    console.log(`IPPM Bank Server is live at http://localhost:${PORT}`);
});
// 1. Account Registration Route (Signup)
app.post('/api/register', (req, res) => {
    const { username, password, pin } = req.body;

    if (!username || !password || !pin) {
        return res.status(400).json({ success: false, message: "Please fill out all input fields!" });
    }
    if (pin.length !== 4 || isNaN(pin)) {
        return res.status(400).json({ success: false, message: "Security PIN must be exactly 4 numbers!" });
    }

    // Auto-generate a custom UPI ID for the user
    const upiId = `${username.toLowerCase()}@okbank`;
    const startingBalance = 1000.00; // Gift new users a starting balance

    // Check if the username already exists in the database
    db.get("SELECT * FROM users WHERE username = ?", [username], (err, row) => {
        if (row) {
            return res.status(400).json({ success: false, message: "Username is already taken!" });
        }

        // Insert the new user into the database
        db.run("INSERT INTO users (username, password, upi_id, pin, balance) VALUES (?, ?, ?, ?, ?)",
            [username, password, upiId, pin, startingBalance], (err) => {
                if (err) {
                    return res.status(500).json({ success: false, message: "Database registration error." });
                }
                res.json({ success: true, message: "Account created successfully! You can now log in." });
            }
        );
    });
});
