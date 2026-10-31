import { createHmac } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { safeEqual } from "./crypto";

/** Download links are short-lived: fetch the job again for a fresh one. */
export const DOWNLOAD_TTL_SECONDS = 300;

/** Server-generated keys only: "reports/<id>-<random>.<csv|xlsx>". Anything else is refused. */
export const REPORT_FILE_PATTERN = /^[a-z0-9]{8,40}-[0-9a-f]{32}\.(csv|xlsx)$/;
const SAFE_DOWNLOAD_NAME = /^[A-Za-z0-9._-]{1,120}$/;

export type SignedLink = { url: string; expiresAt: Date };

/** Private storage for report exports. Never the public image bucket. */
export interface ReportStorage {
  readonly kind: "r2" | "local";
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** Removes a stored report; a missing file is not an error. */
  delete(key: string): Promise<void>;
  /** A short-lived link that downloads the file as `filename`. */
  downloadUrl(key: string, filename: string): Promise<SignedLink>;
}

const fileOf = (key: string) => key.replace(/^reports\//, "");

export type R2ReportConfig = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
};

/** Cloudflare R2 (S3 API): presigned GET with a forced attachment filename. */
export function createR2ReportStorage(config: R2ReportConfig): ReportStorage {
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
  return {
    kind: "r2",
    async put(key, body, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
    },
    async downloadUrl(key, filename) {
      const command = new GetObjectCommand({
        Bucket: config.bucket,
        Key: key,
        ResponseContentDisposition: `attachment; filename="${filename}"`,
        ResponseCacheControl: "no-store",
      });
      const url = await getSignedUrl(client, command, { expiresIn: DOWNLOAD_TTL_SECONDS });
      return { url, expiresAt: new Date(Date.now() + DOWNLOAD_TTL_SECONDS * 1000) };
    },
  };
}

export type LocalReportStorage = ReportStorage & {
  kind: "local";
  /** Verifies a signed link and returns the file, or null when the link is invalid or expired. */
  open(
    file: string,
    query: { name?: unknown; expires?: unknown; sig?: unknown },
  ): Promise<{
    body: Buffer;
    filename: string;
  } | null>;
};

/**
 * Local development and tests: files go to a directory and are served by the API at
 * /api/v1/report-files/<file> behind an HMAC signature over (file, name, expiry). The key is
 * derived from a server secret with its own label. Refused in production by env validation.
 */
export function createLocalReportStorage(options: {
  dir: string;
  publicBaseUrl: string;
  secret: string;
  now?: () => number;
}): LocalReportStorage {
  const now = options.now ?? Date.now;
  const key = createHmac("sha256", options.secret).update("report-download:v1").digest();
  const sign = (file: string, name: string, expires: number) =>
    createHmac("sha256", key).update(`${file}\n${name}\n${expires}`).digest("hex");
  const base = options.publicBaseUrl.replace(/\/$/, "");

  return {
    kind: "local",
    async put(storageKey, body) {
      const file = fileOf(storageKey);
      if (!REPORT_FILE_PATTERN.test(file)) throw new Error("Refusing an unexpected report key");
      await mkdir(options.dir, { recursive: true });
      await writeFile(path.join(options.dir, file), body);
    },
    async delete(storageKey) {
      const file = fileOf(storageKey);
      if (!REPORT_FILE_PATTERN.test(file)) throw new Error("Refusing an unexpected report key");
      await rm(path.join(options.dir, file), { force: true });
    },
    async downloadUrl(storageKey, filename) {
      const file = fileOf(storageKey);
      const expires = Math.floor(now() / 1000) + DOWNLOAD_TTL_SECONDS;
      const query = new URLSearchParams({
        name: filename,
        expires: String(expires),
        sig: sign(file, filename, expires),
      });
      return {
        url: `${base}/api/v1/report-files/${file}?${query.toString()}`,
        expiresAt: new Date(expires * 1000),
      };
    },
    async open(file, query) {
      const { name, expires, sig } = query;
      if (typeof name !== "string" || typeof expires !== "string" || typeof sig !== "string") {
        return null;
      }
      if (!REPORT_FILE_PATTERN.test(file) || !SAFE_DOWNLOAD_NAME.test(name)) return null;
      const expiry = Number(expires);
      if (!Number.isInteger(expiry) || expiry * 1000 < now()) return null;
      if (!safeEqual(sig, sign(file, name, expiry))) return null;
      try {
        return { body: await readFile(path.join(options.dir, file)), filename: name };
      } catch {
        return null;
      }
    },
  };
}

export const isLocalReportStorage = (s: ReportStorage): s is LocalReportStorage =>
  s.kind === "local" && typeof (s as Partial<LocalReportStorage>).open === "function";
