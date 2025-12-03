// src/modules/crm/crm.controller.js
const { pool } = require("../../db");

// =====================================================
// 1. WEBHOOK: mensaje entrante desde Evolution / WhatsApp
// =====================================================
exports.registrarMensajeEntrante = async (req, res) => {
  try {
    console.log("🆕 [CRM v2] WEBHOOK RECIBIDO:");
    console.log(JSON.stringify(req.body, null, 2));

    const raw = req.body || {};
    const data = raw.data || {};

    const messageType = data.messageType;
    const message = data.message || {};

    // ==========================
    // 0) DESCARTAR EVENTOS QUE NO NOS INTERESAN
    //    - reacciones
    //    - mensajes de sistema / protocolos
    //    - eventos sin "message" útil
    // ==========================
    const tiposIgnorados = [
      "reactionMessage",
      "protocolMessage",
      "senderKeyDistributionMessage",
      "messageStatus",
    ];

    if (!message || tiposIgnorados.includes(messageType)) {
      console.log("ℹ️ [CRM v2] Evento sin contenido útil (reacción/sistema). Ignorado.");
      return res.status(200).json({ ok: true, ignored: true });
    }

    // ==========================
    // 1) TELEFONO (remoteJid / sender)
    // ==========================
    let remoteJid = null;

    if (data.key && data.key.remoteJid) {
      remoteJid = data.key.remoteJid;
    } else if (raw.sender) {
      remoteJid = raw.sender; // fallback
    }

    // Ignorar grupos y status broadcast
    if (
      remoteJid &&
      (remoteJid.endsWith("@g.us") || remoteJid === "status@broadcast")
    ) {
      console.log("ℹ️ [CRM v2] Mensaje de grupo/broadcast. Ignorado.");
      return res.status(200).json({ ok: true, ignored: true });
    }

    let telefono = null;
    if (remoteJid) {
      // "18295319442@s.whatsapp.net" -> "18295319442"
      // "8294770756@c.us"          -> "8294770756"
      telefono = remoteJid.replace(/@.*/, "");
      // quitamos todo lo que no sea número por si acaso
      telefono = telefono.replace(/[^0-9]/g, "");
    }

    // Si viene 1829XXXXXXX quitamos el 1 inicial
    if (telefono && telefono.length === 11 && telefono.startsWith("1")) {
      telefono = telefono.substring(1); // 829XXXXXXX
    }

    if (!telefono) {
      console.log("ℹ️ [CRM v2] Evento sin teléfono válido. Ignorado.");
      return res.status(200).json({ ok: true, ignored: true });
    }

    // ==========================
    // 2) MENSAJE (texto, extendido, media, audio)
    // ==========================
    let mensaje = null;

    if (message.conversation) {
      // Texto normal
      mensaje = message.conversation;
    } else if (message.extendedTextMessage?.text) {
      // Texto extendido (quotes, respuestas, etc.)
      mensaje = message.extendedTextMessage.text;
    } else if (message.imageMessage?.caption) {
      mensaje = message.imageMessage.caption || "[Imagen]";
    } else if (message.videoMessage?.caption) {
      mensaje = message.videoMessage.caption || "[Video]";
    } else if (message.documentMessage?.caption) {
      mensaje = message.documentMessage.caption || "[Documento]";
    } else if (message.audioMessage) {
      mensaje = "[Audio de WhatsApp]";
    }

    if (!mensaje || typeof mensaje !== "string" || mensaje.trim() === "") {
      console.log("ℹ️ [CRM v2] Mensaje sin texto interpretable. Ignorado.");
      return res.status(200).json({ ok: true, ignored: true });
    }

    const mensajeFinal = mensaje.trim();

    console.log("👉 [CRM v2] remoteJid:", remoteJid);
    console.log("👉 [CRM v2] TELEFONO:", telefono);
    console.log("👉 [CRM v2] MENSAJE:", mensajeFinal);

    // ==========================
    // 3) waMessageId / nombre
    // ==========================
    const waMessageId =
      data.id ||
      (data.key && data.key.id) ||
      null;

    const pushName = data.pushName || "Cliente WhatsApp";

    // =====================================================
    // 4) GUARDAR EN BD
    // =====================================================
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // 4.1 Buscar o crear cliente
      const clienteRes = await client.query(
        "SELECT id, nombre FROM clientes WHERE telefono = $1 LIMIT 1",
        [telefono]
      );

      let clienteId;
      let nombreCliente;

      if (clienteRes.rows.length === 0) {
        const insertCli = await client.query(
          `INSERT INTO clientes 
           (nombre, telefono, email, direccion, tipo, categoria, estado, fecha_creado, usuario_id, synced)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NULL, false)
           RETURNING id, nombre`,
          [
            pushName,
            telefono,
            null,
            null,
            "CRM",
            "WHATSAPP",
            "NUEVO",
          ]
        );

        clienteId = insertCli.rows[0].id;
        nombreCliente = insertCli.rows[0].nombre;
      } else {
        clienteId = clienteRes.rows[0].id;
        nombreCliente = clienteRes.rows[0].nombre;
      }

      // 4.2 Buscar o crear conversación
      const convRes = await client.query(
        "SELECT id FROM crm_conversaciones WHERE telefono = $1 LIMIT 1",
        [telefono]
      );

      let conversacionId;

      if (convRes.rows.length === 0) {
        const insertConv = await client.query(
          `INSERT INTO crm_conversaciones
           (cliente_id, telefono, nombre, estado, ultimo_mensaje, ultimo_mensaje_tipo, ultimo_mensaje_fecha, creado_en, actualizado_en)
           VALUES ($1, $2, $3, 'NUEVO', $4, 'IN', NOW(), NOW(), NOW())
           RETURNING id`,
          [clienteId, telefono, nombreCliente, mensajeFinal]
        );
        conversacionId = insertConv.rows[0].id;
      } else {
        conversacionId = convRes.rows[0].id;

        await client.query(
          `UPDATE crm_conversaciones
           SET ultimo_mensaje = $1,
               ultimo_mensaje_tipo = 'IN',
               ultimo_mensaje_fecha = NOW(),
               actualizado_en = NOW()
           WHERE id = $2`,
          [mensajeFinal, conversacionId]
        );
      }

      // 4.3 Insertar mensaje
      await client.query(
        `INSERT INTO crm_mensajes
         (conversacion_id, telefono, cuerpo, tipo, origen, wa_message_id, archivo_url, fecha)
         VALUES ($1, $2, $3, 'IN', 'whatsapp', $4, $5, NOW())`,
        [conversacionId, telefono, mensajeFinal, waMessageId, null]
      );

      await client.query("COMMIT");

      console.log("✅ [CRM v2] Mensaje IN guardado en CRM");
      return res.json({ ok: true });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("🔥 [CRM v2] Error en registrarMensajeEntrante:", err);
      return res.status(500).json({ ok: false, error: "Error interno" });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("🔥 [CRM v2] Error general en webhook CRM:", err);
    return res.status(500).json({ ok: false, error: "Error general" });
  }
};

