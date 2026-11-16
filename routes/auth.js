// routes/auth.js
const express = require('express');
const router = express.Router();
const User = require('../models/User');

// --- Chat Datastore (NeDB) Setup with Directory Auto-Creation ---
const Datastore = require('nedb');
const path = require('path');
const fs = require('fs');

const dbDir = path.join(__dirname, '../database');
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

const chatDb = new Datastore({
    filename: path.join(dbDir, 'chats.db'),
    autoload: true
});

// User Registration Route
router.post('/signup', (req, res) => {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
        return res.status(400).json({ success: false, message: 'Please fill in all fields.' });
    }

    User.findOne({ email: email }, (err, existingUser) => {
        if (existingUser) {
            return res.status(400).json({ success: false, message: 'Email is already registered.' });
        }

        const newUser = {
            username: username.trim(),
            email: email.trim(),
            password: password,
            role: 'user',
            kycStatus: 'PENDING',
            wallet: {
                realBalance: 0.00,
                demoBalance: 10000.00
            },
            createdAt: new Date()
        };

        User.insert(newUser, (err, doc) => {
            if (err) {
                return res.status(500).json({ success: false, error: err.message });
            }

            res.status(201).json({
                success: true,
                message: 'Account created successfully!',
                userId: doc._id
            });
        });
    });
});

// User Login Route
router.post('/login', (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ success: false, message: 'Please provide email and password.' });
    }

    User.findOne({ email: email }, (err, user) => {
        if (err || !user) {
            return res.status(401).json({ success: false, message: 'Invalid email or password.' });
        }

        if (user.password !== password) {
            return res.status(401).json({ success: false, message: 'Invalid email or password.' });
        }

        res.json({
            success: true,
            message: 'Login successful',
            user: {
                id: user._id,
                username: user.username,
                email: user.email,
                role: user.role,
                wallet: user.wallet || { realBalance: 0, demoBalance: 10000 }
            }
        });
    });
});

// Get User Profile & Wallet Details by ID
router.get('/profile/:id', (req, res) => {
    const userId = req.params.id;

    User.findOne({ _id: userId }, (err, user) => {
        if (err || !user) {
            return res.status(404).json({ success: false, message: 'User not found.' });
        }

        res.json({
            success: true,
            user: {
                id: user._id,
                username: user.username,
                email: user.email,
                role: user.role,
                wallet: user.wallet || { realBalance: 0, demoBalance: 10000 }
            }
        });
    });
});

// Update user wallet balance from trading profits/losses
router.post('/wallet/update', (req, res) => {
    const { userId, accountType, profitAmount } = req.body;
    const amount = parseFloat(profitAmount);

    if (!userId || isNaN(amount)) {
        return res.status(400).json({ success: false, message: 'Invalid payload: userId and numeric profitAmount required.' });
    }

    User.findOne({ _id: userId }, (err, user) => {
        if (err || !user) {
            return res.status(404).json({ success: false, message: 'User not found.' });
        }

        const currentWallet = user.wallet || { realBalance: 0, demoBalance: 10000 };
        let realBalance = Number(currentWallet.realBalance || 0);
        let demoBalance = Number(currentWallet.demoBalance !== undefined ? currentWallet.demoBalance : 10000);

        if (accountType === 'Real') {
            realBalance = Math.max(0, realBalance + amount);
        } else {
            demoBalance = Math.max(0, demoBalance + amount);
        }

        const updatedWallet = { realBalance, demoBalance };

        User.update({ _id: userId }, { $set: { wallet: updatedWallet } }, {}, (err, numUpdated) => {
            if (err || numUpdated === 0) {
                return res.status(500).json({ success: false, message: 'Failed to update database balance.' });
            }
            res.json({ success: true, wallet: updatedWallet });
        });
    });
});

// M-Pesa STK Push Callback / Webhook Route
router.post('/mpesa/callback', (req, res) => {
    const body = req.body;

    try {
        const callbackData = (body && body.Body && body.Body.stkCallback) || body;
        const resultCode = callbackData.ResultCode;

        if (resultCode === 0) {
            const metadata = (callbackData && callbackData.CallbackMetadata && callbackData.CallbackMetadata.Item) || [];
            let amountPaid = 0;
            let mpesaReceiptNumber = '';

            metadata.forEach(item => {
                if (item.Name === 'Amount') amountPaid = parseFloat(item.Value);
                if (item.Name === 'MpesaReceiptNumber') mpesaReceiptNumber = item.Value;
            });

            const userId = callbackData.CheckoutRequestID || req.query.userId || body.userId;

            if (!userId || isNaN(amountPaid) || amountPaid <= 0) {
                return res.status(400).json({ success: false, message: 'Invalid callback metadata: missing userId or amount.' });
            }

            User.findOne({ _id: userId }, (err, user) => {
                if (err || !user) {
                    return res.status(404).json({ success: false, message: 'User not found for deposit.' });
                }

                const currentWallet = user.wallet || { realBalance: 0, demoBalance: 10000 };
                const newRealBalance = Number(currentWallet.realBalance || 0) + amountPaid;
                const updatedWallet = {
                    realBalance: newRealBalance,
                    demoBalance: Number(currentWallet.demoBalance !== undefined ? currentWallet.demoBalance : 10000)
                };

                User.update({ _id: userId }, { $set: { wallet: updatedWallet } }, {}, (updateErr, numUpdated) => {
                    if (updateErr || numUpdated === 0) {
                        return res.status(500).json({ success: false, message: 'Failed to update wallet balance in database.' });
                    }
                    console.log(`✅ STK Push Success: Credited $${amountPaid} to user ${userId} (Receipt: ${mpesaReceiptNumber})`);
                    res.json({ success: true, message: 'Real balance updated successfully.' });
                });
            });
        } else {
            console.log('❌ STK Push Failed or Cancelled:', callbackData.ResultDesc || 'Transaction cancelled');
            res.json({ success: true, message: 'Callback received (Transaction failed/cancelled).' });
        }
    } catch (err) {
        console.error('M-Pesa callback processing error:', err);
        res.status(500).json({ success: false, message: 'Server error processing callback.' });
    }
});

// ==========================================
// USER SUPPORT CHAT ROUTES
// ==========================================

// Get messages for a specific user thread
router.get('/chat/:userId', (req, res) => {
    const { userId } = req.params;
    chatDb.find({ userId: userId }).sort({ timestamp: 1 }).exec((err, messages) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json({ success: true, messages });
    });
});

// Send a message (User or Admin)
router.post('/chat/send', (req, res) => {
    const { userId, sender, message } = req.body;

    if (!userId || !message) {
        return res.status(400).json({ success: false, message: 'Missing userId or message.' });
    }

    const chatMessage = {
        userId: String(userId),
        sender: sender || 'user',
        message: String(message).trim(),
        timestamp: new Date()
    };

    chatDb.insert(chatMessage, (err, doc) => {
        if (err) {
            console.error('❌ NeDB Chat Insert Error:', err);
            return res.status(500).json({ success: false, error: err.message });
        }
        res.json({ success: true, message: doc });
    });
});

module.exports = router;