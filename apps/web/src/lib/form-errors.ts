/**
 * 表单校验错误文案：把 shared zod schema 的 issue 翻成中文。
 * web 端不直接依赖 zod 包（pnpm 严格隔离），这里只消费 issue 的最小结构面；
 * schema 自带的中文自定义消息（如「密码需同时包含字母和数字」）原样透传。
 */

export interface ZodIssueLike {
  code: string;
  message: string;
  path?: readonly PropertyKey[];
  minimum?: unknown;
  maximum?: unknown;
}

/** 取某字段首个错误的中文消息；无错误返回 null */
export function fieldIssueMessage(
  issues: readonly ZodIssueLike[],
  field: string,
  fieldLabel: string,
): string | null {
  const issue = issues.find((i) => i.path?.[0] === field);
  return issue ? issueMessage(issue, fieldLabel) : null;
}

/** 单条 issue → 中文文案：默认英文消息按 code 翻译，自定义消息透传 */
export function issueMessage(issue: ZodIssueLike, fieldLabel: string): string {
  switch (issue.code) {
    case "invalid_type":
      return `请填写${fieldLabel}`;
    case "too_small":
      // 字符串 min(1) 即「必填」语义；其余按最小长度提示
      return issue.minimum === 1
        ? `请输入${fieldLabel}`
        : `${fieldLabel}至少 ${String(issue.minimum)} 个字符`;
    case "too_big":
      return `${fieldLabel}最多 ${String(issue.maximum)} 个字符`;
    default:
      return issue.message;
  }
}
