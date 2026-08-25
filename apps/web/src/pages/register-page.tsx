import { COPY, registerBodySchema } from "@doughpie/shared";
import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { api } from "../lib/api";
import { errorMessage } from "../lib/api-error";
import { UC_ENABLED } from "../lib/env";
import { fieldIssueMessage } from "../lib/form-errors";
import { useAuthStore } from "../stores/auth";

/**
 * 注册页（/register）：本地账密注册（注册即登录，服务端直接发令牌对）。
 * 密码规则 ≥8 位且含字母+数字（shared passwordSchema，与 UC 一致）。
 */
export function RegisterPage() {
  const register = useAuthStore((s) => s.register);
  const status = useAuthStore((s) => s.status);
  const navigate = useNavigate();

  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<{
    username?: string;
    display_name?: string;
    password?: string;
    confirm?: string;
  }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [ssoLoading, setSsoLoading] = useState(false);

  if (status === "authed") return <Navigate to="/" replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const body = {
      username,
      password,
      display_name: displayName.trim() || undefined,
    };
    const parsed = registerBodySchema.safeParse(body);
    const next: typeof errors = {};
    if (!parsed.success) {
      next.username = fieldIssueMessage(parsed.error.issues, "username", "用户名") ?? undefined;
      next.display_name =
        fieldIssueMessage(parsed.error.issues, "display_name", "昵称") ?? undefined;
      next.password = fieldIssueMessage(parsed.error.issues, "password", "密码") ?? undefined;
    }
    // 二次确认是纯前端校验（契约不含 confirm 字段）
    if (confirm !== password) next.confirm = "两次输入的密码不一致";
    if (Object.values(next).some((v) => v !== undefined)) {
      setErrors(next);
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      await register(parsed.success ? parsed.data : body);
      toast.success(COPY.auth.registerSuccess);
      navigate("/", { replace: true });
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

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
        <h1 className="text-xl font-semibold">注册豆排排</h1>
        <form onSubmit={(e) => void onSubmit(e)} className="mt-5 space-y-3" noValidate>
          <div className="space-y-1">
            <label htmlFor="reg-username" className="text-xs text-muted-foreground">
              用户名
            </label>
            <Input
              id="reg-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              placeholder="字母、数字、中文、._-"
            />
            {errors.username ? (
              <p role="alert" className="text-xs text-destructive">
                {errors.username}
              </p>
            ) : null}
          </div>
          <div className="space-y-1">
            <label htmlFor="reg-display-name" className="text-xs text-muted-foreground">
              昵称（选填）
            </label>
            <Input
              id="reg-display-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="默认与用户名一致"
            />
            {errors.display_name ? (
              <p role="alert" className="text-xs text-destructive">
                {errors.display_name}
              </p>
            ) : null}
          </div>
          <div className="space-y-1">
            <label htmlFor="reg-password" className="text-xs text-muted-foreground">
              密码
            </label>
            <Input
              id="reg-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              placeholder={COPY.auth.passwordRule}
            />
            {errors.password ? (
              <p role="alert" className="text-xs text-destructive">
                {errors.password}
              </p>
            ) : null}
          </div>
          <div className="space-y-1">
            <label htmlFor="reg-confirm" className="text-xs text-muted-foreground">
              确认密码
            </label>
            <Input
              id="reg-confirm"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
            />
            {errors.confirm ? (
              <p role="alert" className="text-xs text-destructive">
                {errors.confirm}
              </p>
            ) : null}
          </div>
          {formError ? (
            <p role="alert" className="text-xs text-destructive">
              {formError}
            </p>
          ) : null}
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? "注册中…" : "注册"}
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
          已有账号？{" "}
          <Link to="/login" className="text-primary hover:underline">
            登录
          </Link>
        </p>
      </div>
    </div>
  );
}
