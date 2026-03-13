const { setupDatabase } = require('./backend/config/database');
require('dotenv').config();

async function migrate() {
    try {
        console.log('[MIGRATE] Inicializando banco de dados...');
        const db = await setupDatabase();
        
        const columns = [
            ['site_title', 'TEXT'],
            ['logo_url', 'TEXT'],
            ['favicon_url', 'TEXT'],
            ['whatsapp_number', 'TEXT'],
            ['instagram_url', 'TEXT'],
            ['contact_email', 'TEXT'],
            ['cnpj', 'TEXT'],
            ['address', 'TEXT'],
            ['footer_text', 'TEXT']
        ];

        console.log('[MIGRATE] Iniciando migração da tabela site_settings...');

        for (const [col, type] of columns) {
            try {
                await db.run(`ALTER TABLE site_settings ADD COLUMN ${col} ${type}`);
                console.log(`[OK] Coluna ${col} adicionada.`);
            } catch (err) {
                if (err.message.includes('duplicate column') || err.code === 'ER_DUP_FIELDNAME' || err.message.includes('already exists')) {
                    console.log(`[INFO] Coluna ${col} já existe.`);
                } else {
                    console.error(`[ERRO] Coluna ${col}:`, err.message);
                }
            }
        }

        console.log('[MIGRATE] Migração concluída com sucesso!');
        process.exit(0);
    } catch (err) {
        console.error('[FATAL] Erro na migração:', err);
        process.exit(1);
    }
}

migrate();
