/**
 * @提及候选提取（PLAN.md §5.5/§10）。
 * 契约正则：/@([A-Za-z0-9_.\-一-龥]+)/g —— 与 usernameSchema 的字符集对齐。
 * 本模块只做提取 + 去重保序；成员身份校验在 service 层（非成员/不存在 → 纯文本不成提及）。
 */
const MENTION_RE = /@([A-Za-z0-9_.\-一-龥]+)/g;

/** 从评论内容提取 @提及的 username 候选集（去重、按出现顺序） */
export function extractMentionNames(content: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const match of content.matchAll(MENTION_RE)) {
    const name = match[1];
    if (name === undefined || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}
