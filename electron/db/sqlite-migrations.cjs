async function ensureMigrationsTable(db, tableName) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS ${tableName} (
      id TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);
}

async function listAppliedMigrationIds(db, tableName) {
  const rows = await db.all(`SELECT id FROM ${tableName}`);
  return new Set(rows.map((row) => String(row.id)));
}

async function recordAppliedMigration(db, tableName, migrationId) {
  await db.run(
    `INSERT INTO ${tableName}(id, applied_at) VALUES(?, ?)`,
    migrationId,
    Date.now(),
  );
}

async function applySqliteMigrations(db, migrations, options = {}) {
  const tableName = String(options.tableName || "tool_hub_schema_migrations");
  await ensureMigrationsTable(db, tableName);
  const appliedIds = await listAppliedMigrationIds(db, tableName);

  for (let index = 0; index < migrations.length; index += 1) {
    const migration = migrations[index];
    const migrationId = String(migration?.id ?? "").trim();
    if (!migrationId) {
      throw new Error(`Invalid migration id at index ${index}.`);
    }
    if (appliedIds.has(migrationId)) {
      continue;
    }
    if (typeof migration.up !== "function") {
      throw new Error(`Migration "${migrationId}" is missing an up() function.`);
    }

    await migration.up(db);
    await recordAppliedMigration(db, tableName, migrationId);
    appliedIds.add(migrationId);
  }
}

async function tableHasColumn(db, tableName, columnName) {
  const rows = await db.all(`PRAGMA table_info(${tableName})`);
  return rows.some((row) => String(row.name) === String(columnName));
}

module.exports = {
  applySqliteMigrations,
  tableHasColumn,
};
