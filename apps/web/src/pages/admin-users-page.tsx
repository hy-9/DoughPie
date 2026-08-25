import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { INSTANCE_ROLES, type InstanceRole, type User } from "@doughpie/shared";
import { Check, Copy, KeyRound } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "../components/ui/dialog";
import { Select } from "../components/ui/select";
import { Skeleton } from "../components/ui/skeleton";
import { UserAvatar } from "../components/user-avatar";
import { api } from "../lib/api";
import { errorMessage } from "../lib/api-error";
import { useAuthStore } from "../stores/auth";

/** 账号来源（backend.md §2.8 展示口径）：本地 | UC | 本地+UC（混合账号） */
function sourceText(u: User): string {
  if (u.has_password && u.has_uc_identity) return "本地+UC";
  if (u.has_uc_identity) return "UC";
  return "本地";
}

const ROLE_TEXT: Record<InstanceRole, string> = { admin: "管理员", user: "成员" };

/**
 * 实例管理（/admin/users，P0-16，backend.md §2.8）：仅实例 admin 可见/可达（服务端 403 兜底）。
 * 用户列表 + 禁用/启用（禁用即吊销其全部会话）+ 重置密码（一次性临时密码弹窗）+
 * 角色切换（末位 admin 保护，409 LAST_ADMIN 提示）。
 * 不对自己操作：禁用/降级自己会立即踢掉当前会话，无意义且危险。
 */
