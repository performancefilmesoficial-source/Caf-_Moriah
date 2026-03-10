'use strict';
const express = require('express');
const multer = require('multer');
const { getDb } = require('../config/database');
const { authenticateJWT } = require('../middleware/auth');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// GET /api/site-settings  (público — e-commerce lê aqui)
router.get('/', async (req, res, next) => {
    try {
        const db = getDb();
        const [rows] = await db.query('SELECT * FROM site_settings LIMIT 1');
        res.json(rows.length ? rows[0] : {});
    } catch (err) { next(err); }
});

// PUT /api/site-settings  (requer JWT)
router.put('/', authenticateJWT, upload.fields([
    { name: 'hero_video_file', maxCount: 1 },
    { name: 'about_image_file', maxCount: 1 }
]), async (req, res, next) => {
    const {
        hero_title, hero_subtitle, hero_text, hero_video_opacity, hero_text_align,
        about_title, about_subtitle, about_text_1, about_text_2, about_image_align
    } = req.body;
    let { hero_video, about_image } = req.body;

    if (req.files) {
        if (req.files['hero_video_file']?.[0]) {
            const f = req.files['hero_video_file'][0];
            hero_video = `data:${f.mimetype || 'video/mp4'};base64,${f.buffer.toString('base64')}`;
        }
        if (req.files['about_image_file']?.[0]) {
            const f = req.files['about_image_file'][0];
            about_image = `data:${f.mimetype || 'image/jpeg'};base64,${f.buffer.toString('base64')}`;
        }
    }

    try {
        const db = getDb();
        const [rows] = await db.query('SELECT id FROM site_settings LIMIT 1');
        const settingsId = rows.length ? rows[0].id : 1;

        await db.run(
            `UPDATE site_settings SET
                hero_title=?, hero_subtitle=?, hero_text=?, hero_video=?, hero_video_opacity=?, hero_text_align=?,
                about_title=?, about_subtitle=?, about_text_1=?, about_text_2=?, about_image=?, about_image_align=?,
                updated_at=CURRENT_TIMESTAMP
             WHERE id=?`,
            [hero_title, hero_subtitle, hero_text, hero_video, hero_video_opacity, hero_text_align,
             about_title, about_subtitle, about_text_1, about_text_2, about_image, about_image_align, settingsId]
        );
        res.json({ message: 'Configurações atualizadas com sucesso!', hero_video, about_image });
    } catch (err) { next(err); }
});

module.exports = router;
