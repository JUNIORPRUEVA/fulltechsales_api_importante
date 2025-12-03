const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const pool = require("../../db");

// =======================================
//  REGISTRO
// =======================================
const register = async (req, res) => {
  try {
    const { usuario, nombre, email, telefono, password, rol } = req.body;

    // Validación básica
    if (!usuario || !nombre || !email || !password) {
      return res.status(400).json({ ok: false, msg: "Faltan datos" });
    }

    // Hashear contraseña
    const hash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO usuarios (usuario, nombre, email, telefono, password_hash, rol)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, usuario, nombre, email, telefono, rol, activo, creado_en`,
      [usuario, nombre, email, telefono, hash, rol || "Vendedor"]
    );

    // Devolvemos el usuario creado
    res.json({ ok: true, usuario: result.rows[0] });
  } catch (e) {
    console.error("ERROR REGISTER:", e);
    res.status(500).json({ ok: false, msg: "Error servidor" });
  }
};

// =======================================
//  LOGIN
// =======================================
const login = async (req, res) => {
  try {
    // Aceptamos email o usuario (el que venga)
    const { email, usuario, password } = req.body;
    const loginValue = email || usuario;

    if (!loginValue || !password) {
      return res
        .status(400)
        .json({ ok: false, msg: "Faltan credenciales" });
    }

    const result = await pool.query(
      `SELECT id, usuario, nombre, email, telefono, rol, activo, password_hash
       FROM usuarios
       WHERE email = $1 OR usuario = $1
       LIMIT 1`,
      [loginValue]
    );

    if (result.rowCount === 0) {
      return res
        .status(401)
        .json({ ok: false, msg: "Usuario no encontrado" });
    }

    const usuarioDb = result.rows[0];

    const valid = await bcrypt.compare(password, usuarioDb.password_hash);
    if (!valid) {
      return res
        .status(401)
        .json({ ok: false, msg: "Contraseña incorrecta" });
    }

    // Token igual que antes
    const token = jwt.sign(
      { id: usuarioDb.id, email: usuarioDb.email, rol: usuarioDb.rol },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    // Devolvemos también los datos del usuario
    res.json({
      ok: true,
      token,
      id: usuarioDb.id,
      nombre: usuarioDb.nombre,
      usuario: usuarioDb.usuario,
      email: usuarioDb.email,
      telefono: usuarioDb.telefono,
      rol: usuarioDb.rol,
      activo: usuarioDb.activo ?? true,
    });
  } catch (e) {
    console.error("ERROR LOGIN:", e);
    res.status(500).json({ ok: false, msg: "Error servidor" });
  }
};

// =======================================
//  LISTAR TODOS LOS USUARIOS
//  GET /auth/usuarios
// =======================================
const obtenerUsuarios = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, usuario, nombre, email, telefono, rol, activo, creado_en
       FROM usuarios
       ORDER BY id ASC`
    );

    res.json({ ok: true, usuarios: result.rows });
  } catch (e) {
    console.error("ERROR LISTAR USUARIOS:", e);
    res.status(500).json({ ok: false, msg: "Error servidor" });
  }
};

// =======================================
//  OBTENER UN USUARIO POR ID
//  GET /auth/usuarios/:id
// =======================================
const obtenerUsuarioPorId = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT id, usuario, nombre, email, telefono, rol, activo, creado_en, actualizado_en
       FROM usuarios
       WHERE id = $1`,
      [id]
    );

    if (result.rowCount === 0) {
      return res.json({ ok: false, msg: "Usuario no encontrado" });
    }

    res.json({ ok: true, usuario: result.rows[0] });
  } catch (e) {
    console.error("ERROR OBTENER USUARIO:", e);
    res.status(500).json({ ok: false, msg: "Error servidor" });
  }
};

// =======================================
//  ACTUALIZAR USUARIO
//  PUT /auth/usuarios/:id
// =======================================
const actualizarUsuario = async (req, res) => {
  try {
    const { id } = req.params;
    const { usuario, nombre, email, telefono, rol, activo } = req.body;

    const result = await pool.query(
      `UPDATE usuarios
       SET usuario = $1,
           nombre = $2,
           email = $3,
           telefono = $4,
           rol = $5,
           activo = $6,
           actualizado_en = NOW()
       WHERE id = $7
       RETURNING id, usuario, nombre, email, telefono, rol, activo, creado_en, actualizado_en`,
      [usuario, nombre, email, telefono, rol, activo, id]
    );

    res.json({ ok: true, usuario: result.rows[0] });
  } catch (e) {
    console.error("ERROR ACTUALIZAR USUARIO:", e);
    res.status(500).json({ ok: false, msg: "Error servidor" });
  }
};

// =======================================
//  ELIMINAR USUARIO
//  DELETE /auth/usuarios/:id
// =======================================
const eliminarUsuario = async (req, res) => {
  try {
    const { id } = req.params;

    await pool.query(`DELETE FROM usuarios WHERE id = $1`, [id]);

    res.json({ ok: true, msg: "Usuario eliminado" });
  } catch (e) {
    console.error("ERROR ELIMINAR USUARIO:", e);
    res.status(500).json({ ok: false, msg: "Error servidor" });
  }
};

// =======================================
//  BLOQUEAR / ACTIVAR USUARIO
//  PATCH /auth/usuarios/:id/bloqueo
// =======================================
const cambiarEstadoActivo = async (req, res) => {
  try {
    const { id } = req.params;
    const { activo } = req.body;

    const result = await pool.query(
      `UPDATE usuarios
       SET activo = $1,
           actualizado_en = NOW()
       WHERE id = $2
       RETURNING id, activo`,
      [activo, id]
    );

    res.json({ ok: true, usuario: result.rows[0] });
  } catch (e) {
    console.error("ERROR CAMBIAR ESTADO:", e);
    res.status(500).json({ ok: false, msg: "Error servidor" });
  }
};

module.exports = {
  register,
  login,
  obtenerUsuarios,
  obtenerUsuarioPorId,
  actualizarUsuario,
  eliminarUsuario,
  cambiarEstadoActivo,
};
