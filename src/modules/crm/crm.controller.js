// src/modules/crm/crm.controller.js
const { pool } = require("../../db");

// =====================================================
// 1. WEBHOOK: mensaje entrante desde Evolution / WhatsApp
// =====================================================
exports.registrarMensajeEntrante = async (req, res) => {
  try {
    console.log(
      "📩 WEBHOOK RECIBIDO CRM RAW:",
      JSON.stringify(req.body, null, 2)
    );

    // Evolution puede mandar:
    // { event, instanceId, data: {...}, sender, ... }
    // o bien: { result: { event, instanceId, data: {...} }, sender, ... }
    const raw = req.body;
    const wrapper = raw.result || raw; // 👈 soporta ambos formatos
    const data = wrapper.data || wrapper;

    // -------------------------------
    // 1) Normalizar teléfono
    // -------------------------------
    let remoteJid =
      data.remoteJid ||
      data.remoteJID ||
      data.from ||
      (data.key && data.key.remoteJid) ||
      wrapper.sender || // en tus logs viene aquí
      raw.sender ||
      null;

    let telefono = data.phone || data.telefono || null;

    if (!telefono && remoteJid) {
      telefono = remoteJid.replace(/@.*/, ""); // quita @s.whatsapp.net
    }

    // muchos Evolution mandan un array messages
    if (!telefono && Array.isArray(data.messages) && data.messages.length > 0) {
      const m = data.messages[0];
      if (m.key?.remoteJid) {
        remoteJid = m.key.remoteJid;
        telefono = remoteJid.replace(/@.*/, "");
      }
    }

    // si viene con 11 dígitos tipo 1XXXXXXXXXX, quitamos el 1 inicial
    if (telefono && telefono.length === 11 && telefono.startsWith("1")) {
      telefono = telefono.substring(1);
    }

    // -------------------------------
    // 2) Normalizar mensaje y archivo
    // -------------------------------
    let mensaje =
      data.text ||
      data.body ||
      (data.data && data.data.text) ||
      null;

    let archivoUrl = null;

    // Objeto de mensaje principal (según formato Evolution/Baileys)
    let msgPrimary = null;

    if (data.message) {
      msgPrimary = data.message;
    } else if (
      Array.isArray(data.messages) &&
      data.messages.length > 0 &&
      data.messages[0].message
    ) {
      msgPrimary = data.messages[0].message;
      // por si también viene remoteJid ahí
      if (!remoteJid && data.messages[0].key?.remoteJid) {
        remoteJid = data.messages[0].key.remoteJid;
        telefono = remoteJid.replace(/@.*/, "");
        if (telefono.length === 11 && telefono.startsWith("1")) {
          telefono = telefono.substring(1);
        }
      }
    }

    // Texto puro: conversation / extendedTextMessage
    if (!mensaje && msgPrimary?.conversation) {
      mensaje = msgPrimary.conversation;
    }
    if (!mensaje && msgPrimary?.extendedTextMessage?.text) {
      mensaje = msgPrimary.extendedTextMessage.text;
    }

    // 🖼️ Imagen
    if (msgPrimary?.imageMessage) {
      archivoUrl = msgPrimary.imageMessage.url || null;
      const caption = msgPrimary.imageMessage.caption;
      if (!mensaje) {
        mensaje = caption || "[Imagen de WhatsApp]";
      }
    }

    // 🎧 Audio
    if (msgPrimary?.audioMessage) {
      archivoUrl = msgPrimary.audioMessage.url || null;
      const segundos = msgPrimary.audioMessage.seconds;
      const caption = msgPrimary.audioMessage.caption;
      if (!mensaje) {
        mensaje =
          caption ||
          `[Audio de WhatsApp${segundos ? ` - ${segundos}s` : ""}]`;
      }
    }

    // 📎 Documento
    if (msgPrimary?.documentMessage) {
      archivoUrl = msgPrimary.documentMessage.url || null;
      const fileName = msgPrimary.documentMessage.fileName;
      if (!mensaje) {
        mensaje = `[Documento: ${fileName || "Archivo"}]`;
      }
    }

    const waMessageId =
      data.messageId ||
      data.id ||
      (Array.isArray(data.messages) && data.messages[0]?.key?.id) ||
      null;

    const pushName =
      data.pushName ||
      data.name ||
      (Array.isArray(data.messages) && data.messages[0]?.pushName) ||
      null;

    console.log("📞 TELEFONO NORMALIZADO:", telefono);
    console.log("💬 MENSAJE NORMALIZADO:", mensaje);
    console.log("📎 ARCHIVO URL:", archivoUrl);
    console.log("🙋 NOMBRE:", pushName);

    // si aún no pudimos sacar teléfono o mensaje, ignoramos
    if (!telefono || !mensaje) {
      console.log("⚠️ Webhook ignorado: falta teléfono o mensaje.");
      return res.status(200).json({ ok: true, ignored: true });
    }

    // =====================================================
    // INICIAR TRANSACCIÓN
    // =====================================================
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // --------------------------------------
      // 3) Buscar o crear cliente por teléfono
      // --------------------------------------
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
            pushName || "Cliente WhatsApp",
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

      // --------------------------------------
      // 4) Buscar o crear conversación
      // --------------------------------------
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

      // --------------------------------------
      // 5) Insertar mensaje en historial
      // --------------------------------------
      await client.query(
        `INSERT INTO crm_mensajes
         (conversacion_id, telefono, cuerpo, tipo, origen, wa_message_id, archivo_url)
         VALUES ($1, $2, $3, 'IN', 'whatsapp', $4, $5)`,
        [conversacionId, telefono, mensaje, waMessageId, archivoUrl]
      );

      await client.query("COMMIT");

      console.log("✅ Mensaje IN guardado en CRM");
      return res.json({ ok: true });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("🔥 Error en registrarMensajeEntrante:", err);
      return res.status(500).json({ ok: false, error: "Error interno" });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("🔥 Error general en webhook CRM:", err);
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
