import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@doughpie/api-client";
import { COPY, type Comment, type Member } from "@doughpie/shared";
import { CornerDownRight, Pencil, Trash2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/api-error";
import { formatRelative } from "../../lib/datetime";
import { useAuthStore } from "../../stores/auth";
import { UserAvatar } from "../user-avatar";
import { Button } from "../ui/button";
import { Textarea } from "../ui/input";
import { Skeleton } from "../ui/skeleton";
import { CommentComposer } from "./comment-composer";
import { MentionChips } from "./mention-chips";
import { TaskStatusBadge } from "./task-status-badge";

/** 评论正文的 @提及 高亮（username 字符集与契约 usernameSchema 对齐） */
function renderContent(content: string): ReactNode {
  const parts = content.split(/(@[A-Za-z0-9_一-龥.-]+)/g);
  return parts.map((p, i) =>
    p.startsWith("@") ? (
      <span key={i} className="font-medium text-primary">
        {p}
      </span>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

/**
 * 讨论区（P0-17 基础版）：时间线 + 一级回复 + @提及 + 提及确认 chips + 发表时状态徽章。
 * 服务端按时间升序游标分页；回复扁平返回（parent_id），前端按父折叠渲染。
 */
export function CommentSection({
  taskId,
  members,
  canWrite,
}: {
  taskId: string;
  members: Member[];
  canWrite: boolean;
}) {
  const me = useAuthStore((s) => s.user);
  const [remindingUserId, setRemindingUserId] = useState<string | null>(null);

  const commentsQuery = useInfiniteQuery({
    queryKey: ["comments", taskId],
    queryFn: ({ pageParam }) =>
      api.comments.list(taskId, { cursor: pageParam || undefined, limit: 50 }),
    initialPageParam: "",
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });

  const items = commentsQuery.data?.pages.flatMap((p) => p.items) ?? [];
  const topLevel = items.filter((c) => c.parent_id === null);
  const repliesOf = (id: string) => items.filter((c) => c.parent_id === id);

  // 通知深链锚定评论：#comment-<id> 滚到对应楼层（web.md §4 通知中心深链）
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.length > 1 && items.length > 0) {
      document.getElementById(hash.slice(1))?.scrollIntoView({ block: "center" });
    }
  }, [items.length]);

  /** 「再提醒」（提及发起者 → 未确认提及，24h 节流；429 节流提示） */
  const remind = useMutation({
    mutationFn: (userId: string) => api.notifications.remindMention(taskId, userId),
    onMutate: (userId) => setRemindingUserId(userId),
    onSuccess: () => toast.success(COPY.mention.remindSent),
    onError: (err) => {
      if (err instanceof ApiError && err.status === 429) toast.error(COPY.mention.remindThrottled);
      else toast.error(errorMessage(err));
    },
    onSettled: () => setRemindingUserId(null),
  });

  if (commentsQuery.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {commentsQuery.hasNextPage ? (
        <Button
          variant="ghost"
          size="sm"
          className="w-full text-xs"
          disabled={commentsQuery.isFetchingNextPage}
          onClick={() => void commentsQuery.fetchNextPage()}
        >
          {commentsQuery.isFetchingNextPage ? "加载中…" : "加载更早的评论"}
        </Button>
      ) : null}

      {topLevel.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted-foreground">还没有评论</p>
      ) : null}

      {topLevel.map((c) => (
        <CommentItem
          key={c.id}
          comment={c}
          replies={repliesOf(c.id)}
          taskId={taskId}
          members={members}
          canWrite={canWrite}
          meId={me?.id ?? null}
          remindingUserId={remindingUserId}
          onRemind={(userId) => remind.mutate(userId)}
        />
      ))}

      {canWrite ? (
        <CommentComposer taskId={taskId} members={members} />
      ) : (
        <p className="text-xs text-muted-foreground">观察者角色仅可查看讨论</p>
      )}
    </div>
  );
}

