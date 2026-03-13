'use strict';
const express = require('express');
const multer = require('multer');
const { getDb } = require('../config/database');
const { authenticateJWT } = require('../middleware/auth');
const fs = require('fs');
const path = require('path');

const router = express.Router();

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(__dirname, '../../uploads/site');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + ext);
    }
});

const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

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
    { name: 'about_image_file', maxCount: 1 },
    { name: 'hero_banners_files', maxCount: 10 },
    { name: 'logo_file', maxCount: 1 },
    { name: 'favicon_file', maxCount: 1 }
]), async (req, res, next) => {
    const {
        hero_title, hero_text, hero_video_opacity, hero_text_align,
        about_title, about_text_1, about_text_2, about_image_align,
        site_title, whatsapp_number, instagram_url, contact_email,
        cnpj, address, footer_text
    } = req.body;
    let { hero_video, about_image, hero_banners, logo_url, favicon_url } = req.body;

    // Converte hero_banners de string para array se necessário
    let bannersArray = [];
    try {
        bannersArray = JSON.parse(hero_banners || '[]');
    } catch (e) {
        bannersArray = [];
    }

    if (req.files) {
        if (req.files['hero_video_file']?.[0]) {
            hero_video = `/uploads/site/${req.files['hero_video_file'][0].filename}`;
        }
        if (req.files['about_image_file']?.[0]) {
            about_image = `/uploads/site/${req.files['about_image_file'][0].filename}`;
        }
        if (req.files['logo_file']?.[0]) {
            logo_url = `/uploads/site/${req.files['logo_file'][0].filename}`;
        }
        if (req.files['favicon_file']?.[0]) {
            favicon_url = `/uploads/site/${req.files['favicon_file'][0].filename}`;
        }
        if (req.files['hero_banners_files']) {
            const newBanners = req.files['hero_banners_files'].map(f => `/uploads/site/${f.filename}`);
            bannersArray = [...bannersArray, ...newBanners];
        }
    }

    const finalBannersJson = JSON.stringify(bannersArray);

    try {
        const db = getDb();
        const [rows] = await db.query('SELECT id FROM site_settings LIMIT 1');

        // Garante que existe uma linha
        if (!rows.length) {
            await db.query("INSERT INTO site_settings (hero_title) VALUES ('')");
        }
        const [freshRows] = await db.query('SELECT id FROM site_settings LIMIT 1');
        const settingsId = freshRows[0].id;

        // Colunas base — existem em TODOS os bancos (antigos e novos)
        await db.query(
            `UPDATE site_settings SET
                hero_title=?, hero_text=?, hero_video=?, hero_video_opacity=?, hero_text_align=?,
                about_title=?, about_text_1=?, about_text_2=?, about_image=?, about_image_align=?,
                hero_banners=?, updated_at=CURRENT_TIMESTAMP
             WHERE id=?`,
            [hero_title, hero_text, hero_video, hero_video_opacity, hero_text_align,
             about_title, about_text_1, about_text_2, about_image, about_image_align,
             finalBannersJson, settingsId]
        );

        // Colunas estendidas — adicionadas via migration, podem não existir em MySQL antigo
        try {
            await db.query(
                `UPDATE site_settings SET
                    site_title=?, logo_url=?, favicon_url=?,
                    whatsapp_number=?, instagram_url=?, contact_email=?,
                    cnpj=?, address=?, footer_text=?
                 WHERE id=?`,
                [site_title, logo_url, favicon_url,
                 whatsapp_number, instagram_url, contact_email,
                 cnpj, address, footer_text, settingsId]
            );
        } catch (extErr) {
            console.warn('[SETTINGS] Colunas estendidas indisponíveis:', extErr.message);
        }

        res.json({
            message: 'Configurações atualizadas com sucesso!',
            hero_video,
            about_image,
            logo_url,
            favicon_url,
            hero_banners: bannersArray
        });
    } catch (err) { next(err); }
});

module.exports = router;