// =====================================================
// 2. LISTAR CONVERSACIONES (para la lista del CRM)
// =====================================================
exports.obtenerConversaciones = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
         c.id,
         c.cliente_id,
         c.telefono,
         c.nombre,
         c.etiqueta,
         c.estado,
         c.ultimo_mensaje,
         c.ultimo_mensaje_tipo,
         c.ultimo_mensaje_fecha
       FROM crm_conversaciones c
       ORDER BY c.ultimo_mensaje_fecha DESC NULLS LAST, c.creado_en DESC`
    );

    return res.json(result.rows);
  } catch (err) {
    console.error("🔥 Error listar conversaciones:", err);
    return res.status(500).json({ ok: false, error: "Error interno" });
  }
};

// =====================================================
// 3. LISTAR MENSAJES DE UNA CONVERSACIÓN
// =====================================================
exports.obtenerMensajes = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT 
         id,
         conversacion_id,
         telefono,
         cuerpo,
         tipo,
         origen,
         wa_message_id,
         archivo_url,
         fecha
       FROM crm_mensajes
       WHERE conversacion_id = $1
       ORDER BY fecha ASC`,
      [id]
    );

    return res.json(result.rows);
  } catch (err) {
    console.error("🔥 Error listar mensajes:", err);
    return res.status(500).json({ ok: false, error: "Error interno" });
  }
};

// =====================================================
// 4. REGISTRAR MENSAJE SALIENTE DESDE LA APP CRM
// =====================================================
exports.enviarMensaje = async (req, res) => {
  const { conversacion_id, telefono, mensaje, origen } = req.body;

  if (!conversacion_id || !telefono || !mensaje) {
    return res.status(400).json({ ok: false, error: "Datos incompletos" });
  }

  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const insertMsg = await client.query(
        `INSERT INTO crm_mensajes
         (conversacion_id, telefono, cuerpo, tipo, origen, fecha)
         VALUES ($1, $2, $3, 'OUT', $4, NOW())
         RETURNING *`,
        [conversacion_id, telefono, mensaje, origen || "crm_app"]
      );

      await client.query(
        `UPDATE crm_conversaciones
         SET ultimo_mensaje = $1,
             ultimo_mensaje_tipo = 'OUT',
             ultimo_mensaje_fecha = NOW(),
             actualizado_en = NOW()
         WHERE id = $2`,
        [mensaje, conversacion_id]
      );

      await client.query("COMMIT");

      return res.json({ ok: true, mensaje: insertMsg.rows[0] });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("🔥 Error enviarMensaje:", err);
      return res.status(500).json({ ok: false, error: "Error interno" });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("🔥 Error general enviarMensaje:", err);
    return res.status(500).json({ ok: false, error: "Error general" });
  }
};

// =====================================================
// 5. LISTAR CLIENTES PARA EL CRM (formato que espera Flutter)
// =====================================================
exports.obtenerClientesCRM = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
         id,
         nombre,
         telefono,
         COALESCE(email, '')      AS email,
         COALESCE(direccion, '')  AS direccion,
         COALESCE(tipo, 'CRM')    AS tipo,
         COALESCE(categoria, 'WHATSAPP') AS categoria,
         COALESCE(estado, 'NUEVO')      AS estado,
         fecha_creado
       FROM clientes
       ORDER BY fecha_creado DESC`
    );

    return res.json(result.rows);
  } catch (err) {
    console.error("🔥 Error listar clientes CRM:", err);
    return res.status(500).json({ ok: false, error: "Error interno" });
  }
};

// =====================================================
// 6. LISTAR MENSAJES POR CLIENTE (cliente_id)
// =====================================================
exports.obtenerMensajesPorClienteId = async (req, res) => {
  const { clienteId } = req.params;

  try {
    const result = await pool.query(
      `SELECT 
         m.id,
         c.cliente_id,
         m.telefono,
         m.cuerpo,
         m.tipo,
         m.origen,
         m.fecha
       FROM crm_mensajes m
       JOIN crm_conversaciones c ON m.conversacion_id = c.id
       WHERE c.cliente_id = $1
       ORDER BY m.fecha ASC`,
      [clienteId]
    );

    return res.json(result.rows);
  } catch (err) {
    console.error("🔥 Error listar mensajes por cliente:", err);
    return res.status(500).json({ ok: false, error: "Error interno" });
  }
};
