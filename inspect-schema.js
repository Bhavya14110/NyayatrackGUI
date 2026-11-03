const pool = require('./db');

async function main() {
  try {
    const tables = await pool.query(
      `SELECT table_name, COUNT(*) AS no_of_columns
         FROM information_schema.columns
        WHERE table_schema = $1
        GROUP BY table_name
        ORDER BY table_name`,
      ['public']
    );
    console.log('Tables in schema "public":');
    console.table(tables.rows);

    const columns = await pool.query(
      `SELECT column_name, data_type, character_maximum_length AS max_len, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2
        ORDER BY ordinal_position`,
      ['public', 'court_case']
    );
    console.log('Columns of court_case (main table used for CRUD):');
    console.table(columns.rows);

    const count = await pool.query('SELECT COUNT(*) AS cases FROM court_case');
    console.log('Rows in court_case:', count.rows[0].cases);
  } catch (err) {
    console.error('Schema inspection failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
