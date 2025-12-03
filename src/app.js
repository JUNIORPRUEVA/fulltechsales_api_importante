// =======================================
// FULLPOS API - CONFIGURACIÓN PRINCIPAL
// =======================================
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();

// =======================================
// MIDDLEWARES
// =======================================
app.use(cors());
app.use(express.json());

// =======================================
// BASE DE DATOS
// =======================================
const { query } = require('./db');

// =======================================
// RUTAS - MÓDULOS
// =======================================

// AUTH
const authRoutes = require('./modules/auth/auth.routes');

// USUARIOS
const usuariosRoutes = require('./modules/usuarios/usuarios.routes');

// CRM (Conversaciones + Chat)
const crmRoutes = require('./modules/crm/crm.routes');   // 👈 NUEVO

// =======================================
// REGISTRO DE RUTAS
// =======================================
app.use('/auth', authRoutes);
app.use('/usuarios', usuariosRoutes);
app.use('/crm', crmRoutes);                              // 👈 NUEVO

// =======================================
// RUTA DE TESTEO BD
// =======================================
app.get('/test-db', async (req, res) => {
  try {
    const result = await query('SELECT NOW()');
    res.json({
      ok: true,
      time: result.rows[0].now,
    });
  } catch (error) {
    console.error("DB ERROR:", error);
    res.status(500).json({ ok: false, msg: error.message });
  }
});

// =======================================
// RUTA RAÍZ
// =======================================
app.get('/', (req, res) => {
  res.send('FULLPOS API funcionando 🔥');
});

// =======================================
// EXPORTAR APP
// =======================================
module.exports = app;
