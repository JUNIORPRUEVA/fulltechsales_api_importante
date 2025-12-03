// index.js
require('dotenv').config();
const http = require('http');
const app = require('./src/app');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 5000;

// Crear servidor HTTP a partir de Express
const server = http.createServer(app);

// Crear instancia de Socket.IO
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// Guardamos io dentro de app para usarlo en los controllers
app.set('io', io);

// Eventos básicos de conexión
io.on('connection', (socket) => {
  console.log('🟢 Cliente Socket conectado:', socket.id);

  socket.on('disconnect', () => {
    console.log('🔴 Cliente Socket desconectado:', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`🚀 Servidor FULLPOS API corriendo en puerto ${PORT}`);
});
