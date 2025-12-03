const pool = require("../../db");

exports.getAll = async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM productos ORDER BY id DESC");
    res.json({ ok: true, data: result.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
};

exports.getById = async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM productos WHERE id = $1",
      [req.params.id]
    );
    res.json({ ok: true, data: result.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
};

exports.create = async (req, res) => {
  try {
    const { nombre, precio, categoria } = req.body;

    const result = await pool.query(
      `INSERT INTO productos (nombre, precio, categoria) 
       VALUES ($1, $2, $3) RETURNING *`,
      [nombre, precio, categoria]
    );

    res.json({ ok: true, data: result.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
};

exports.update = async (req, res) => {
  try {
    const { nombre, precio, categoria } = req.body;

    const result = await pool.query(
      `UPDATE productos SET nombre=$1, precio=$2, categoria=$3 
       WHERE id=$4 RETURNING *`,
      [nombre, precio, categoria, req.params.id]
    );

    res.json({ ok: true, data: result.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
};

exports.remove = async (req, res) => {
  try {
    await pool.query("DELETE FROM productos WHERE id=$1", [req.params.id]);
    res.json({ ok: true, message: "Producto eliminado" });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
};
