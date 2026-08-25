import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { updateWorkspaceBodySchema, type Invite, type Member } from "@doughpie/shared";
import { Copy, Link2, LogOut, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Select } from "../components/ui/select";
import { Skeleton } from "../components/ui/skeleton";
import { UserAvatar } from "../components/user-avatar";
import { useMembers } from "../hooks/use-members";
import { api } from "../lib/api";
import { errorMessage } from "../lib/api-error";
import { formatDate } from "../lib/datetime";
import { fieldIssueMessage } from "../lib/form-errors";
import { WORKSPACE_ROLE_TEXT } from "../lib/labels";
import { useAuthStore } from "../stores/auth";
import { useUiStore } from "../stores/ui";

/**
 * 工作区设置（/ws/:id/settings，P0-2/P0-5）：
 * 成员列表（owner 可调角色 member↔viewer / 移除）+ 邀请链接管理（创建 member/viewer、列表、作废、复制链接）
 * + 工作区重命名（owner）+ 退出工作区（非 owner）。
 * 权限降级与服务端矩阵对齐（permission.ts）：viewer 只读；member 可建/看邀请；管理动作 owner 独有。
 */
export function WorkspaceSettingsPage() {
  const { id } = useParams<{ id: string }>();
  const me = useAuthStore((s) => s.user);

  const workspaceQuery = useQuery({
    queryKey: ["workspaces", id],
    queryFn: () => api.workspaces.get(id as string),
    enabled: !!id,
  });
  const { data: members, isLoading: membersLoading } = useMembers(id);
  const myRole = members?.find((m) => m.user_id === me?.id)?.role ?? null;

  if (workspaceQuery.isLoading || membersLoading) {
    return (
      <div className="mx-auto max-w-2xl space-y-6 p-4">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (workspaceQuery.isError || !workspaceQuery.data) {
    return (
      <div className="py-12 text-center">
        <p className="text-[13px] text-muted-foreground">{errorMessage(workspaceQuery.error)}</p>
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => void workspaceQuery.refetch()}
        >
          重试
        </Button>
      </div>
    );
  }

  const workspace = workspaceQuery.data;
  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4">
      <h1 className="text-lg font-semibold">工作区设置</h1>
      <RenameSection
        workspaceId={workspace.id}
        name={workspace.name}
        canEdit={myRole === "owner"}
      />
      <MembersSection workspaceId={workspace.id} members={members ?? []} myRole={myRole} />
      {myRole === "owner" || myRole === "member" ? (
        <InvitesSection workspaceId={workspace.id} canRevoke={myRole === "owner"} />
      ) : null}
      {myRole !== null && myRole !== "owner" ? (
        <LeaveSection workspaceId={workspace.id} workspaceName={workspace.name} />
      ) : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="text-[15px] font-medium">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** 工作区重命名（owner 独有，workspace.update） */
function RenameSection({
  workspaceId,
  name,
  canEdit,
}: {
  workspaceId: string;
  name: string;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | null>(null);

  const rename = useMutation({
    mutationFn: (n: string) => api.workspaces.update(workspaceId, { name: n }),
    onSuccess: (ws) => {
      // 列表（顶栏切换器）与详情两块缓存都要失效
      void qc.invalidateQueries({ queryKey: ["workspaces"] });
      qc.setQueryData(["workspaces", workspaceId], ws);
      toast.success("工作区已重命名");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = updateWorkspaceBodySchema.safeParse({ name: value.trim() });
    if (!parsed.success) {
      setError(fieldIssueMessage(parsed.error.issues, "name", "工作区名称"));
      return;
    }
    if (parsed.data.name !== name) rename.mutate(parsed.data.name);
  };

  return (
    <Section title="工作区名称">
      <form onSubmit={submit} className="flex items-end gap-2" noValidate>
        <div className="flex-1 space-y-1">
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            maxLength={50}
            disabled={!canEdit}
            aria-label="工作区名称"
          />
          {error ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </div>
        {canEdit ? (
          <Button type="submit" disabled={rename.isPending || value.trim() === name}>
            保存
          </Button>
        ) : null}
      </form>
      {!canEdit ? (
        <p className="mt-2 text-xs text-muted-foreground">仅所有者可修改工作区名称</p>
      ) : null}
    </Section>
  );
}

/** 成员列表：角色下拉（owner 操作 member↔viewer；owner 本人不可改）+ 移除（owner） */
function MembersSection({
  workspaceId,
  members,
  myRole,
}: {
  workspaceId: string;
  members: Member[];
  myRole: "owner" | "member" | "viewer" | null;
}) {
  const me = useAuthStore((s) => s.user);
  const qc = useQueryClient();
  const [removing, setRemoving] = useState<Member | null>(null);
  const isOwner = myRole === "owner";

  const invalidate = () => void qc.invalidateQueries({ queryKey: ["members", workspaceId] });

  const changeRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: "member" | "viewer" }) =>
      api.workspaces.updateMemberRole(workspaceId, userId, { role }),
    onSuccess: invalidate,
    onError: (err) => toast.error(errorMessage(err)),
  });

  const remove = useMutation({
    mutationFn: (userId: string) => api.workspaces.removeMember(workspaceId, userId),
    onSuccess: () => {
      invalidate();
      setRemoving(null);
      toast.success("成员已移除");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <Section title={`成员（${members.length}）`}>
      <ul className="divide-y divide-border">
        {members.map((m) => (
          <li key={m.user_id} className="flex items-center gap-2 py-2">
            <UserAvatar username={m.username} displayName={m.display_name} />
            <span className="min-w-0 flex-1 truncate text-[13px]">
              {m.display_name}
              <span className="ml-1 text-xs text-muted-foreground">@{m.username}</span>
              {m.user_id === me?.id ? (
                <span className="ml-1 text-xs text-muted-foreground">（我）</span>
              ) : null}
            </span>
            <span className="tnum hidden text-xs text-muted-foreground sm:inline">
              {formatDate(m.joined_at)} 加入
            </span>
            {isOwner && m.role !== "owner" ? (
              <Select
                value={m.role}
                aria-label={`成员 ${m.display_name} 的角色`}
                className="h-7 w-24 text-xs"
                disabled={changeRole.isPending}
                onChange={(e) =>
                  changeRole.mutate({
                    userId: m.user_id,
                    role: e.target.value as "member" | "viewer",
                  })
                }
              >
                <option value="member">{WORKSPACE_ROLE_TEXT.member}</option>
                <option value="viewer">{WORKSPACE_ROLE_TEXT.viewer}</option>
              </Select>
            ) : (
              <Badge variant={m.role === "owner" ? "state-doing" : "default"}>
                {WORKSPACE_ROLE_TEXT[m.role]}
              </Badge>
            )}
            {isOwner && m.role !== "owner" ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                aria-label={`移除成员 ${m.display_name}`}
                onClick={() => setRemoving(m)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            ) : null}
          </li>
        ))}
      </ul>

      <Dialog open={!!removing} onOpenChange={(open) => !open && setRemoving(null)}>
        <DialogContent>
          <DialogTitle>移除成员</DialogTitle>
          <p className="mt-2 text-[13px] text-muted-foreground">
            确定把「{removing?.display_name}」移出工作区吗？其负责的任务将变为未分配。
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setRemoving(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => removing && remove.mutate(removing.user_id)}
            >
              移除
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Section>
  );
}

/** 复制邀请链接（/invite/:code 落地页）；剪贴板不可用时降级提示手动复制 */
function copyInviteLink(invite: Invite) {
  const url = `${window.location.origin}/invite/${invite.code}`;
  if (navigator.clipboard) {
    navigator.clipboard
      .writeText(url)
      .then(() => toast.success("链接已复制"))
      .catch(() => toast(url));
  } else {
    toast(url);
  }
}

/** 邀请链接管理：创建 member/viewer（owner+member）、列表、作废（owner）、复制链接 */
function InvitesSection({ workspaceId, canRevoke }: { workspaceId: string; canRevoke: boolean }) {
  const qc = useQueryClient();
  const [role, setRole] = useState<"member" | "viewer">("member");

  const invitesQuery = useQuery({
    queryKey: ["invites", workspaceId],
    queryFn: () => api.workspaces.listInvites(workspaceId),
  });

  const invalidate = () => void qc.invalidateQueries({ queryKey: ["invites", workspaceId] });

  const create = useMutation({
    mutationFn: () => api.workspaces.createInvite(workspaceId, { role }),
    onSuccess: (invite) => {
      invalidate();
      copyInviteLink(invite);
      toast.success("邀请链接已创建并复制");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const revoke = useMutation({
    mutationFn: (inviteId: string) => api.workspaces.revokeInvite(workspaceId, inviteId),
    onSuccess: () => {
      invalidate();
      toast.success("邀请链接已作废");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const invites = invitesQuery.data ?? [];

  return (
    <Section title="邀请链接">
      <div className="flex items-center gap-2">
        <Select
          value={role}
          onChange={(e) => setRole(e.target.value as "member" | "viewer")}
          aria-label="邀请角色"
          className="h-7 w-28 text-xs"
        >
          <option value="member">{WORKSPACE_ROLE_TEXT.member}</option>
          <option value="viewer">{WORKSPACE_ROLE_TEXT.viewer}</option>
        </Select>
        <Button size="sm" onClick={() => create.mutate()} disabled={create.isPending}>
          <Link2 className="h-3.5 w-3.5" /> 创建邀请链接
        </Button>
        <span className="text-xs text-muted-foreground">7 天有效</span>
      </div>

      {invitesQuery.isLoading ? (
        <Skeleton className="mt-3 h-16 w-full" />
      ) : invites.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">暂无有效邀请链接</p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {invites.map((inv) => {
            const expired = new Date(inv.expires_at).getTime() < Date.now();
            return (
              <li key={inv.id} className="flex items-center gap-2 py-2">
                <Badge variant="default">{WORKSPACE_ROLE_TEXT[inv.role]}</Badge>
                <span className="tnum min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {expired ? "已过期" : `${formatDate(inv.expires_at)} 过期`} · {inv.code}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  aria-label="复制邀请链接"
                  disabled={expired}
                  onClick={() => copyInviteLink(inv)}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
                {canRevoke ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-muted-foreground hover:text-destructive"
                    disabled={revoke.isPending}
                    onClick={() => revoke.mutate(inv.id)}
                  >
                    作废
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

/** 退出工作区（非 owner；唯一 owner 退出服务端 409 LAST_OWNER） */
function LeaveSection({
  workspaceId,
  workspaceName,
}: {
  workspaceId: string;
  workspaceName: string;
}) {
  const me = useAuthStore((s) => s.user);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const currentWorkspaceId = useUiStore((s) => s.currentWorkspaceId);
  const setCurrentWorkspace = useUiStore((s) => s.setCurrentWorkspace);
  const [confirming, setConfirming] = useState(false);

  const leave = useMutation({
    mutationFn: () => api.workspaces.removeMember(workspaceId, me?.id as string),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["workspaces"] });
      // 退出的是当前工作区时清掉持久化选择，由 useCurrentWorkspace 兜底到下一个
      if (currentWorkspaceId === workspaceId) {
        const rest = (qc.getQueryData(["workspaces"]) as { id: string }[] | undefined)?.filter(
          (w) => w.id !== workspaceId,
        );
        if (rest?.[0]) setCurrentWorkspace(rest[0].id);
      }
      toast.success(`已退出「${workspaceName}」`);
      navigate("/", { replace: true });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <Section title="危险操作">
      <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
        <LogOut className="h-3.5 w-3.5" /> 退出工作区
      </Button>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogTitle>退出工作区</DialogTitle>
          <p className="mt-2 text-[13px] text-muted-foreground">
            确定退出「{workspaceName}」吗？退出后需重新被邀请才能加入。
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirming(false)}>
              取消
            </Button>
            <Button variant="destructive" disabled={leave.isPending} onClick={() => leave.mutate()}>
              退出
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Section>
  );
}
