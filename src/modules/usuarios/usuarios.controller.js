// src/modules/usuarios/usuarios.controller.js
const pool = require("../../db");
const bcrypt = require("bcrypt");

// ================================
// LISTAR TODOS LOS USUARIOS
// ================================
const listarUsuarios = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, nombre, usuario, email, telefono, rol, activo, creado_en
      FROM usuarios
      ORDER BY id ASC
    `);

    res.json({
      ok: true,
      usuarios: result.rows,
    });
  } catch (e) {
    console.error("ERROR LISTAR USUARIOS:", e);
    res.status(500).json({ ok: false, msg: "Error servidor" });
  }
};

// ================================
// CREAR USUARIO DESDE ADMIN
// ================================
const crearUsuario = async (req, res) => {
  try {
    const { usuario, nombre, email, telefono, password, rol } = req.body;

    const hash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO usuarios(usuario, nombre, email, telefono, password_hash, rol)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, nombre, usuario, email, telefono, rol, activo`,
      [usuario, nombre, email, telefono, hash, rol]
    );

    res.json({ ok: true, usuario: result.rows[0] });
  } catch (e) {
    console.error("ERROR CREAR USUARIO:", e);
    res.status(500).json({ ok: false, msg: "Error servidor" });
  }
};

// ================================
// ACTUALIZAR USUARIO
// ================================
const actualizarUsuario = async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, usuario, email, telefono, rol, activo } = req.body;

    const result = await pool.query(
      `UPDATE usuarios
       SET nombre=$1, usuario=$2, email=$3, telefono=$4, rol=$5, activo=$6, actualizado_en=NOW()
       WHERE id=$7
       RETURNING id, nombre, usuario, email, telefono, rol, activo`,
      [nombre, usuario, email, telefono, rol, activo, id]
    );

    res.json({ ok: true, usuario: result.rows[0] });
  } catch (e) {
    console.error("ERROR ACTUALIZAR USUARIO:", e);
    res.status(500).json({ ok: false, msg: "Error servidor" });
  }
};

module.exports = {
  listarUsuarios,
  crearUsuario,
  actualizarUsuario,
};