function CommentItem({
  comment: c,
  replies,
  taskId,
  members,
  canWrite,
  meId,
  remindingUserId,
  onRemind,
  isReply,
}: {
  comment: Comment;
  replies: Comment[];
  taskId: string;
  members: Member[];
  canWrite: boolean;
  meId: string | null;
  remindingUserId: string | null;
  onRemind: (userId: string) => void;
  isReply?: boolean;
}) {
  const qc = useQueryClient();
  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(c.content);
  const isMine = meId === c.author_id;

  const update = useMutation({
    mutationFn: (text: string) => api.comments.update(c.id, { content: text }),
    onSuccess: () => {
      setEditing(false);
      void qc.invalidateQueries({ queryKey: ["comments", taskId] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const remove = useMutation({
    mutationFn: () => api.comments.remove(c.id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["comments", taskId] }),
    onError: (err) => toast.error(errorMessage(err)),
  });

  // 删除留 tombstone（PLAN.md §8）：内容已由服务端置空，展示「已删除」
  if (c.deleted) {
    return (
      <div
        id={`comment-${c.id}`}
        className={isReply ? "ml-8 border-l border-border pl-3" : undefined}
      >
        <p className="py-1 text-xs italic text-muted-foreground">该评论已删除</p>
        {replies.map((r) => (
          <CommentItem
            key={r.id}
            comment={r}
            replies={[]}
            taskId={taskId}
            members={members}
            canWrite={canWrite}
            meId={meId}
            remindingUserId={remindingUserId}
            onRemind={onRemind}
            isReply
          />
        ))}
      </div>
    );
  }

  return (
    <div
      id={`comment-${c.id}`}
      className={isReply ? "ml-8 border-l border-border pl-3" : undefined}
    >
      <div className="flex items-center gap-2">
        <UserAvatar username={c.author_username} displayName={c.author_display_name} size="sm" />
        <span className="text-[13px] font-medium">{c.author_display_name}</span>
        <span className="tnum text-xs text-muted-foreground">{formatRelative(c.created_at)}</span>
        {/* 每条评论记录发表时的任务状态（§6.1，永久沉淀） */}
        <TaskStatusBadge status={c.state_at_comment} />
        {c.edited_at ? <span className="text-xs text-muted-foreground">（已编辑）</span> : null}
        {isMine || canWrite ? (
          <span className="ml-auto flex gap-1">
            {canWrite && !isReply ? (
              <button
                type="button"
                className="flex h-6 items-center gap-1 rounded px-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => setReplying((v) => !v)}
                aria-label="回复"
              >
                <CornerDownRight className="h-3 w-3" /> 回复
              </button>
            ) : null}
            {isMine ? (
              <>
                <button
                  type="button"
                  className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => {
                    setEditing(true);
                    setEditContent(c.content);
                  }}
                  aria-label="编辑评论"
                >
                  <Pencil className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => remove.mutate()}
                  aria-label="删除评论"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </>
            ) : null}
          </span>
        ) : null}
      </div>

      {editing ? (
        <div className="mt-1.5 space-y-2">
          <Textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            maxLength={5000}
            aria-label="编辑评论内容"
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditing(false)}>
              取消
            </Button>
            <Button
              size="sm"
              disabled={update.isPending || editContent.trim().length === 0}
              onClick={() => update.mutate(editContent.trim())}
            >
              保存
            </Button>
          </div>
        </div>
      ) : (
        <p className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-6">
          {renderContent(c.content)}
        </p>
      )}

      {/* 提及确认闭环 chips；发起者（评论作者）可再提醒 */}
      <MentionChips
        mentions={c.mentions}
        canRemind={isMine}
        remindingUserId={remindingUserId}
        onRemind={onRemind}
      />

      {replying ? (
        <div className="mt-2">
          <CommentComposer
            taskId={taskId}
            members={members}
            parentId={c.id}
            autoFocus
            placeholder={`回复 ${c.author_display_name}…`}
            onDone={() => setReplying(false)}
          />
        </div>
      ) : null}

      {replies.map((r) => (
        <CommentItem
          key={r.id}
          comment={r}
          replies={[]}
          taskId={taskId}
          members={members}
          canWrite={canWrite}
          meId={meId}
          remindingUserId={remindingUserId}
          onRemind={onRemind}
          isReply
        />
      ))}
    </div>
  );
}
