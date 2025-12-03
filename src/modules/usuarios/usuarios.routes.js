// src/modules/usuarios/usuarios.routes.js
const router = require("express").Router();
const controller = require("./usuarios.controller");

router.get("/", controller.listarUsuarios);
router.post("/", controller.crearUsuario);
router.put("/:id", controller.actualizarUsuario);

module.exports = router;
