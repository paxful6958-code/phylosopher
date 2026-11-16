// models/User.js
const db = require('./db');

db.ensureIndex({ fieldName: 'email', unique: true }, (err) => {
    if (err) console.error('Index error:', err);
});

module.exports = db;