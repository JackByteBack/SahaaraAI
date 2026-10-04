import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "./config.js";

/** S3-compatible client pointed at Neon Object Storage. */
export const s3 = new S3Client({
  region: config.s3.region,
  endpoint: config.s3.endpoint,
  forcePathStyle: config.s3.forcePathStyle,
  credentials: {
    accessKeyId: config.s3.accessKeyId,
    secretAccessKey: config.s3.secretAccessKey,
  },
});

const BUCKET = config.s3.bucket;

/** Upload an object. Returns the key it was written to. */
export async function upload({ key, body, contentType = "application/octet-stream" }) {
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
  return key;
}

/** Presigned GET URL (default 1 hour). */
export async function getSignedGetUrl(key, expiresIn = 3600) {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), {
    expiresIn,
  });
}

/** Presigned PUT URL — lets a browser upload directly without our server. */
export async function getSignedPutUrl(key, expiresIn = 3600, contentType) {
  return getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ...(contentType ? { ContentType: contentType } : {}),
    }),
    { expiresIn }
  );
}

export async function headObject(key) {
  return s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
}

export async function listObjects(prefix = "") {
  const res = await s3.send(
    new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix })
  );
  return res.Contents ?? [];
}

export async function deleteObject(key) {
  return s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

// ── CLI ──────────────────────────────────────────────────────────
const isMain = process.argv[1]?.endsWith("s3.js");
if (isMain) {
  const [, , cmd, ...args] = process.argv;
  try {
    if (cmd === "upload") {
      const key = args[0] || `uploads/${Date.now()}-file.txt`;
      const body = args[1] || "Hello World!";
      await upload({ key, body, contentType: "text/plain" });
      console.log(`[upload] ok -> ${key} (bucket: ${BUCKET})`);
      console.log(`[view]   ${await getSignedGetUrl(key)}`);
    } else if (cmd === "get") {
      const key = args[0];
      if (!key) throw new Error("usage: npm run s3:get -- <key>");
      console.log(`[view] ${await getSignedGetUrl(key)}`);
    } else if (cmd === "list") {
      const items = await listObjects(args[0] || "");
      if (!items.length) console.log("[list] (empty)");
      for (const o of items)
        console.log(`[list] ${o.Key}  ${o.Size}B  ${o.LastModified}`);
    } else if (cmd === "head") {
      console.log(await headObject(args[0]));
    } else if (cmd === "rm") {
      await deleteObject(args[0]);
      console.log(`[rm] ${args[0]}`);
    } else {
      console.log("usage: s3.js <upload|get|list|head|rm> [args...]");
    }
    process.exit(0);
  } catch (e) {
    console.error(`[s3:${cmd}] FAILED:`, e.name, e.message);
    if (e.$metadata) console.error("  httpStatusCode:", e.$metadata.httpStatusCode);
    process.exit(1);
  }
}
