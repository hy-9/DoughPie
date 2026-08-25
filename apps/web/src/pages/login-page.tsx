import { loginBodySchema } from "@doughpie/shared";
import { COPY } from "@doughpie/shared";
import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { api } from "../lib/api";
import { errorMessage } from "../lib/api-error";
import { UC_ENABLED } from "../lib/env";
import { fieldIssueMessage } from "../lib/form-errors";
import { useAuthStore } from "../stores/auth";

/**
 * 登录页（/login）：本地账密 + 「使用统一认证登录」（VITE_UC_ENABLED=true 才显示）。
 * 校验用 shared zod schema（与后端同源），错误文案中文（form-errors 翻译）。
 */
export function LoginPage() {
  const login = useAuthStore((s) => s.login);
  const status = useAuthStore((s) => s.status);
  const navigate = useNavigate();
  const location = useLocation();
  // 守卫跳转带来的回跳目标（登录后回到原页面）
  const from = (location.state as { from?: string } | null)?.from ?? "/";

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ username?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [ssoLoading, setSsoLoading] = useState(false);

  if (status === "authed") return <Navigate to={from} replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const parsed = loginBodySchema.safeParse({ username, password });
    if (!parsed.success) {
      setErrors({
        username: fieldIssueMessage(parsed.error.issues, "username", "用户名") ?? undefined,
        password: fieldIssueMessage(parsed.error.issues, "password", "密码") ?? undefined,
      });
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      await login(parsed.data);
      navigate(from, { replace: true });
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  /** SSO 起跳：服务端返回 authorize_url（state/code_verifier 服务端暂存），整页跳转 */
  const startSso = async () => {
    setSsoLoading(true);
    try {
      const { authorize_url } = await api.auth.ssoStart("login");
      window.location.href = authorize_url;
    } catch {
      toast.error(COPY.auth.ucUnavailable);
      setSsoLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6">
        <h1 className="text-xl font-semibold">登录豆排排</h1>
        <p className="mt-1 text-xs text-muted-foreground">多人协作待办工具</p>
        <form onSubmit={(e) => void onSubmit(e)} className="mt-5 space-y-3" noValidate>
          <div className="space-y-1">
            <label htmlFor="login-username" className="text-xs text-muted-foreground">
              用户名
            </label>
            <Input
              id="login-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
            />
            {errors.username ? (
              <p role="alert" className="text-xs text-destructive">
                {errors.username}
              </p>
            ) : null}
          </div>
          <div className="space-y-1">
            <label htmlFor="login-password" className="text-xs text-muted-foreground">
              密码
            </label>
            <Input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
            {errors.password ? (
              <p role="alert" className="text-xs text-destructive">
                {errors.password}
              </p>
            ) : null}
          </div>
          {formError ? (
            <p role="alert" className="text-xs text-destructive">
              {formError}
            </p>
          ) : null}
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? "登录中…" : "登录"}
          </Button>
        </form>

        {UC_ENABLED ? (
          <>
            <div className="my-4 flex items-center gap-2 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" /> 或{" "}
              <span className="h-px flex-1 bg-border" />
            </div>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => void startSso()}
              disabled={ssoLoading}
            >
              {ssoLoading ? "跳转中…" : "使用统一认证登录"}
            </Button>
          </>
        ) : null}

        <p className="mt-4 text-center text-xs text-muted-foreground">
          没有账号？{" "}
          <Link to="/register" className="text-primary hover:underline">
            注册
          </Link>
        </p>
      </div>
    </div>
  );
}