export function AdminUsersPage() {
  const me = useAuthStore((s) => s.user);
  const qc = useQueryClient();
  const [resetTarget, setResetTarget] = useState<User | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  const usersQuery = useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => api.admin.listUsers(),
    enabled: me?.role === "admin",
  });

  const invalidate = () => void qc.invalidateQueries({ queryKey: ["admin", "users"] });

  const updateUser = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: { status?: "active" | "disabled"; role?: InstanceRole };
    }) => api.admin.updateUser(id, body),
    onSuccess: invalidate,
    // LAST_ADMIN 等 409 文案由 errorMessage 映射（COPY.admin.lastAdmin）
    onError: (err) => toast.error(errorMessage(err)),
  });

  const resetPassword = useMutation({
    mutationFn: (id: string) => api.admin.resetPassword(id),
    onSuccess: (result) => {
      // 临时密码只在此弹窗展示一次（服务端不落明文）
      setTempPassword(result.temp_password);
    },
    onError: (err) => {
      setResetTarget(null);
      toast.error(errorMessage(err));
    },
  });

  // 非 admin 直达 URL：入口已在顶栏隐藏，这里再给明确拒绝态
  if (me && me.role !== "admin") {
    return (
      <div className="py-12 text-center">
        <p className="text-lg font-semibold">没有权限</p>
        <p className="mt-1 text-[13px] text-muted-foreground">实例管理仅对管理员开放</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <div className="flex items-center gap-2">
        <h1 className="text-lg font-semibold">实例管理 · 用户</h1>
        {usersQuery.data ? (
          <span className="tnum text-xs text-muted-foreground">{usersQuery.data.length} 人</span>
        ) : null}
      </div>

      {usersQuery.isLoading ? (
        <div className="space-y-1">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : usersQuery.isError ? (
        <div className="py-12 text-center">
          <p className="text-[13px] text-muted-foreground">{errorMessage(usersQuery.error)}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => void usersQuery.refetch()}
          >
            重试
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card">
          <div className="grid h-8 grid-cols-[minmax(0,1fr)_72px_84px_96px_220px] items-center gap-2 border-b border-border px-3 text-xs text-muted-foreground">
            <span>用户</span>
            <span>状态</span>
            <span>来源</span>
            <span>角色</span>
            <span>操作</span>
          </div>
          <ul className="divide-y divide-border">
            {(usersQuery.data ?? []).map((u) => {
              const isSelf = u.id === me?.id;
              return (
                <li
                  key={u.id}
                  className="grid grid-cols-[minmax(0,1fr)_72px_84px_96px_220px] items-center gap-2 px-3 py-2"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <UserAvatar username={u.username} displayName={u.display_name} size="sm" />
                    <span className="min-w-0 truncate text-[13px]">
                      {u.display_name}
                      <span className="ml-1 text-xs text-muted-foreground">@{u.username}</span>
                      {isSelf ? (
                        <span className="ml-1 text-xs text-muted-foreground">（我）</span>
                      ) : null}
                    </span>
                  </span>
                  <span>
                    {u.status === "active" ? (
                      <Badge variant="state-done">正常</Badge>
                    ) : (
                      <Badge variant="state-review">已禁用</Badge>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">{sourceText(u)}</span>
                  <span>
                    {isSelf ? (
                      <Badge variant="state-doing">{ROLE_TEXT[u.role]}</Badge>
                    ) : (
                      <Select
                        value={u.role}
                        aria-label={`用户 ${u.display_name} 的角色`}
                        className="h-7 w-20 text-xs"
                        disabled={updateUser.isPending}
                        onChange={(e) =>
                          updateUser.mutate({
                            id: u.id,
                            body: { role: e.target.value as InstanceRole },
                          })
                        }
                      >
                        {INSTANCE_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_TEXT[r]}
                          </option>
                        ))}
                      </Select>
                    )}
                  </span>
                  <span className="flex items-center gap-1">
                    {isSelf ? (
                      <span className="text-xs text-muted-foreground">不能对自己操作</span>
                    ) : (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          disabled={updateUser.isPending}
                          onClick={() =>
                            updateUser.mutate({
                              id: u.id,
                              body: { status: u.status === "active" ? "disabled" : "active" },
                            })
                          }
                        >
                          {u.status === "active" ? "禁用" : "启用"}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => setResetTarget(u)}
                        >
                          <KeyRound className="h-3 w-3" /> 重置密码
                        </Button>
                      </>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* 重置密码：先确认 → 展示一次性临时密码（可复制） */}
      <Dialog
        open={!!resetTarget}
        onOpenChange={(open) => {
          if (!open) {
            setResetTarget(null);
            setTempPassword(null);
            resetPassword.reset();
          }
        }}
      >
        <DialogContent>
          <DialogTitle>重置密码</DialogTitle>
          {tempPassword === null ? (
            <>
              <p className="mt-2 text-[13px] text-muted-foreground">
                确定为「{resetTarget?.display_name}」重置密码吗？其全部登录会话将立即失效。
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <Button variant="outline" onClick={() => setResetTarget(null)}>
                  取消
                </Button>
                <Button
                  variant="destructive"
                  disabled={resetPassword.isPending}
                  onClick={() => resetTarget && resetPassword.mutate(resetTarget.id)}
                >
                  {resetPassword.isPending ? "重置中…" : "重置"}
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="mt-2 text-[13px] text-muted-foreground">
                已重置「{resetTarget?.display_name}」的密码。临时密码仅显示这一次，请复制后转交：
              </p>
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2">
                <code className="tnum flex-1 select-all break-all text-[13px]">{tempPassword}</code>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 shrink-0 text-xs"
                  onClick={() => {
                    if (navigator.clipboard) {
                      navigator.clipboard
                        .writeText(tempPassword)
                        .then(() => toast.success("已复制"))
                        .catch(() => toast(tempPassword));
                    } else {
                      toast(tempPassword);
                    }
                  }}
                >
                  <Copy className="h-3 w-3" /> 复制
                </Button>
              </div>
              <div className="mt-4 flex justify-end">
                <Button
                  variant="outline"
                  onClick={() => {
                    setResetTarget(null);
                    setTempPassword(null);
                    resetPassword.reset();
                  }}
                >
                  <Check className="h-3.5 w-3.5" /> 完成
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
