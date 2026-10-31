import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const PRESIGN_TTL_SECONDS = 300;

/** Product-image storage. Browsers upload directly with a short-lived presigned URL. */
export interface ImageStorage {
  presignUpload(input: {
    key: string;
    contentType: string;
    contentLength: number;
  }): Promise<string>;
  publicUrl(key: string): string;
}

export type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  cdnBaseUrl: string;
};

/** Cloudflare R2 through its S3-compatible API. */
export function createR2Storage(config: R2Config): ImageStorage {
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
  const base = config.cdnBaseUrl.replace(/\/$/, "");
  return {
    async presignUpload({ key, contentType, contentLength }) {
      // ContentType and ContentLength are signed, so the browser can't upload something else.
      const command = new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        ContentType: contentType,
        ContentLength: contentLength,
      });
      return getSignedUrl(client, command, { expiresIn: PRESIGN_TTL_SECONDS });
    },
    publicUrl: (key) => `${base}/${key}`,
  };
}

/** Local development without R2: URLs point at a placeholder host; nothing is stored. */
export function createFakeStorage(baseUrl: string): ImageStorage {
  const base = baseUrl.replace(/\/$/, "");
  return {
    async presignUpload({ key }) {
      return `${base}/fake-upload/${key}`;
    },
    publicUrl: (key) => `${base}/${key}`,
  };
}
