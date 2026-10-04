import pg from "pg";
import { config } from "./config.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 15_000,
  // `authenticator` has no direct grants on public.* — every table is granted
  // to `authenticated`. Assume that role on each new connection.
  ...(config.dbRole
    ? {
        onConnect: async (client) => {
          await client.query(`SET ROLE ${JSON.stringify(config.dbRole)}`);
        },
      }
    : {}),
});

// An idle pooled connection can die underneath us (the Neon pooler closes
// idle TLS sockets). pg-pool then does `pool.emit('error', err, client)` — and
// because EventEmitter treats an `error` event with no listener as fatal, the
// whole process dies. By the time this fires pg-pool has already closed and
// removed the client, so the only job here is to log it: the next query opens
// a fresh connection. In-flight queries reject on their own and are unaffected.
pool.on("error", (err, client) => {
  const where = client?.processID ? `pid ${client.processID}` : "idle client";
  console.error(`[db] connection lost (${where}): ${err.code || err.message} — pool recovered`);
});

export const query = (text, params) => pool.query(text, params);

/** Run a function inside a transaction with automatic rollback on error. */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool() {
  await pool.end();
}

// ── Introspection helpers ────────────────────────────────────────

export async function connectionInfo() {
  const [{ rows: pgv }] = await Promise.all([
    query(
      "select version() as version, current_database() as db, current_user as user, inet_server_addr()::text as addr"
    ),
  ]);
  const { rows: settings } = await query(
    `select name, setting from pg_settings
     where name in ('server_version','TimeZone','client_encoding','default_transaction_isolation')
     order by name`
  );
  return { ...pgv[0], settings };
}

export async function listSchemas() {
  const { rows } = await query(
    `select nspname as schema, pg_catalog.pg_get_userbyid(nspowner) as owner
     from pg_namespace
     where nspname not like 'pg\\_%' and nspname <> 'information_schema'
     order by nspname`
  );
  return rows;
}

export async function listTables(schema = "public") {
  const { rows } = await query(
    `select c.relname as table,
            case c.relkind when 'r' then 'table' when 'v' then 'view'
                            when 'm' then 'materialized view' when 'p' then 'partitioned table'
                            else c.relkind::text end as type,
            pg_catalog.obj_description(c.oid, 'pg_class') as comment
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = $1 and c.relkind in ('r','v','m','p')
     order by c.relname`,
    [schema]
  );
  return rows;
}

export async function describeTable(name, schema = "public") {
  const { rows: columns } = await query(
    `select a.attname as column,
            pg_catalog.format_type(a.atttypid, a.atttypmod) as type,
            a.attnotnull as not_null,
            coalesce(
              (select pg_get_expr(d.adbin, d.adrelid) from pg_attrdef d
               where d.adrelid = a.attrelid and d.adnum = a.attnum),
              ''
            ) as default,
            a.attidentity <> '' as has_identity,
            exists (
              select 1 from pg_constraint pk
              where pk.conrelid = a.attrelid and pk.contype = 'p'
                and a.attnum = any (pk.conkey)
            ) as primary_key,
            exists (
              select 1 from pg_constraint c
              where c.conrelid = a.attrelid and c.contype in ('f','u')
                and a.attnum = any (c.conkey)
            ) as constrained
     from pg_attribute a
     where a.attrelid = $1::regclass and a.attnum > 0 and not a.attisdropped
     order by a.attnum`,
    [`${schema}.${name}`]
  );

  const { rows: constraints } = await query(
    `select con.conname as name,
            pg_catalog.pg_get_constraintdef(con.oid) as definition
     from pg_constraint con
     where con.conrelid = $1::regclass
     order by con.contype, con.conname`,
    [`${schema}.${name}`]
  );

  const { rows: indexes } = await query(
    `select i.relname as index, ix.indisunique as unique, ix.indisprimary as primary_key,
            pg_catalog.pg_get_indexdef(ix.indexrelid) as definition
     from pg_index ix
     join pg_class i on i.oid = ix.indexrelid
     where ix.indrelid = $1::regclass
     order by i.relname`,
    [`${schema}.${name}`]
  );

  return { columns, constraints, indexes };
}

// ── CLI ──────────────────────────────────────────────────────────
const isMain = process.argv[1]?.endsWith("db.js");
if (isMain) {
  const [, , cmd, ...args] = process.argv;
  try {
    if (cmd === "info") {
      const info = await connectionInfo();
      console.log(info);
      console.log("\nschemas:", (await listSchemas()).map((s) => s.schema).join(", "));
    } else if (cmd === "tables") {
      const schema = args[0] || "public";
      const tables = await listTables(schema);
      if (!tables.length) {
        console.log(`[tables] schema "${schema}" is empty.`);
      } else {
        for (const t of tables)
          console.log(`[tables] ${t.type.padEnd(18)} ${t.table}${t.comment ? `  — ${t.comment}` : ""}`);
      }
    } else if (cmd === "describe") {
      const d = await describeTable(args[0], args[1] || "public");
      console.log("columns:");
      for (const c of d.columns)
        console.log(
          `  ${c.column.padEnd(24)} ${c.type}` +
            `${c.primary_key ? " [PK]" : ""}` +
            `${c.not_null && !c.primary_key ? " not null" : ""}` +
            `${c.has_identity ? " identity" : ""}` +
            `${c.default ? ` default ${c.default}` : ""}`
        );
      console.log("constraints:");
      for (const c of d.constraints) console.log(`  ${c.name}: ${c.definition}`);
      console.log("indexes:");
      for (const i of d.indexes)
        console.log(`  ${i.index}${i.primary_key ? " [PK]" : i.unique ? " [UNIQUE]" : ""}`);
    } else if (cmd === "query") {
      const sql = args.join(" ") || "select 1 as ok";
      const r = await query(sql);
      console.table(r.rows);
      console.log(`(${r.rowCount} row${r.rowCount === 1 ? "" : "s"})`);
    } else {
      console.log("usage: db.js <info|tables|describe|query> [args...]");
    }
    await closePool();
    process.exit(0);
  } catch (e) {
    console.error(`[db:${cmd}] FAILED:`, e.message);
    try { await closePool(); } catch {}
    process.exit(1);
  }
}
