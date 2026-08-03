const { Client } = require('pg');

async function main() {
  const admin = new Client({
    connectionString: 'postgresql://postgres:postgres@127.0.0.1:5433/postgres',
  });
  await admin.connect();

  const velvet = await admin.query("SELECT 1 FROM pg_database WHERE datname = 'velvet'");
  if (velvet.rowCount === 0) {
    const old = await admin.query("SELECT 1 FROM pg_database WHERE datname = 'velvet'");
    if (old.rowCount > 0) {
      await admin.query(`
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = 'velvet' AND pid <> pg_backend_pid()
      `);
      await admin.query('ALTER DATABASE velvet RENAME TO velvet');
      console.log('renamed velvet -> velvet');
    } else {
      // also check accidental capital Velvet
      const cap = await admin.query(`SELECT datname FROM pg_database WHERE lower(datname) = 'velvet'`);
      if (cap.rowCount > 0) {
        console.log('found', cap.rows);
      } else {
        await admin.query('CREATE DATABASE velvet');
        console.log('created velvet');
      }
    }
  } else {
    console.log('velvet already exists');
  }

  await admin.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
