import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@doughpie/api-client";
import { COPY } from "@doughpie/shared";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "../components/ui/button";
import { Skeleton } from "../components/ui/skeleton";
import { api } from "../lib/api";
import { errorMessage } from "../lib/api-error";
import { formatDateTime } from "../lib/datetime";
import { WORKSPACE_ROLE_TEXT } from "../lib/labels";
import { useUiStore } from "../stores/ui";

/**
 * 邀请落地页（/invite/:code，P0-2）：预览（工作区名/角色/有效期）+ 接受。
 * 需登录（路由守卫包住）；失效/过期/已是成员有独立错误态。
 */
export function InvitePage() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const setCurrentWorkspace = useUiStore((s) => s.setCurrentWorkspace);

  const infoQuery = useQuery({
    queryKey: ["invite", code],
    queryFn: () => api.workspaces.inviteInfo(code as string),
    enabled: !!code,
    // 无效邀请不应重试打满接口
    retry: false,
  });

  const accept = useMutation({
    mutationFn: () => api.workspaces.acceptInvite({ code: code as string }),
    onSuccess: (ws) => {
      void qc.invalidateQueries({ queryKey: ["workspaces"] });
      setCurrentWorkspace(ws.id);
      toast.success(`已加入「${ws.name}」`);
      navigate("/", { replace: true });
    },
    onError: (err) => {
      // 已是成员不算失败：直接带进该工作区
      if (err instanceof ApiError && err.code === "ALREADY_MEMBER" && infoQuery.data) {
        toast(COPY.workspace.alreadyMember);
        setCurrentWorkspace(infoQuery.data.workspace_id);
        navigate("/", { replace: true });
        return;
      }
      toast.error(errorMessage(err));
    },
  });

  const info = infoQuery.data;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6">
        {infoQuery.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-7 w-40" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : infoQuery.isError || !info ? (
          <div className="space-y-3 text-center">
            <p className="text-lg font-semibold">无法加入</p>
            <p role="alert" className="text-[13px] text-destructive">
              {errorMessage(infoQuery.error)}
            </p>
            <Link to="/" className="inline-block text-[13px] text-primary hover:underline">
              回到首页
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <p className="text-xs text-muted-foreground">邀请你加入工作区</p>
              <h1 className="mt-1 text-xl font-semibold">{info.workspace_name}</h1>
            </div>
            <dl className="space-y-1 text-[13px]">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">加入角色</dt>
                <dd>{WORKSPACE_ROLE_TEXT[info.role]}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">链接有效期至</dt>
                <dd className="tnum">{formatDateTime(info.expires_at)}</dd>
              </div>
            </dl>
            <div className="flex gap-2">
              <Button
                className="flex-1"
                disabled={accept.isPending}
                onClick={() => accept.mutate()}
              >
                {accept.isPending ? "加入中…" : "接受邀请"}
              </Button>
              <Button variant="outline" onClick={() => navigate("/")}>
                取消
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
