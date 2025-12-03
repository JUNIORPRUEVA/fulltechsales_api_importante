require('dotenv').config();
const app = require('./src/app');

const PORT = process.env.PORT || 5000
;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor FULLPOS API corriendo en http://10.0.2.15:${PORT}`);
});
