const {Pool} = require('pg');
require('dotenv').config();

// PostgreSQL configuration
// const pool = new Pool({
//   user: 'postgres',
//   password: '123',
//   database: 'rate-smart',
//   host: 'localhost',
//   port: 5432, 
// });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,

});

module.exports = pool;