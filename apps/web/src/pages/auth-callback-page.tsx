import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { api } from "../lib/api";
import { errorMessage } from "../lib/api-error";
import { Skeleton } from "../components/ui/skeleton";
import { useAuthStore } from "../stores/auth";

/**
 * SSO 回跳（/auth/callback）：取 code/state → ssoExchange 三态分发（backend.md §2.4）：
 * tokens → 进首页；pending（未绑定）→ 跳 /auth/link 选择页；bound（绑定模式完成）→ 回设置页。
 */
export function AuthCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const loginWithTokens = useAuthStore((s) => s.loginWithTokens);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    if (!code || !state) {
      setError("登录回跳参数缺失，请重新发起登录");
      return;
    }
    let cancelled = false;
    api.auth
      .ssoExchange({ code, state })
      .then(async (result) => {
        if (cancelled) return;
        if (result.kind === "tokens") {
          await loginWithTokens(result.tokens);
          navigate("/", { replace: true });
        } else if (result.kind === "pending") {
          // pending 票据 5 分钟一次性；走 query 传递，刷新可恢复
          const p = result.pending;
          navigate(
            `/auth/link?pending_token=${encodeURIComponent(p.pending_token)}&suggested_username=${encodeURIComponent(p.suggested_username)}`,
            { replace: true },
          );
        } else {
          toast.success("统一认证绑定成功");
          navigate("/settings", { replace: true });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [searchParams, navigate, loginWithTokens]);

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background p-4">
        <p className="text-lg font-semibold">登录失败</p>
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
        <Link to="/login" className="text-[13px] text-primary hover:underline">
          返回登录
        </Link>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-3" data-testid="sso-exchange-loading">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-full" />
        <p className="text-xs text-muted-foreground">正在完成统一认证登录…</p>
      </div>
    </div>
  );
}
