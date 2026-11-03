const pool = require('./db');

async function main() {
  try {
    const result = await pool.query('SELECT version()');
    console.log('Connected to PostgreSQL successfully!');
    console.log('Database :', process.env.PGDATABASE);
    console.log('Version  :', result.rows[0].version);
  } catch (err) {
    console.error('Connection failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
