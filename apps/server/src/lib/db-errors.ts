/**
 * PG 唯一约束冲突（23505）判定。
 * drizzle 会把驱动错误包成 DrizzleQueryError，需沿 cause 链找 PostgresError。
 */
export function isUniqueViolation(err: unknown): boolean {
  let cur: unknown = err;
  while (typeof cur === "object" && cur !== null) {
    if ("code" in cur && cur.code === "23505") return true;
    cur = "cause" in cur ? cur.cause : null;
  }
  return false;
}
