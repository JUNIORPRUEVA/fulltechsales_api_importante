const express = require("express");
const router = express.Router();
const controller = require("./crm.controller");

// WEBHOOK (WhatsApp)
router.post("/webhook", controller.registrarMensajeEntrante);

// LISTAR CONVERSACIONES
router.get("/conversaciones", controller.obtenerConversaciones);

// OBTENER MENSAJES POR CONVERSACIÓN
router.get("/conversaciones/:id/mensajes", controller.obtenerMensajes);

// LISTAR CLIENTES PARA EL CRM (Flutter)
router.get("/clientes", controller.obtenerClientesCRM);

// OBTENER MENSAJES POR CLIENTE (cliente_id)
router.get("/clientes/:clienteId/mensajes", controller.obtenerMensajesPorClienteId);

// REGISTRAR MENSAJE SALIENTE (opcional, backend)
router.post("/mensajes/enviar", controller.enviarMensaje);

module.exports = router;
