import { config } from "./config.js";
import { upload, getSignedGetUrl, listObjects } from "./s3.js";
import { connectionInfo, listSchemas, listTables, closePool } from "./db.js";

const results = { s3: null, db: null };

// ── 1. S3-compatible storage ─────────────────────────────────────
async function checkS3() {
  const key = `uploads/healthcheck-${Date.now()}.txt`;
  await upload({ key, body: "Hello World!", contentType: "text/plain" });
  const url = await getSignedGetUrl(key, 3600);
  const objects = await listObjects("uploads/");
  return { bucket: config.s3.bucket, key, url, uploadsCount: objects.length };
}

// ── 2. Neon Postgres ─────────────────────────────────────────────
async function checkDb() {
  const info = await connectionInfo();
  const schemas = await listSchemas();
  const tables = await listTables("public");
  return { info, schemas: schemas.map((s) => s.schema), tables };
}

const ok = (v) => (v ? "✓" : "✗");

try {
  results.s3 = await checkS3();
  console.log("── S3 (Neon Object Storage) ──────────────────────────");
  console.log(` ${ok(true)} bucket      ${results.s3.bucket}`);
  console.log(` ${ok(true)} uploaded    ${results.s3.key}`);
  console.log(` ${ok(true)} objects     ${results.s3.uploadsCount} in uploads/`);
  console.log(` [view] ${results.s3.url}`);
} catch (e) {
  console.log("── S3 (Neon Object Storage) ──────────────────────────");
  console.log(` ${ok(false)} ${e.name}: ${e.message}`);
}

console.log("");

try {
  results.db = await checkDb();
  console.log("── Neon Postgres ─────────────────────────────────────");
  console.log(` ${ok(true)} database    ${results.db.info.db}`);
  console.log(` ${ok(true)} user        ${results.db.info.user}`);
  console.log(` ${ok(true)} server      ${results.db.info.version.split(",")[0]}`);
  console.log(` ${ok(true)} schemas     ${results.db.schemas.join(", ")}`);
  console.log(
    ` ${results.db.tables.length ? ok(true) : "–"} tables      ${
      results.db.tables.length
        ? results.db.tables.map((t) => t.table).join(", ")
        : "none yet (public schema is empty)"
    }`
  );
} catch (e) {
  console.log("── Neon Postgres ─────────────────────────────────────");
  console.log(` ${ok(false)} ${e.message}`);
}

await closePool();

const allOk = results.s3 && results.db;
console.log("");
console.log(allOk ? "✅ Both integrations healthy." : "⚠️  One or more integrations failed.");
process.exit(allOk ? 0 : 1);
