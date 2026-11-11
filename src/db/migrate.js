import { query, queryOne } from './mysql.js'

const SESSION_COLUMNS = [
  ['customer_name',       'VARCHAR(255) NULL'],
  ['customer_phone',      'VARCHAR(20) NULL'],
  ['status',              "VARCHAR(10) NOT NULL DEFAULT 'open'"],
  ['last_customer_at',    'DATETIME(3) NULL'],
  ['last_agent_at',       'DATETIME(3) NULL'],
  ['alerted_at',          'DATETIME(3) NULL'],
  ['customer_emailed_at', 'DATETIME(3) NULL']
]

async function ensureColumn(table, column, ddl) {
  const row = await queryOne(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  )
  if (Number(row.n) === 0) await query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${ddl}`)
}

async function ensureIndex(table, name, columnsSql) {
  const row = await queryOne(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, name]
  )
  if (Number(row.n) === 0) await query(`ALTER TABLE \`${table}\` ADD INDEX \`${name}\` (${columnsSql})`)
}

/** Idempotent schema upgrade for live agent chat. */
export async function migrate() {
  for (const [col, ddl] of SESSION_COLUMNS) await ensureColumn('chat_sessions', col, ddl)
  await ensureIndex('chat_sessions', 'idx_sessions_status', 'status, last_customer_at')
  // Legacy agent messages were stored as assistant rows prefixed "[Agent] " (8 chars).
  await query(
    `UPDATE chat_messages SET role = 'agent', content = SUBSTRING(content, 9)
     WHERE role = 'assistant' AND content LIKE '[Agent] %'`
  )
}
