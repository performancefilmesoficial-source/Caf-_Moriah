'use strict';
const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { getDb } = require('../config/database');
const { authenticateJWT, JWT_SECRET } = require('../middleware/auth');
const { loginLimiter } = require('../middleware/rateLimiters');

const router = express.Router();

async function hashPwd(password) { return bcrypt.hash(password, 10); }

async function verifyPwd(password, hash) {
    if (hash.length === 64 && !hash.startsWith('$')) {
        const preHash = crypto.createHash('sha256').update(password + 'moriah_pdv_2024').digest('hex');
        return preHash === hash;
    }
    return bcrypt.compare(password, hash);
}

// POST /api/auth/login
router.post('/login', loginLimiter, async (req, res, next) => {
    const { username, password } = req.body;
    if (!username || !password)
        return res.status(400).json({ error: 'Usuário e senha obrigatórios.' });
    try {
        const db = getDb();
        const [rows] = await db.query('SELECT * FROM pdv_users WHERE username = ?', [username]);
        if (!rows.length)
            return res.status(401).json({ error: 'Usuário ou senha incorretos.' });

        const u = rows[0];
        const valid = await verifyPwd(password, u.password_hash);
        if (!valid)
            return res.status(401).json({ error: 'Usuário ou senha incorretos.' });

        const token = jwt.sign(
            { id: u.id, username: u.username, role: u.role },
            JWT_SECRET,
            { expiresIn: '12h' }
        );

        res.json({
            id: u.id, name: u.name, username: u.username,
            role: u.role, must_change_password: u.must_change_password ? 1 : 0, token
        });
    } catch (err) { next(err); }
});

// GET /api/users
router.get('/', authenticateJWT, async (req, res, next) => {
    try {
        const db = getDb();
        const [rows] = await db.query('SELECT id, name, username, role, created_at FROM pdv_users ORDER BY id');
        res.json(rows);
    } catch (err) { next(err); }
});

// POST /api/users
router.post('/', authenticateJWT, async (req, res, next) => {
    const { name, username, password, role } = req.body;
    if (!name || !username || !password)
        return res.status(400).json({ error: 'Nome, usuário e senha são obrigatórios.' });
    try {
        const db = getDb();
        const hash = await hashPwd(password);
        await db.run(
            'INSERT INTO pdv_users (name, username, password_hash, role, must_change_password) VALUES (?, ?, ?, ?, ?)',
            [name, username, hash, role || 'operator', 1]
        );
        res.json({ success: true });
    } catch (err) {
        const isDup = err.message?.includes('UNIQUE') || err.message?.includes('Duplicate');
        if (isDup) return res.status(400).json({ error: 'Este usuário já existe.' });
        next(err);
    }
});

// DELETE /api/users/:id
router.delete('/:id', authenticateJWT, async (req, res, next) => {
    try {
        const db = getDb();
        await db.run('DELETE FROM pdv_users WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (err) { next(err); }
});

// PUT /api/users/:id/password
router.put('/:id/password', authenticateJWT, async (req, res, next) => {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Nova senha obrigatória.' });
    try {
        const db = getDb();
        const hash = await hashPwd(password);
        await db.run('UPDATE pdv_users SET password_hash = ? WHERE id = ?', [hash, req.params.id]);
        res.json({ success: true });
    } catch (err) { next(err); }
});

// PUT /api/users/:id/first-password
router.put('/:id/first-password', authenticateJWT, async (req, res, next) => {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Nova senha obrigatória.' });
    try {
        const db = getDb();
        const hash = await hashPwd(password);
        await db.run(
            'UPDATE pdv_users SET password_hash = ?, must_change_password = 0 WHERE id = ?',
            [hash, req.params.id]
        );
        res.json({ success: true });
    } catch (err) { next(err); }
});

module.exports = router;
