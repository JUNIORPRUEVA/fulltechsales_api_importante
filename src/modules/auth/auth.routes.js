// src/modules/crm/crm.routes.js
const express = require("express");
const router = express.Router();
const controller = require("./crm.controller");

// =======================================
//  WEBHOOK DESDE EVOLUTION / WHATSAPP
// =======================================
router.post("/webhook", controller.registrarMensajeEntrante);

// =======================================
//  CONVERSACIONES (si luego las usas en la app)
// =======================================
router.get("/conversaciones", controller.obtenerConversaciones);
router.get("/conversaciones/:id/mensajes", controller.obtenerMensajes);

// =======================================
//  CLIENTES PARA EL CRM (lo que usa Flutter)
// =======================================
router.get("/clientes", controller.obtenerClientesCRM);

router.get(
  "/clientes/:clienteId/mensajes",
  controller.obtenerMensajesPorClienteId
);

// 👉 donde pega Flutter al enviar mensaje desde el chat
router.post(
  "/clientes/:clienteId/mensajes",
  controller.enviarMensaje
);

// También puedes seguir usando la ruta genérica si quieres:
router.post("/mensajes/enviar", controller.enviarMensaje);

module.exports = router;
