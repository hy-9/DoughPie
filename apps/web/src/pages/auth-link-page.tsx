import { COPY, ssoLinkBodySchema, ssoRegisterBodySchema } from "@doughpie/shared";
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { api } from "../lib/api";
import { errorMessage } from "../lib/api-error";
import { fieldIssueMessage } from "../lib/form-errors";
import { useAuthStore } from "../stores/auth";

/**
 * SSO 首登选择页（/auth/link，backend.md §2.4）：
 * pending_sso 票据（5 分钟一次性）→ 关联已有账号（ssoLink）或创建新账号（ssoRegister）。
 * 两个通道成功都直接发令牌对，落地即登录。
 */
export function AuthLinkPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const loginWithTokens = useAuthStore((s) => s.loginWithTokens);
  const pendingToken = searchParams.get("pending_token");
  const suggestedUsername = searchParams.get("suggested_username") ?? "";

  const [linkUsername, setLinkUsername] = useState("");
  const [linkPassword, setLinkPassword] = useState("");
  const [newUsername, setNewUsername] = useState(suggestedUsername);
  const [newDisplayName, setNewDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!pendingToken) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background p-4">
        <p role="alert" className="text-[13px] text-destructive">
          {COPY.auth.pendingSsoExpired}
        </p>
        <Link to="/login" className="text-[13px] text-primary hover:underline">
          返回登录
        </Link>
      </div>
    );
  }

  /** 关联已有账号：账密校验通过后绑定 UC 身份 */
  const submitLink = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = ssoLinkBodySchema.safeParse({
      pending_token: pendingToken,
      username: linkUsername,
      password: linkPassword,
    });
    if (!parsed.success) {
      setError(
        fieldIssueMessage(parsed.error.issues, "username", "用户名") ??
          fieldIssueMessage(parsed.error.issues, "password", "密码") ??
          COPY.common.validationFailed,
      );
      return;
    }
    setSubmitting(true);
    try {
      await loginWithTokens(await api.auth.ssoLink(parsed.data));
      navigate("/", { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  /** 创建新账号：预填 UC username（可改），昵称选填 */
  const submitRegister = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = ssoRegisterBodySchema.safeParse({
      pending_token: pendingToken,
      username: newUsername,
      display_name: newDisplayName.trim() || undefined,
    });
    if (!parsed.success) {
      setError(
        fieldIssueMessage(parsed.error.issues, "username", "用户名") ??
          fieldIssueMessage(parsed.error.issues, "display_name", "昵称") ??
          COPY.common.validationFailed,
      );
      return;
    }
    setSubmitting(true);
    try {
      await loginWithTokens(await api.auth.ssoRegister(parsed.data));
      navigate("/", { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-6">
        <h1 className="text-xl font-semibold">关联统一认证账号</h1>
        <p className="mt-1 text-xs text-muted-foreground">{COPY.auth.ssoLinkPrompt}</p>
        {error ? (
          <p role="alert" className="mt-3 text-xs text-destructive">
            {error}
          </p>
        ) : null}

        <div className="mt-5 grid gap-6 sm:grid-cols-2">
          <form onSubmit={(e) => void submitLink(e)} className="space-y-3" noValidate>
            <h2 className="text-[15px] font-medium">关联已有账号</h2>
            <Input
              value={linkUsername}
              onChange={(e) => setLinkUsername(e.target.value)}
              placeholder="用户名"
              aria-label="已有账号用户名"
              autoComplete="username"
            />
            <Input
              type="password"
              value={linkPassword}
              onChange={(e) => setLinkPassword(e.target.value)}
              placeholder="密码"
              aria-label="已有账号密码"
              autoComplete="current-password"
            />
            <Button type="submit" className="w-full" disabled={submitting}>
              关联并登录
            </Button>
          </form>

          <form onSubmit={(e) => void submitRegister(e)} className="space-y-3" noValidate>
            <h2 className="text-[15px] font-medium">创建新账号</h2>
            <Input
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              placeholder="用户名"
              aria-label="新账号用户名"
              autoComplete="username"
            />
            <Input
              value={newDisplayName}
              onChange={(e) => setNewDisplayName(e.target.value)}
              placeholder="昵称（选填）"
              aria-label="新账号昵称"
            />
            <Button type="submit" variant="outline" className="w-full" disabled={submitting}>
              创建并登录
            </Button>
          </form>
        </div>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          <Link to="/login" className="text-primary hover:underline">
            返回登录
          </Link>
        </p>
      </div>
    </div>
  );
}
