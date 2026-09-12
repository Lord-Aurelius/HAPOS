/**
 * Static guardrail for relational migrations (Phase 2 §0).
 *
 * A live Postgres instance is not available in every environment, so this
 * script verifies what can be verified without a database:
 *
 * 1. Every db/migrations/phase-*.sql runs in a transaction (begin/commit).
 * 2. No destructive statements (DROP TABLE/DATABASE/SCHEMA, TRUNCATE).
 * 3. Every `references public.<table>` target exists in db/schema.sql or an
 *    earlier migration file.
 * 4. Enum-style CHECK lists in SQL match the TypeScript unions that enforce
 *    the same vocabulary at runtime (inventory movement types, order/sale
 *    statuses). Source of truth for vocabulary: the TS engine modules.
 *
 * Live application (staging) with invariant comparison remains mandatory
 * before any production use — see docs/phase-0-persistence-decision.md.
 *
 * Usage: npm run verify:migrations
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const migrationsDir = path.join(root, 'db', 'migrations');
const schemaSql = fs.readFileSync(path.join(root, 'db', 'schema.sql'), 'utf8');

const failures = [];
function fail(message) {
  failures.push(message);
  console.error(`FAIL: ${message}`);
}

/** Extract quoted literals from a SQL `in (...)` check list near an anchor. */
function extractSqlLiterals(sql, anchor) {
  const anchorIndex = sql.indexOf(anchor);
  if (anchorIndex === -1) {
    return null;
  }
  const window = sql.slice(anchorIndex, anchorIndex + 2000);
  const match = /in\s*\(([^)]+)\)/i.exec(window);
  if (!match) {
    return null;
  }
  return match[1]
    .split(',')
    .map((part) => part.trim().replace(/^'|'$/g, ''))
    .filter(Boolean)
    .sort();
}

/** Extract string-literal union members from a TS `export type X = 'a' | 'b'`. */
function extractTsUnion(source, typeName) {
  const match = new RegExp(`export type ${typeName} =([^;]+);`).exec(source);
  if (!match) {
    return null;
  }
  return match[1]
    .split('|')
    .map((part) => part.trim().replace(/^'|'$/g, ''))
    .filter((part) => part && !part.includes(' '))
    .sort();
}

function knownTables() {
  const tables = new Set();
  const collect = (sql) => {
    for (const match of sql.matchAll(/create table if not exists public\.(\w+)/gi)) {
      tables.add(match[1].toLowerCase());
    }
  };
  collect(schemaSql);
  for (const file of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    collect(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
  }
  return tables;
}

const tables = knownTables();
const migrationFiles = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

if (migrationFiles.length === 0) {
  fail('no migration files found in db/migrations');
}

for (const file of migrationFiles) {
  const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
  const stripped = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

  if (!/^\s*begin\s*;/im.test(stripped)) {
    fail(`${file}: must start with begin;`);
  }
  if (!/commit\s*;\s*$/im.test(stripped)) {
    fail(`${file}: must end with commit;`);
  }
  for (const pattern of [/\bdrop\s+(table|database|schema)\b/i, /\btruncate\b/i]) {
    if (pattern.test(stripped)) {
      fail(`${file}: destructive statement matched ${pattern}`);
    }
  }

  for (const match of stripped.matchAll(/references public\.(\w+)/gi)) {
    if (!tables.has(match[1].toLowerCase())) {
      fail(`${file}: references unknown table public.${match[1]}`);
    }
  }
}

// Vocabulary parity: SQL CHECK lists vs TS engine unions.
const commerceDir = path.join(root, 'src', 'server', 'commerce');
const parityChecks = [
  {
    sqlFile: 'phase-01-catalog-inventory.sql',
    anchor: 'movement_type text not null check',
    tsFile: 'inventory.ts',
    tsType: 'InventoryMovementType',
    label: 'inventory movement types',
  },
  {
    sqlFile: 'phase-02-orders-sales.sql',
    anchor: 'order_status_check',
    tsFile: 'orders.ts',
    tsType: 'OrderStatus',
    label: 'order statuses',
  },
  {
    sqlFile: 'phase-02-orders-sales.sql',
    anchor: 'sale_status_check',
    tsFile: 'orders.ts',
    tsType: 'SaleStatus',
    label: 'sale statuses',
  },
  {
    sqlFile: 'phase-2a-attendance.sql',
    anchor: 'attendance_status_check',
    tsFile: 'attendance.ts',
    tsType: 'AttendanceStatus',
    label: 'attendance statuses',
  },
  {
    sqlFile: 'phase-03-seller-credentials.sql',
    anchor: 'seller_credential_status_check',
    tsFile: 'seller.ts',
    tsType: 'SellerCredentialStatus',
    label: 'seller credential statuses',
  },
  {
    sqlFile: 'phase-04-payments.sql',
    anchor: 'payment_status_check',
    tsFile: 'payments.ts',
    tsType: 'PaymentStatus',
    label: 'payment statuses',
  },
  {
    sqlFile: 'phase-04-payments.sql',
    anchor: 'payment_provider_check',
    tsFile: 'payments.ts',
    tsType: 'PaymentProvider',
    label: 'payment providers',
  },
  {
    sqlFile: 'phase-04-payments.sql',
    anchor: 'payment_method_check',
    tsFile: 'payments.ts',
    tsType: 'PaymentMethod',
    label: 'payment methods',
  },
];

for (const check of parityChecks) {
  const sqlPath = path.join(migrationsDir, check.sqlFile);
  const tsPath = path.join(commerceDir, check.tsFile);
  if (!fs.existsSync(sqlPath) || !fs.existsSync(tsPath)) {
    console.log(`SKIP: ${check.label} (files not both present yet)`);
    continue;
  }
  const sqlLiterals = extractSqlLiterals(fs.readFileSync(sqlPath, 'utf8'), check.anchor);
  const tsLiterals = extractTsUnion(fs.readFileSync(tsPath, 'utf8'), check.tsType);
  if (!sqlLiterals) {
    fail(`${check.sqlFile}: anchor '${check.anchor}' has no parseable in-list`);
    continue;
  }
  if (!tsLiterals) {
    fail(`${check.tsFile}: type ${check.tsType} not parseable`);
    continue;
  }
  const sqlSet = JSON.stringify(sqlLiterals);
  const tsSet = JSON.stringify(tsLiterals);
  if (sqlSet !== tsSet) {
    fail(
      `${check.label} diverge.\n  SQL (${check.sqlFile}): ${sqlSet}\n  TS  (${check.tsFile}): ${tsSet}`,
    );
  } else {
    console.log(`OK: ${check.label} (${tsLiterals.length} values in parity)`);
  }
}

if (failures.length > 0) {
  console.error(`\n${failures.length} migration check(s) failed.`);
  process.exit(1);
}
console.log(`\nAll migration checks passed (${migrationFiles.length} file(s)).`);
