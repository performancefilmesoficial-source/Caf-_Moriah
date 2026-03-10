'use strict';
require('dotenv').config();

const { setupDatabase } = require('./config/database');
const app = require('./app');

const PORT = process.env.PORT || 3000;

// Inicializa banco antes de aceitar conexões
setupDatabase()
    .then(() => {
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`\n🚀 Moriah PDV rodando na porta ${PORT}`);
            console.log(`   Ambiente: ${process.env.NODE_ENV || 'development'}`);
            console.log(`   Banco:    ${process.env.DATABASE_URL ? 'MySQL' : 'SQLite'}\n`);
        });
    })
    .catch((err) => {
        console.error('[FATAL] Falha ao inicializar o banco de dados:', err);
        process.exit(1);
    });
