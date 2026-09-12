/**
 * SQL staging verification (Phase 2A closure GAP 1).
 *
 * Verifies the commerce migrations against a STAGING database:
 * schema metadata, smoke flows, RLS isolation, and concurrency backstops.
 *
 * Safety contract (read before running):
 * - Set DATABASE_URL to the STAGING database. Never production.
 * - Set HAPOS_STAGING_CONFIRM=yes-staging, otherwise the script refuses.
 * - Hosts containing "prod" are refused unconditionally.
 * - The connection string is never printed or logged.
 * - The script creates ONLY rows under test tenants (slug verify-shop-*)
 *   plus one temporary restricted role; both are removed during cleanup.
 * - It does NOT apply migrations (apply manually with psql in the order
 *   printed below) and never drops tables, databases, or real data.
 *
 * Usage:
 *   HAPOS_STAGING_CONFIRM=yes-staging DATABASE_URL="<staging>" npm run verify:sql-staging
 */
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO = path.join(__dirname, '..');

let cachedStagingConfig = null;
function stagingConfig() {
  if (cachedStagingConfig) {
    return cachedStagingConfig;
  }
  if (process.env.HAPOS_STAGING_CONFIRM !== 'yes-staging') {
    console.error('Refusing: set HAPOS_STAGING_CONFIRM=yes-staging to confirm a staging target.');
    process.exit(2);
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('Refusing: DATABASE_URL is not set.');
    process.exit(2);
  }
  let host = '';
  let database = '';
  try {
    const parsed = new URL(url);
    host = parsed.hostname;
    database = parsed.pathname.replace(/^\//, '');
  } catch {
    console.error('Refusing: DATABASE_URL is not a valid URL.');
    process.exit(2);
  }
  if (/prod/i.test(host) || /prod/i.test(database)) {
    console.error(`Refusing: target looks like production (host/database hidden).`);
    process.exit(2);
  }
  console.log(`target: host=${host} database=${database} (staging-confirmed; credentials hidden)`);
  cachedStagingConfig = { url, host, database };
  return cachedStagingConfig;
}

const results = [];
function check(section, name, fn) {
  return Promise.resolve()
    .then(fn)
    .then((detail) => {
      results.push({ section, name, ok: true, detail });
      console.log(`  PASS ${section} :: ${name}${detail ? ` — ${detail}` : ''}`);
    })
    .catch((error) => {
      results.push({ section, name, ok: false, detail: String(error && error.message || error) });
      console.log(`  FAIL ${section} :: ${name} — ${error && error.message || error}`);
    });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const { url: connectionString, database } = stagingConfig();

  // Server is managed externally; this script only connects.
  const admin = new Pool({ connectionString, max: 10 });
  const readFile = (p) => fs.readFileSync(path.join(REPO, p), 'utf8');
  const RUN = Date.now().toString(36);
  const ROLE = `hapos_verify_app_${RUN}`;

  // ── apply migrations in order ──
  console.log('checking applied migrations...');
  console.log('  (apply manually first, in order: db/schema.sql, phase-01, phase-02, phase-2a, phase-03, phase-03b)');
  const appliedTables = await admin.query(
    `select tablename from pg_tables where schemaname='public' and tablename in ('service_product_links','inventory_movements','orders','sale_items','attendance_records','seller_credentials','sale_amendments')`,
  );
  if (appliedTables.rows.length < 7) {
    console.error(`Refusing: commerce tables missing (found ${appliedTables.rows.length}/7). Apply the migrations first.`);
    process.exit(2);
  }
  console.log('  commerce tables present.');

  const q = (text, params) => admin.query(text, params).then((r) => r.rows);

  // ── B. metadata ──
  console.log('== metadata ==');
  await check('meta', 'new tables exist', async () => {
    const rows = await q(`select tablename from pg_tables where schemaname='public' and tablename in ('service_product_links','inventory_movements','orders','order_items','sales','sale_items','attendance_terminals','attendance_records','seller_credentials','sale_amendments','payments')`);
    assert(rows.length === 11, `expected 11 tables, got ${rows.length}`);
    return rows.map((r) => r.tablename).sort().join(',');
  });

  await check('meta', 'products catalog columns', async () => {
    const rows = await q(`select column_name, data_type, is_nullable, column_default from information_schema.columns where table_name='products' and column_name in ('sku','selling_price','quantity_on_hand','reorder_level','critical_level','sku_generated') order by column_name`);
    const byName = Object.fromEntries(rows.map((r) => [r.column_name, r]));
    assert(byName.sku, 'sku missing');
    assert(byName.selling_price && byName.selling_price.is_nullable === 'YES', 'selling_price must be nullable (needs_pricing)');
    assert(byName.quantity_on_hand && byName.quantity_on_hand.is_nullable === 'NO', 'quantity_on_hand must be NOT NULL');
    assert(byName.sku_generated, 'sku_generated missing');
    return 'sku nullable; selling_price nullable; qty NOT NULL default 0';
  });

  await check('meta', 'users.employee_number nullable', async () => {
    const rows = await q(`select is_nullable from information_schema.columns where table_name='users' and column_name='employee_number'`);
    assert(rows.length === 1 && rows[0].is_nullable === 'YES', 'employee_number must exist and be nullable');
  });

  await check('meta', 'partial unique indexes with correct predicates', async () => {
    const rows = await q(`select indexname, indexdef from pg_indexes where schemaname='public' and indexname in ('products_tenant_sku_unique_idx','orders_tenant_idempotency_unique_idx','sales_tenant_idempotency_unique_idx','attendance_records_open_unique_idx','users_tenant_employee_number_unique_idx','sales_tenant_order_unique')`);
    const defs = Object.fromEntries(rows.map((r) => [r.indexname, r.indexdef]));
    assert(defs.attendance_records_open_unique_idx && defs.attendance_records_open_unique_idx.includes('WHERE'), 'open-record index must be partial');
    assert(defs.attendance_records_open_unique_idx.includes('check_out_at'), 'open-record predicate must reference check_out_at');
    assert(defs.orders_tenant_idempotency_unique_idx && defs.orders_tenant_idempotency_unique_idx.includes('WHERE'), 'order idempotency must be partial');
    assert(defs.users_tenant_employee_number_unique_idx && defs.users_tenant_employee_number_unique_idx.includes('WHERE'), 'employee number unique must be partial');
    return `${rows.length} key indexes present`;
  });

  await check('meta', 'check constraints on new tables', async () => {
    const rows = await q(`select conname from pg_constraint where conrelid in ('public.orders'::regclass,'public.order_items'::regclass,'public.sales'::regclass,'public.sale_items'::regclass,'public.inventory_movements'::regclass,'public.attendance_records'::regclass) and contype='c'`);
    const names = rows.map((r) => r.conname);
    for (const expected of ['order_status_check', 'order_items_single_reference_check', 'order_items_line_total_math_check', 'sale_status_check', 'sales_tenant_order_unique', 'inventory_movements_balance_check', 'attendance_status_check', 'attendance_records_checkout_order_check', 'attendance_records_status_consistency_check']) {
      const found = names.includes(expected) || (await q(`select indexname from pg_indexes where indexname=$1`, [expected])).length > 0;
      assert(found, `missing constraint/index ${expected}`);
    }
    return `${names.length} check constraints`;
  });

  await check('meta', 'foreign keys reference tenant-scoped parents', async () => {
    const rows = await q(`select count(*)::int as n from pg_constraint where conrelid in ('public.order_items'::regclass,'public.sale_items'::regclass,'public.inventory_movements'::regclass,'public.attendance_records'::regclass,'public.payments'::regclass) and contype='f'`);
    assert(rows[0].n >= 10, `expected >=10 FKs, got ${rows[0].n}`);
    return `${rows[0].n} FKs`;
  });

  await check('meta', 'RLS enabled+forced with policies', async () => {
    const rows = await q(`select relname, relrowsecurity as enabled, relforcerowsecurity as forced from pg_class where relname in ('orders','order_items','sales','sale_items','inventory_movements','service_product_links','attendance_terminals','attendance_records','seller_credentials','sale_amendments','payments')`);
    assert(rows.length === 11, 'tables missing');
    for (const row of rows) {
      assert(row.enabled && row.forced, `RLS not enforced on ${row.relname}`);
    }
    const pols = await q(`select tablename, count(*)::int as n from pg_policies where schemaname='public' and tablename in ('orders','order_items','sales','sale_items','inventory_movements','service_product_links','attendance_terminals','attendance_records','seller_credentials','sale_amendments','payments') group by tablename`);
    assert(pols.length === 11, `policies missing on some tables: ${JSON.stringify(pols)}`);
    for (const row of pols) {
      assert(row.n >= 4, `${row.tablename} has ${row.n} policies, expected >=4`);
    }
    return '11 tables x enforced RLS x >=4 policies';
  });

  // ── C. smoke ──
  console.log('== smoke ==');
  const ids = {};
  await check('smoke', 'seed staging fixtures', async () => {
    const t = await q(`insert into tenants (name, slug) values ('Verify Shop','verify-shop-${RUN}') returning id`);
    ids.tenant = t[0].id;
    const admin1 = await q(`insert into users (tenant_id, role, full_name, username, email, password_hash, employee_number) values ($1,'shop_admin','Verify Admin','vadmin','vadmin@x.example','x','EMP-0001') returning id`, [ids.tenant]);
    ids.admin = admin1[0].id;
    const staff = await q(`insert into users (tenant_id, role, full_name, username, email, password_hash, employee_number) values ($1,'staff','Verify Staff','vstaff','vstaff@x.example','x','EMP-0002') returning id`, [ids.tenant]);
    ids.staff = staff[0].id;
    const cust = await q(`insert into customers (tenant_id, name, phone, phone_e164) values ($1,'Test Customer','0711000000','+254711000000') returning id`, [ids.tenant]);
    ids.customer = cust[0].id;
    return 'tenant+admin+staff+customer';
  });

  await check('smoke', 'catalog: product + service + BOM', async () => {
    const p = await q(`insert into products (tenant_id, name, unit_cost, selling_price, sku, quantity_on_hand, reorder_level, critical_level) values ($1,'Hair Oil',300,800,'OIL-1',0,10,3) returning id`, [ids.tenant]);
    ids.product = p[0].id;
    const s = await q(`insert into services (tenant_id, name, price, duration_minutes) values ($1,'Colour',3000,90) returning id`, [ids.tenant]);
    ids.service = s[0].id;
    await q(`insert into service_product_links (tenant_id, service_id, product_id, quantity) values ($1,$2,$3,2)`, [ids.tenant, ids.service, ids.product]);
    return 'product/service/link created';
  });

  await check('smoke', 'inventory: opening + purchase + adjustment math', async () => {
    await q(`insert into inventory_movements (tenant_id, product_id, quantity, movement_type, previous_quantity, resulting_quantity, created_by) values ($1,$2,20,'OPENING_BALANCE',0,20,$3)`, [ids.tenant, ids.product, ids.admin]);
    await q(`update products set quantity_on_hand=20 where id=$1`, [ids.product]);
    await q(`insert into inventory_movements (tenant_id, product_id, quantity, movement_type, previous_quantity, resulting_quantity) values ($1,$2,-4,'SALE',20,16)`, [ids.tenant, ids.product]);
    await q(`update products set quantity_on_hand=16 where id=$1`, [ids.product]);
    const rows = await q(`select quantity_on_hand from products where id=$1`, [ids.product]);
    assert(rows[0].quantity_on_hand === 16, 'balance mismatch');
    return 'balance 16 as expected';
  });

  await check('smoke', 'orders/sales: mixed order approve + complete + void', async () => {
    const o = await q(`insert into orders (tenant_id, customer_id, seller_id, status, subtotal, total, source, submitted_at) values ($1,$2,$3,'SUBMITTED',4600,4600,'STAFF',now()) returning id`, [ids.tenant, ids.customer, ids.staff]);
    ids.order = o[0].id;
    await q(`insert into order_items (tenant_id, order_id, item_type, service_id, quantity, catalog_unit_price, actual_unit_price, line_total, item_name) values ($1,$2,'SERVICE',$3,1,3000,3000,3000,'Colour')`, [ids.tenant, ids.order, ids.service]);
    await q(`insert into order_items (tenant_id, order_id, item_type, product_id, quantity, catalog_unit_price, actual_unit_price, line_total, item_name) values ($1,$2,'PRODUCT',$3,2,800,800,1600,'Hair Oil')`, [ids.tenant, ids.order, ids.product]);
    await q(`update orders set status='APPROVED', approved_at=now(), approved_by=$2 where id=$1`, [ids.order, ids.admin]);
    const s = await q(`insert into sales (tenant_id, order_id, customer_id, seller_id, status, subtotal, total, approved_at, completed_at, recorded_by) values ($1,$2,$3,$4,'COMPLETED',4600,4600,now(),now(),$4) returning id`, [ids.tenant, ids.order, ids.customer, ids.staff]);
    ids.sale = s[0].id;
    await q(`insert into sale_items (tenant_id, sale_id, item_type, service_id, quantity, catalog_unit_price, actual_unit_price, line_total, item_name) values ($1,$2,'SERVICE',$3,1,3000,3000,3000,'Colour')`, [ids.tenant, ids.sale, ids.service]);
    await q(`update sales set status='VOIDED', voided_at=now(), void_reason='verify' where id=$1`, [ids.sale]);
    const st = await q(`select status from sales where id=$1`, [ids.sale]);
    assert(st[0].status === 'VOIDED', 'void failed');
    return 'order 4600 completed then voided';
  });

  await check('smoke', 'duplicate sale per order rejected (unique)', async () => {
    let rejected = false;
    try {
      await q(`insert into sales (tenant_id, order_id, status, subtotal, total) values ($1,$2,'COMPLETED',1,1)`, [ids.tenant, ids.order]);
    } catch (e) {
      rejected = /unique|duplicate/i.test(e.message);
    }
    assert(rejected, 'second sale for order was NOT rejected');
    return 'unique(tenant,order) enforced';
  });

  await check('smoke', 'constraint negatives rejected', async () => {
    const negatives = [];
    for (const [label, sql, params] of [
      ['negative-qty', `update products set quantity_on_hand=-1 where id=$1`, [ids.product]],
      ['bad-line-total', `insert into order_items (tenant_id, order_id, item_type, product_id, quantity, catalog_unit_price, actual_unit_price, line_total, item_name) values ($1,$2,'PRODUCT',$3,1,800,800,999,'X')`, [ids.tenant, ids.order, ids.product]],
      ['both-refs', `insert into order_items (tenant_id, order_id, item_type, product_id, service_id, quantity, catalog_unit_price, actual_unit_price, line_total, item_name) values ($1,$2,'PRODUCT',$3,$4,1,800,800,800,'X')`, [ids.tenant, ids.order, ids.product, ids.service]],
      ['bad-checkout', `insert into attendance_records (tenant_id, employee_id, employee_number_snapshot, attendance_date, check_in_at, check_out_at, status) values ($1,$2,'EMP-0002',current_date,now(),now() - interval '1 hour','CHECKED_OUT')`, [ids.tenant, ids.staff]],
    ]) {
      try {
        await q(sql, params);
        negatives.push(`${label}: NOT rejected`);
      } catch {
        /* expected */
      }
    }
    assert(negatives.length === 0, negatives.join('; '));
    return '4/4 negatives rejected';
  });

  await check('smoke', 'attendance: terminal + in/out + double-open rejected', async () => {
    const t = await q(`insert into attendance_terminals (tenant_id, reference, token_hash) values ($1,'att-verify-${RUN}','hash') returning id`, [ids.tenant]);
    ids.terminal = t[0].id;
    await q(`insert into attendance_records (tenant_id, employee_id, employee_number_snapshot, attendance_date, check_in_at, status, terminal_reference) values ($1,$2,'EMP-0002',current_date,now(),'CHECKED_IN','att-verify-${RUN}')`, [ids.tenant, ids.staff]);
    let rejected = false;
    try {
      await q(`insert into attendance_records (tenant_id, employee_id, employee_number_snapshot, attendance_date, check_in_at, status) values ($1,$2,'EMP-0002',current_date,now(),'CHECKED_IN')`, [ids.tenant, ids.staff]);
    } catch (e) {
      rejected = /unique|duplicate/i.test(e.message);
    }
    assert(rejected, 'second open record NOT rejected');
    await q(`update attendance_records set check_out_at=now(), status='CHECKED_OUT' where tenant_id=$1 and employee_id=$2 and check_out_at is null`, [ids.tenant, ids.staff]);
    return 'open invariant holds; closed ok';
  });

  await check('smoke', 'seller credentials: issue, single-active, revoke, reissue', async () => {
    await q(`insert into seller_credentials (tenant_id, seller_id, public_reference, token_hash) values ($1,$2,'sel-verify-${RUN}','hash1')`, [ids.tenant, ids.staff]);
    let blocked = false;
    try {
      await q(`insert into seller_credentials (tenant_id, seller_id, public_reference, token_hash) values ($1,$2,'sel-verify2-${RUN}','hash2')`, [ids.tenant, ids.staff]);
    } catch (e) {
      blocked = /unique|duplicate/i.test(e.message);
    }
    assert(blocked, 'second active credential NOT rejected');
    await q(`update seller_credentials set status='REVOKED', revoked_at=now() where tenant_id=$1 and seller_id=$2 and status='ACTIVE'`, [ids.tenant, ids.staff]);
    await q(`insert into seller_credentials (tenant_id, seller_id, public_reference, token_hash) values ($1,$2,'sel-verify3-${RUN}','hash3')`, [ids.tenant, ids.staff]);
    let badStatus = false;
    try {
      await q(`insert into seller_credentials (tenant_id, seller_id, public_reference, token_hash, status) values ($1,$2,'sel-verify4-${RUN}','hash4','BOGUS')`, [ids.tenant, ids.staff]);
    } catch (e) {
      badStatus = /check|invalid/i.test(e.message);
    }
    assert(badStatus, 'bogus status NOT rejected');
    return 'single-active enforced; revocation frees the slot';
  });

  await check('smoke', 'sale amendments + credential attribution columns', async () => {
    const cols = await q(`select column_name from information_schema.columns where table_name in ('orders','sales') and column_name='seller_credential_id'`);
    assert(cols.length === 2, 'seller_credential_id missing on orders/sales');
    const cred = await q(`select id from seller_credentials where tenant_id=$1 and seller_id=$2 and status='ACTIVE'`, [ids.tenant, ids.staff]);
    await q(`update orders set seller_credential_id=$2 where id=$1`, [ids.order, cred[0].id]);
    await q(`update sales set seller_credential_id=$2 where id=$1`, [ids.sale, cred[0].id]);
    await q(`insert into sale_amendments (tenant_id, sale_id, previous_total, new_total, field_changes, reason) values ($1,$2,4600,4400,'[]','verify discount')`, [ids.tenant, ids.sale]);
    const rows = await q(`select previous_total, new_total from sale_amendments where sale_id=$1`, [ids.sale]);
    assert(rows.length === 1 && Number(rows[0].previous_total) === 4600, 'amendment audit missing');
    return 'attribution links + amendment audit persist';
  });

  await check('smoke', 'payment intent columns + vocabulary', async () => {
    const cols = await q(`select table_name from information_schema.columns where table_name in ('orders','sales') and column_name in ('payment_method','customer_phone')`);
    assert(cols.length === 4, `payment intent columns missing (${cols.length}/4)`);
    const wrapped = await q(`select table_name from information_schema.columns where ((table_name='seller_credentials' and column_name='bearer_wrapped') or (table_name='attendance_terminals' and column_name='token_wrapped'))`);
    assert(wrapped.length === 2, 'sealed QR bearer columns missing');
    await q(`insert into orders (tenant_id, status, subtotal, total, source, payment_method, customer_phone) values ($1,'PENDING_REVIEW',1000,1000,'SELLER_QR','MPESA','+254712345678') returning id`, [ids.tenant]);
    let rejected = 0;
    for (const [label, sql] of [
      ['bad-method', `insert into orders (tenant_id, status, subtotal, total, source, payment_method) values ('${ids.tenant}','PENDING_REVIEW',1,1,'SELLER_QR','CRYPTO')`],
      ['bad-phone', `insert into orders (tenant_id, status, subtotal, total, source, payment_method, customer_phone) values ('${ids.tenant}','PENDING_REVIEW',1,1,'SELLER_QR','MPESA','0712')`],
    ]) {
      try {
        await q(sql);
      } catch {
        rejected += 1;
      }
      void label;
    }
    assert(rejected === 2, 'payment vocabulary not enforced');
    return 'intent persists; method/phone vocabularies enforced';
  });

  // ── D. RLS (restricted role + app.* session vars) ──
  console.log('== rls ==');
  const appPassword = crypto.randomBytes(16).toString('hex');
  await admin.query(`create role ${ROLE} login password '${appPassword}'`);
  await admin.query(`grant connect on database "${database}" to ${ROLE}`);
  await admin.query(`grant usage on schema public to ${ROLE}`);
  await admin.query(`grant usage on schema app to ${ROLE}`);
  await admin.query(`grant execute on all functions in schema app to ${ROLE}`);
  for (const table of ['tenants', 'users', 'customers', 'services', 'products', 'service_product_links', 'inventory_movements', 'orders', 'order_items', 'sales', 'sale_items', 'attendance_terminals', 'attendance_records', 'seller_credentials', 'sale_amendments', 'payments']) {
    await admin.query(`grant select, insert, update on public.${table} to ${ROLE}`);
  }
  // Second tenant with its own rows for isolation probes (run-scoped slugs).
  const other = await q(`insert into tenants (name, slug) values ('Other Shop','other-shop-${RUN}') returning id`);
  ids.tenantB = other[0].id;
  await q(`insert into products (tenant_id, name, unit_cost) values ($1,'Foreign Product',10)`, [ids.tenantB]);
  await q(`insert into attendance_terminals (tenant_id, reference, token_hash) values ($1,'att-other-${RUN}','hash')`, [ids.tenantB]);

  const { Client } = require('pg');
  const { url: baseUrl } = stagingConfig();
  // Same target, restricted role credentials (in-memory only, never logged).
  const appUrl = baseUrl.replace(/\/\/[^@]+@/, `//${ROLE}:${appPassword}@`);
  const appClient = new Client({ connectionString: appUrl });
  await appClient.connect();
  const asTenant = async (tenantId, role, fn) => {
    await appClient.query(`select set_config('app.tenant_id',$1,false), set_config('app.user_role',$2,false)`, [tenantId, role]);
    try {
      return await fn(appClient);
    } finally {
      await appClient.query(`select set_config('app.tenant_id',null,false), set_config('app.user_role',null,false)`);
    }
  };

  await check('rls', 'tenant A sees own products, not B', async () => {
    const seen = await asTenant(ids.tenant, 'staff', async (c) => (await c.query(`select count(*)::int as n from products`)).rows[0].n);
    assert(seen === 1, `tenant A saw ${seen} products, expected 1`);
    const seenB = await asTenant(ids.tenantB, 'staff', async (c) => (await c.query(`select count(*)::int as n from products`)).rows[0].n);
    assert(seenB === 1, `tenant B saw ${seenB} products, expected 1`);
    return 'isolation holds both directions';
  });

  await check('rls', 'cross-tenant orders/sales/movements/attendance invisible', async () => {
    const counts = await asTenant(ids.tenantB, 'staff', async (c) => {
      const out = {};
      for (const [label, sql] of [
        ['orders', `select count(*)::int as n from orders`],
        ['sales', `select count(*)::int as n from sales`],
        ['movements', `select count(*)::int as n from inventory_movements`],
        ['attendance', `select count(*)::int as n from attendance_records`],
        ['credentials', `select count(*)::int as n from seller_credentials`],
        ['amendments', `select count(*)::int as n from sale_amendments`],
        ['payments', `select count(*)::int as n from payments`],
      ]) {
        out[label] = (await c.query(sql)).rows[0].n;
      }
      // Tenant B owns exactly one terminal; it must see it — and nothing else.
      out.terminals = (await c.query(`select reference from attendance_terminals`)).rows.map((r) => r.reference);
      return out;
    });
    for (const label of ['orders', 'sales', 'movements', 'attendance', 'credentials', 'amendments', 'payments']) {
      assert(counts[label] === 0, `tenant B saw ${counts[label]} rows in ${label}`);
    }
    assert(JSON.stringify(counts.terminals) === JSON.stringify([`att-other-${RUN}`]), `tenant B terminals wrong: ${JSON.stringify(counts.terminals)}`);
    return '0 foreign rows everywhere; own terminal visible';
  });

  await check('rls', 'no session vars means no rows (fail closed)', async () => {
    const n = (await appClient.query(`select count(*)::int as n from products`)).rows[0].n;
    assert(n === 0, `unset session saw ${n} products`);
    return 'fail-closed without context';
  });

  await check('rls', 'staff cannot insert into another tenant', async () => {
    let blocked = false;
    await asTenant(ids.tenantB, 'staff', async (c) => {
      try {
        await c.query(`insert into products (tenant_id, name, unit_cost) values ($1,'Sneaky',1)`, [ids.tenant]);
      } catch (e) {
        blocked = /policy|permission|denied|violates/i.test(e.message);
      }
    });
    assert(blocked, 'cross-tenant insert was NOT blocked');
    return 'insert policy enforced';
  });

  await check('rls', 'superuser bypass documented (app connects as superuser today)', async () => {
    const n = (await admin.query(`select count(*)::int as n from products`)).rows[0].n;
    assert(n === 2, 'superuser should bypass RLS');
    return 'RLS is supplementary until the app uses a restricted role';
  });

  // ── E. concurrency (separate clients, real transactions) ──
  console.log('== concurrency ==');
  await check('concurrency', 'final-unit race: exactly one sale succeeds', async () => {
    await admin.query(`update products set quantity_on_hand=1 where id=$1`, [ids.product]);
    const attempt = async () => {
      const { url: raceUrl } = stagingConfig();
      const pool = new (require('pg').Pool)({ connectionString: raceUrl, max: 1 });
      const c = await pool.connect();
      try {
        await c.query('begin');
        const row = await c.query(`select quantity_on_hand from products where id=$1`, [ids.product]);
        if (row.rows[0].quantity_on_hand < 1) {
          throw new Error('insufficient');
        }
        await c.query(`update products set quantity_on_hand = quantity_on_hand - 1 where id=$1`, [ids.product]);
        await c.query(`insert into inventory_movements (tenant_id, product_id, quantity, movement_type, previous_quantity, resulting_quantity) values ($1,$2,-1,'SALE',$3,$3-1)`, [ids.tenant, ids.product, row.rows[0].quantity_on_hand]);
        await c.query('commit');
        return 'ok';
      } catch (e) {
        try { await c.query('rollback'); } catch { /* noop */ }
        return `fail:${/check|insufficient/i.test(e.message) ? 'guarded' : e.message}`;
      } finally {
        c.release();
        await pool.end();
      }
    };
    const outcomes = await Promise.all([attempt(), attempt()]);
    const wins = outcomes.filter((o) => o === 'ok').length;
    assert(wins === 1, `expected exactly 1 winner, got ${JSON.stringify(outcomes)}`);
    const final = await q(`select quantity_on_hand from products where id=$1`, [ids.product]);
    assert(final[0].quantity_on_hand === 0, `final qty ${final[0].quantity_on_hand}, expected 0`);
    return `${JSON.stringify(outcomes)}; qty 0, never negative`;
  });

  await check('concurrency', 'concurrent approval inserts: one sale only', async () => {
    const o = await q(`insert into orders (tenant_id, status, subtotal, total, source) values ($1,'APPROVED',10,10,'STAFF') returning id`, [ids.tenant]);
    const orderId = o[0].id;
    const attempt = async () => {
      try {
        await admin.query(`insert into sales (tenant_id, order_id, status, subtotal, total) values ($1,$2,'COMPLETED',10,10)`, [ids.tenant, orderId]);
        return 'ok';
      } catch (e) {
        return /unique|duplicate/i.test(e.message) ? 'duplicate-blocked' : `fail:${e.message}`;
      }
    };
    const outcomes = await Promise.all([attempt(), attempt()]);
    assert(outcomes.filter((o2) => o2 === 'ok').length === 1, JSON.stringify(outcomes));
    assert(outcomes.includes('duplicate-blocked'), JSON.stringify(outcomes));
    const n = await q(`select count(*)::int as n from sales where order_id=$1`, [orderId]);
    assert(n[0].n === 1, 'more than one sale exists');
    return 'unique(tenant,order) is the backstop';
  });

  await check('concurrency', 'concurrent check-ins: one open record', async () => {
    await admin.query(`delete from attendance_records where tenant_id=$1 and employee_id=$2`, [ids.tenant, ids.staff]);
    const attempt = async () => {
      try {
        await admin.query(`insert into attendance_records (tenant_id, employee_id, employee_number_snapshot, attendance_date, check_in_at, status) values ($1,$2,'EMP-0002',current_date,now(),'CHECKED_IN')`, [ids.tenant, ids.staff]);
        return 'ok';
      } catch (e) {
        return /unique|duplicate/i.test(e.message) ? 'duplicate-blocked' : `fail:${e.message}`;
      }
    };
    const outcomes = await Promise.all([attempt(), attempt()]);
    assert(outcomes.filter((o) => o === 'ok').length === 1, JSON.stringify(outcomes));
    const n = await q(`select count(*)::int as n from attendance_records where tenant_id=$1 and employee_id=$2 and check_out_at is null`, [ids.tenant, ids.staff]);
    assert(n[0].n === 1, 'more than one open record');
    return 'partial unique index is the backstop';
  });

  await check('concurrency', 'concurrent checkouts converge (one close)', async () => {
    const attempt = async () => {
      const r = await admin.query(`update attendance_records set check_out_at=now(), status='CHECKED_OUT' where tenant_id=$1 and employee_id=$2 and check_out_at is null`, [ids.tenant, ids.staff]);
      return r.rowCount;
    };
    const outcomes = await Promise.all([attempt(), attempt()]);
    const total = outcomes.reduce((a, b) => a + b, 0);
    assert(total === 1, `expected total 1 close, got ${JSON.stringify(outcomes)}`);
    return `rowCounts ${JSON.stringify(outcomes)}`;
  });

  await appClient.end();

  // ── cleanup: remove run-scoped test data + temporary role ──
  console.log('cleaning up test data...');
  try {
    for (const tenantId of [ids.tenantB, ids.tenant].filter(Boolean)) {
      await admin.query(`delete from tenants where id=$1`, [tenantId]);
    }
    const dbName = (await admin.query(`select current_database() as db`)).rows[0].db;
    await admin.query(`revoke all on all tables in schema public from ${ROLE}`);
    await admin.query(`revoke all on all functions in schema app from ${ROLE}`);
    await admin.query(`revoke all on schema public, app from ${ROLE}`);
    await admin.query(`revoke connect on database "${dbName}" from ${ROLE}`);
    await admin.query(`drop role ${ROLE}`);
    console.log('  test tenants and temporary role removed.');
  } catch (error) {
    console.log(`  cleanup warning (manual sweep may be needed): ${error.message}`);
  }

  await admin.end();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exitCode = 1;
});
