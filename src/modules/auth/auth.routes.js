const express = require("express");
const router = express.Router();
const controller = require("./auth.controller");

// =======================
// AUTH BÁSICO
// =======================
router.post("/register", controller.register);
router.post("/login", controller.login);

// =======================
// CRUD DE USUARIOS
// =======================

// Listar todos
router.get("/usuarios", controller.obtenerUsuarios);

// Detalle por ID
router.get("/usuarios/:id", controller.obtenerUsuarioPorId);

// Actualizar datos
router.put("/usuarios/:id", controller.actualizarUsuario);

// Eliminar usuario
router.delete("/usuarios/:id", controller.eliminarUsuario);

// Bloquear / activar
router.patch("/usuarios/:id/bloqueo", controller.cambiarEstadoActivo);

module.exports = router;
