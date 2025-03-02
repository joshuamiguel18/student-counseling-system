const {Pool} = require('pg');


// PostgreSQL configuration
const pool = new Pool({
  user: 'postgres',
  password: '123',
  database: 'rate-smart',
  host: 'localhost',
  port: 5432, 
});



module.exports = pool;