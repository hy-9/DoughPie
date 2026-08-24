import type { User } from "@doughpie/shared";
import type { UserRow } from "../models/schema.js";

/** UserRow → 对外 User DTO（不含 password_hash；时间统一 ISO 字符串） */
export function toUserDto(row: UserRow, hasUcIdentity: boolean): User {
  return {
    id: row.id,
    username: row.username,
    display_name: row.displayName,
    status: row.status,
    role: row.role,
    has_uc_identity: hasUcIdentity,
    has_password: row.passwordHash !== null,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}
