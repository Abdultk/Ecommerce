import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

function keyFrom(hexKey: string): Buffer {
  const key = Buffer.from(hexKey, "hex");
  if (key.length !== KEY_BYTES)
    throw new Error("Encryption key must be 32 bytes (64 hex characters)");
  return key;
}

/** AES-256-GCM. Output: base64url(iv | tag | ciphertext). Tampering is detected on decrypt. */
export function encrypt(plaintext: string, hexKey: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, keyFrom(hexKey), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url");
}

export function decrypt(payload: string, hexKey: string): string {
  const raw = Buffer.from(payload, "base64url");
  if (raw.length <= IV_BYTES + TAG_BYTES) throw new Error("Encrypted payload is too short");
  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, keyFrom(hexKey), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)),
    decipher.final(),
  ]).toString("utf8");
}

/** 256-bit URL-safe random token for cookies and email links. */
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString("base64url");

/** Tokens are stored only as hashes; a pepper keeps a leaked table useless on its own. */
export const hashToken = (token: string, pepper = ""): string =>
  createHash("sha256")
    .update(token + pepper)
    .digest("hex");

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
