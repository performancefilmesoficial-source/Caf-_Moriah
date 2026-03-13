'use strict';
const express = require('express');
const multer = require('multer');
const { getDb } = require('../config/database');
const { authenticateJWT } = require('../middleware/auth');

const router = express.Router();

// memoryStorage → Base64 no banco (persiste entre deploys no Docker)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 50 * 1024 * 1024,   // 50MB por arquivo
        fieldSize: 50 * 1024 * 1024   // 50MB por campo texto (Base64 round-trip)
    }
});

function toBase64(file) {
    return `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
}

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
        hero_font_family, hero_title_size, hero_text_color,
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
            hero_video = toBase64(req.files['hero_video_file'][0]);
        }
        if (req.files['about_image_file']?.[0]) {
            about_image = toBase64(req.files['about_image_file'][0]);
        }
        if (req.files['logo_file']?.[0]) {
            logo_url = toBase64(req.files['logo_file'][0]);
        }
        if (req.files['favicon_file']?.[0]) {
            favicon_url = toBase64(req.files['favicon_file'][0]);
        }
        if (req.files['hero_banners_files']) {
            const newBanners = req.files['hero_banners_files'].map(f => toBase64(f));
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
                hero_font_family=?, hero_title_size=?, hero_text_color=?,
                about_title=?, about_text_1=?, about_text_2=?, about_image=?, about_image_align=?,
                hero_banners=?, updated_at=CURRENT_TIMESTAMP
             WHERE id=?`,
            [hero_title, hero_text, hero_video, hero_video_opacity, hero_text_align,
             hero_font_family || 'sans', hero_title_size || '5', hero_text_color || '#ffffff',
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
