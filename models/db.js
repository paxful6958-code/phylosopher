const Datastore = require('@seald-io/nedb');
const path = require('path');
const fs = require('fs');

const dbDir = path.join(__dirname, '../database');
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

// Single shared instance for tradexora.db
const db = new Datastore({
    filename: path.join(__dirname, '../tradexora.db'),
    autoload: true
});

// Single shared instance for chats.db
const chatDb = new Datastore({
    filename: path.join(dbDir, 'chats.db'),
    autoload: true
});

// Attach chatDb onto db so existing `const db = require('../models/db')` calls keep working
db.chatDb = chatDb;

module.exports = db;