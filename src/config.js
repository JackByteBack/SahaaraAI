import "dotenv/config";

/** Fail fast with a clear message instead of a cryptic SDK error later. */
function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name} (see .env.example)`);
  return v;
}

export const config = {
  databaseUrl: required("DATABASE_URL"),
  /**
   * Role to assume after connecting. In this project `authenticator` holds no
   * direct table grants — it is only the PostgREST login role. All `public`
   * table grants belong to `authenticated`, so we SET ROLE into it on connect.
   * Set DB_ROLE="" to skip.
   */
  dbRole: process.env.DB_ROLE ?? "authenticated",

  s3: {
    endpoint: required("AWS_ENDPOINT_URL_S3"),
    region: process.env.AWS_REGION || "us-east-2",
    accessKeyId: required("AWS_ACCESS_KEY_ID"),
    secretAccessKey: required("AWS_SECRET_ACCESS_KEY"),
    bucket: process.env.S3_BUCKET || "assets",
    // Neon Object Storage is path-style, not virtual-host-style.
    forcePathStyle: true,
  },

  auth: {
    issuerUrl: process.env.NEON_AUTH_URL || null,
    jwksUrl: process.env.NEON_AUTH_JWKS_URL || null,
  },

  restUrl: process.env.NEON_REST_URL || null,
};
