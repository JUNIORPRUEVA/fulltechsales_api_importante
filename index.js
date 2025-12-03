require('dotenv').config();

// Importamos app + server desde app.js
const { app, server } = require('./src/app');

const PORT = process.env.PORT || 5000;

// IMPORTANTE: ahora usamos server.listen, no app.listen
server.listen(PORT, () => {
  console.log(`🚀 FULLPOS API + Socket.IO corriendo en puerto ${PORT}`);
});
