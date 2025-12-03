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

    // 0) Solo nos interesan messages.upsert
    if (raw.event && raw.event !== "messages.upsert") {
      console.log("ℹ️ [CRM v2] Evento no es messages.upsert, ignorado.");
      return res.status(200).json({ ok: true, ignored: true });
    }

    // 1) TELEFONO (solo chats 1 a 1)
    let remoteJid = null;

    if (data.key && data.key.remoteJid) {
      remoteJid = data.key.remoteJid;
    } else if (data.participant) {
      remoteJid = data.participant;
    } else if (raw.sender) {
      remoteJid = raw.sender;
    }

    // Si no es chat normal de WhatsApp, lo ignoramos
    if (!remoteJid || !remoteJid.endsWith("@s.whatsapp.net")) {
      console.log(
        "ℹ️ [CRM v2] JID no es chat 1 a 1 (@s.whatsapp.net). Ignorado:",
        remoteJid
      );
      return res.status(200).json({ ok: true, ignored: true });
    }

    let telefono = remoteJid.replace(/@.*/, ""); // "1829..." o "829..."
    if (telefono && telefono.length === 11 && telefono.startsWith("1")) {
      // 1829XXXXXXX -> 829XXXXXXX
      telefono = telefono.substring(1);
    }

    if (!telefono) {
      console.log("ℹ️ [CRM v2] No se pudo determinar teléfono. Ignorado.");
      return res.status(200).json({ ok: true, ignored: true });
    }

    // 2) MENSAJE (texto, caption, audio, reacción...)
    const msg = data.message || {};
    let mensaje = null;

    if (msg.conversation) {
      mensaje = msg.conversation;
    } else if (msg.extendedTextMessage && msg.extendedTextMessage.text) {
      mensaje = msg.extendedTextMessage.text;
    } else if (msg.imageMessage && msg.imageMessage.caption) {
      mensaje = `[Imagen] ${msg.imageMessage.caption}`;
    } else if (msg.videoMessage && msg.videoMessage.caption) {
      mensaje = `[Video] ${msg.videoMessage.caption}`;
    } else if (msg.documentMessage && msg.documentMessage.caption) {
      mensaje = `[Documento] ${msg.documentMessage.caption}`;
    } else if (msg.audioMessage) {
      mensaje = "[Audio de WhatsApp]";
    } else if (msg.reactionMessage && msg.reactionMessage.text) {
      mensaje = `[Reacción] ${msg.reactionMessage.text}`;
    }

    const mensajeFinal = mensaje || "[Mensaje sin texto]";

    console.log("👉 [CRM v2] remoteJid:", remoteJid);
    console.log("👉 [CRM v2] TELEFONO:", telefono);
    console.log("👉 [CRM v2] MENSAJE:", mensajeFinal);

    // 3) waMessageId / nombre
    const waMessageId = data.id || (data.key && data.key.id) || null;
    const pushName = data.pushName || "Cliente WhatsApp";

    // 4) GUARDAR EN BD
    const client = await pool.connect();
    let conversacionId;
    let clienteId;

    try {
      await client.query("BEGIN");

      // 4.1 Buscar o crear cliente
      const clienteRes = await client.query(
        "SELECT id, nombre FROM clientes WHERE telefono = $1 LIMIT 1",
        [telefono]
      );

      let nombreCliente;

      if (clienteRes.rows.length === 0) {
        const insertCli = await client.query(
          `INSERT INTO clientes 
           (nombre, telefono, email, direccion, tipo, categoria, estado, fecha_creado, usuario_id, synced)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NULL, false)
           RETURNING id, nombre`,
          [pushName, telefono, null, null, "CRM", "WHATSAPP", "NUEVO"]
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
      const insertMsg = await client.query(
        `INSERT INTO crm_mensajes
         (conversacion_id, telefono, cuerpo, tipo, origen, wa_message_id, archivo_url)
         VALUES ($1, $2, $3, 'IN', 'whatsapp', $4, $5)
         RETURNING id, fecha`,
        [conversacionId, telefono, mensajeFinal, waMessageId, null]
      );

      await client.query("COMMIT");

      console.log("✅ [CRM v2] Mensaje IN guardado en CRM");

      // 4.4 EMITIR EVENTO EN TIEMPO REAL
      const io = req.app.get("io");
      if (io) {
        io.emit("crm:nuevo_mensaje_in", {
          tipo: "IN",
          telefono,
          clienteId,
          conversacionId,
          cuerpo: mensajeFinal,
          fecha: insertMsg.rows[0].fecha,
          origen: "whatsapp",
          pushName,
        });
      }

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
// 2. LISTAR CONVERSACIONES
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
  try {
    let { cliente_id, conversacion_id, telefono, mensaje, origen } = req.body;

    if (!mensaje || (!telefono && !cliente_id)) {
      return res
        .status(400)
        .json({ ok: false, error: "Datos incompletos" });
    }

    const client = await pool.connect();
    let conversacionId;

    try {
      await client.query("BEGIN");

      // 1) Asegurar cliente_id y teléfono
      if (!cliente_id && telefono) {
        const cliRes = await client.query(
          "SELECT id FROM clientes WHERE telefono = $1 LIMIT 1",
          [telefono]
        );
        if (cliRes.rows.length > 0) {
          cliente_id = cliRes.rows[0].id;
        }
      }

      if (!telefono && cliente_id) {
        const cliRes = await client.query(
          "SELECT telefono FROM clientes WHERE id = $1 LIMIT 1",
          [cliente_id]
        );
        if (cliRes.rows.length > 0) {
          telefono = cliRes.rows[0].telefono;
        }
      }

      if (!cliente_id) {
        const insertCli = await client.query(
          `INSERT INTO clientes 
           (nombre, telefono, email, direccion, tipo, categoria, estado, fecha_creado, usuario_id, synced)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NULL, false)
           RETURNING id`,
          ["Cliente CRM", telefono, null, null, "CRM", "WHATSAPP", "NUEVO"]
        );
        cliente_id = insertCli.rows[0].id;
      }

      // 2) Buscar o crear conversación
      conversacionId = conversacion_id;

      if (!conversacionId) {
        const convRes = await client.query(
          `SELECT id 
           FROM crm_conversaciones 
           WHERE cliente_id = $1 AND telefono = $2
           LIMIT 1`,
          [cliente_id, telefono]
        );

        if (convRes.rows.length === 0) {
          const convInsert = await client.query(
            `INSERT INTO crm_conversaciones
             (cliente_id, telefono, nombre, estado, ultimo_mensaje, ultimo_mensaje_tipo, ultimo_mensaje_fecha, creado_en, actualizado_en)
             VALUES (
               $1,
               $2,
               (SELECT nombre FROM clientes WHERE id = $1),
               'EN_PROCESO',
               $3,
               'OUT',
               NOW(),
               NOW(),
               NOW()
             )
             RETURNING id`,
            [cliente_id, telefono, mensaje]
          );
          conversacionId = convInsert.rows[0].id;
        } else {
          conversacionId = convRes.rows[0].id;
        }
      }

      // 3) Insertar mensaje OUT
      const insertMsg = await client.query(
        `INSERT INTO crm_mensajes
         (conversacion_id, telefono, cuerpo, tipo, origen)
         VALUES ($1, $2, $3, 'OUT', $4)
         RETURNING id, conversacion_id, telefono, cuerpo, tipo, origen, fecha`,
        [conversacionId, telefono, mensaje, origen || "crm_app"]
      );

      // 4) Actualizar conversación
      await client.query(
        `UPDATE crm_conversaciones
         SET ultimo_mensaje = $1,
             ultimo_mensaje_tipo = 'OUT',
             ultimo_mensaje_fecha = NOW(),
             actualizado_en = NOW()
         WHERE id = $2`,
        [mensaje, conversacionId]
      );

      await client.query("COMMIT");

      // 5) EMITIR EVENTO EN TIEMPO REAL (OUT)
      const io = req.app.get("io");
      if (io) {
        io.emit("crm:nuevo_mensaje_out", {
          tipo: "OUT",
          telefono,
          clienteId: cliente_id,
          conversacionId,
          cuerpo: mensaje,
          fecha: insertMsg.rows[0].fecha,
          origen: origen || "crm_app",
        });
      }

      return res.json({
        ok: true,
        mensaje: insertMsg.rows[0],
        conversacion_id: conversacionId,
        cliente_id,
        telefono,
      });
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
// 5. LISTAR CLIENTES PARA EL CRM
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
// 6. LISTAR MENSAJES POR CLIENTE
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
