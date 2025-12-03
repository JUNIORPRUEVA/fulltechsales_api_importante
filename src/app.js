// =======================================
// FULLPOS API - CONFIGURACIÓN PRINCIPAL
// =======================================
const express = require("express");
const cors = require("cors");
require("dotenv").config();
const http = require("http");
const { Server } = require("socket.io");

const app = express();

// =======================================
// MIDDLEWARES
// =======================================
app.use(cors());
app.use(express.json());

// =======================================
// BASE DE DATOS
// =======================================
const { query } = require("./db");

// =======================================
// RUTAS - MÓDULOS
// =======================================

// AUTH
const authRoutes = require("./modules/auth/auth.routes");

// USUARIOS
const usuariosRoutes = require("./modules/usuarios/usuarios.routes");

// CRM (Conversaciones + Chat)
const crmRoutes = require("./modules/crm/crm.routes"); // 👈 CRM

// =======================================
// REGISTRO DE RUTAS
// =======================================
app.use("/auth", authRoutes);
app.use("/usuarios", usuariosRoutes);
app.use("/crm", crmRoutes);

// =======================================
// RUTA DE TESTEO BD
// =======================================
app.get("/test-db", async (req, res) => {
  try {
    const result = await query("SELECT NOW()");
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
app.get("/", (req, res) => {
  res.send("FULLPOS API funcionando 🔥");
});

// =======================================
// SOCKET.IO
// =======================================

// Creamos el servidor HTTP a partir de app
const server = http.createServer(app);

// Configuramos Socket.IO
const io = new Server(server, {
  cors: {
    origin: "*", // si quieres, luego pones la URL de tu app
    methods: ["GET", "POST"],
  },
});

// Guardamos io dentro de app para usarlo en controllers
app.set("io", io);

// Solo para ver conexiones
io.on("connection", (socket) => {
  console.log("🧲 Cliente Socket.IO conectado:", socket.id);

  socket.on("disconnect", () => {
    console.log("🔌 Cliente Socket.IO desconectado:", socket.id);
  });
});

// =======================================
// EXPORTAR APP + SERVER (para index.js)
// =======================================
module.exports = { app, server, io };
