// src/modules/crm/crm.controller.js
const { pool } = require("../../db");

// =====================================================
// 1. WEBHOOK: mensaje entrante desde Evolution / WhatsApp
// =====================================================
exports.registrarMensajeEntrante = async (req, res) => {
  try {
    console.log("🆕 [CRM v2] WEBHOOK RECIBIDO");
    // console.log(JSON.stringify(req.body, null, 2)); // deja esto si quieres debug

    const raw = req.body || {};
    const data = raw.data || {};

    // ==========================
    // 0) EVENTO SIN MENSAJE (solo status, delivery, etc.)
    // ==========================
    if (!data.message) {
      console.log("ℹ️ [CRM v2] Evento sin objeto message (solo status/ACK). Ignorado.");
      return res.status(200).json({ ok: true, ignored: true, reason: "no_message_object" });
    }

    // ==========================
    // 1) TELEFONO
    //    Ejemplo:
    //    data.key.remoteJid = "18295319442@s.whatsapp.net"
    // ==========================
    let remoteJid = data.key?.remoteJid || raw.sender || null;

    let telefono = null;
    if (remoteJid) {
      // corta @s.whatsapp.net
      telefono = remoteJid.replace(/@.*/, "");
      // si viene 1829XXXXXXX le quitamos el 1
      if (telefono.length === 11 && telefono.startsWith("1")) {
        telefono = telefono.substring(1);
      }
    }

    // ==========================
    // 2) MENSAJE
    // ==========================
    const msg = data.message || {};
    let mensaje = null;

    if (msg.conversation) {
      mensaje = msg.conversation;
    } else if (msg.extendedTextMessage?.text) {
      mensaje = msg.extendedTextMessage.text;
    } else if (msg.imageMessage?.caption) {
      mensaje = msg.imageMessage.caption;
    } else if (msg.videoMessage?.caption) {
      mensaje = msg.videoMessage.caption;
    } else if (msg.audioMessage) {
      mensaje = "[Audio de WhatsApp]";
    } else if (msg.documentMessage) {
      mensaje = msg.documentMessage.caption || "[Documento de WhatsApp]";
    }

    console.log("👉 [CRM v2] remoteJid:", remoteJid);
    console.log("👉 [CRM v2] TELEFONO:", telefono);
    console.log("👉 [CRM v2] MENSAJE:", mensaje);

    // Si no hay datos suficientes, lo ignoramos tranquilo (sin warning feo)
    if (!telefono || !mensaje) {
      console.log("ℹ️ [CRM v2] No se pudo extraer teléfono o mensaje. Evento ignorado.");
      return res.status(200).json({
        ok: true,
        ignored: true,
        reason: "missing_phone_or_message",
      });
    }

    // ==========================
    // 3) waMessageId / nombre
    // ==========================
    const waMessageId = data.id || data.key?.id || null;
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
          [clienteId, telefono, nombreCliente, mensaje]
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
          [mensaje, conversacionId]
        );
      }

      // 4.3 Insertar mensaje
      await client.query(
        `INSERT INTO crm_mensajes
         (conversacion_id, telefono, cuerpo, tipo, origen, wa_message_id, archivo_url)
         VALUES ($1, $2, $3, 'IN', 'whatsapp', $4, $5)`,
        [conversacionId, telefono, mensaje, waMessageId, null]
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
         (conversacion_id, telefono, cuerpo, tipo, origen)
         VALUES ($1, $2, $3, 'OUT', $4)
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
