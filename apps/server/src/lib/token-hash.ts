import { createHash } from "node:crypto";

/** refresh token 落库前的 SHA-256 哈希（明文永不入库，泄露不可还原） */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
