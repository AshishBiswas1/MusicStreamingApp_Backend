process.on('uncaughtException', (err) => {
  console.log('UNHANDLED Exception!💥 SHUTTING DOWN...');
  console.log(err.name, err.message);
  process.exit(1);
});

// Load Environment Variable
const dotenv = require('dotenv').config({ path: '.env'});


const port = process.env.PORT;

const app = require('./app');

const server = app.listen(port, () => console.log(`Server running on the port ${port}`));

process.on('unhandledRejection', (err) => {
  console.log(err.name, err.message);
  console.log('UNHANDLED REJECTION!💥 SHUTTING DOWN...');
  server.close(() => {
    process.exit(1);
  });
});