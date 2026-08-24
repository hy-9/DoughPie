import { v7 as uuidv7 } from "uuid";
import { hash } from "@node-rs/argon2";
import type { InstanceRole, UserStatus } from "@doughpie/shared";
import type { Db } from "../src/db.js";
import { userIdentities, users, type UserRow } from "../src/models/schema.js";

/** 测试数据工厂（conventions.md §5.2）：禁止共享可变 fixture，每个用例现建。 */

let seq = 0;

export async function insertUser(
  db: Db,
  overrides?: {
    username?: string;
    password?: string;
    displayName?: string;
    status?: UserStatus;
    role?: InstanceRole;
  },
): Promise<UserRow> {
  seq += 1;
  const username = overrides?.username ?? `user_${seq}`;
  const [row] = await db
    .insert(users)
    .values({
      id: uuidv7(),
      username,
      passwordHash: overrides?.password ? await hash(overrides.password) : null,
      displayName: overrides?.displayName ?? username,
      status: overrides?.status ?? "active",
      role: overrides?.role ?? "user",
    })
    .returning();
  if (!row) throw new Error("insertUser 失败");
  return row;
}

export async function insertUcIdentity(
  db: Db,
  userId: string,
  providerUserId: string,
): Promise<void> {
  await db.insert(userIdentities).values({
    id: uuidv7(),
    userId,
    provider: "uc",
    providerUserId,
  });
}
