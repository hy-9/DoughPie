import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Member } from "@doughpie/shared";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/api-error";
import { UserAvatar } from "../user-avatar";
import { Button } from "../ui/button";
import { Textarea } from "../ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "../ui/popover";

/**
 * 评论输入框（P0-17）：@ 输入弹成员选择器（同搜昵称/username，PLAN.md §8）。
 * 提及由服务端从正文 @username 解析（comment-service），前端只负责把 @username 正确插进文本。
 * Ctrl/⌘+Enter 发送。
 */
export function CommentComposer({
  taskId,
  members,
  parentId,
  autoFocus,
  placeholder,
  onDone,
}: {
  taskId: string;
  members: Member[];
  /** 一级回复的父评论 id（服务端拒绝二级嵌套） */
  parentId?: string;
  autoFocus?: boolean;
  placeholder?: string;
  onDone?: () => void;
}) {
  const [content, setContent] = useState("");
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const qc = useQueryClient();

  const create = useMutation({
    mutationFn: (text: string) =>
      api.comments.create(
        taskId,
        parentId ? { content: text, parent_id: parentId } : { content: text },
      ),
    onSuccess: () => {
      setContent("");
      void qc.invalidateQueries({ queryKey: ["comments", taskId] });
      onDone?.();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  // 光标前最近文本以 @xxx（无空白）结尾 → 弹选择器并以其为过滤词
  const detectMention = (value: string, caret: number) => {
    const match = /(?:^|\s)@([^\s@]{0,32})$/.exec(value.slice(0, caret));
    if (match) {
      setMentionQuery(match[1] ?? "");
      setMentionOpen(true);
    } else {
      setMentionOpen(false);
    }
  };

  const filtered = members
    .filter(
      (m) =>
        mentionQuery === "" ||
        m.username.toLowerCase().includes(mentionQuery.toLowerCase()) ||
        m.display_name.toLowerCase().includes(mentionQuery.toLowerCase()),
    )
    .slice(0, 8);

  /** 选中成员：把光标前的 @片段 替换为 @username + 空格（服务端按 username 解析提及） */
  const pick = (m: Member) => {
    const ta = textareaRef.current;
    const caret = ta?.selectionStart ?? content.length;
    const before = content.slice(0, caret).replace(/@[^\s@]{0,32}$/, `@${m.username} `);
    const after = content.slice(caret);
    setContent(before + after);
    setMentionOpen(false);
    requestAnimationFrame(() => {
      ta?.focus();
      ta?.setSelectionRange(before.length, before.length);
    });
  };

  const submit = () => {
    const text = content.trim();
    if (text.length > 0 && !create.isPending) create.mutate(text);
  };

  return (
    <div className="space-y-2">
      <Popover open={mentionOpen && filtered.length > 0} onOpenChange={setMentionOpen}>
        <PopoverAnchor asChild>
          <div>
            <Textarea
              ref={textareaRef}
              value={content}
              autoFocus={autoFocus}
              placeholder={placeholder ?? "发表评论，@ 提及成员…"}
              aria-label={parentId ? "回复内容" : "评论内容"}
              maxLength={5000}
              onChange={(e) => {
                setContent(e.target.value);
                detectMention(e.target.value, e.target.selectionStart ?? e.target.value.length);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  submit();
                }
              }}
            />
          </div>
        </PopoverAnchor>
        <PopoverContent
          side="top"
          align="start"
          className="w-56 p-1"
          // 保持焦点在输入框，选择器只读展示（键盘上下键交给后续 P1 增强）
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {filtered.map((m) => (
            <button
              key={m.user_id}
              type="button"
              onClick={() => pick(m)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <UserAvatar username={m.username} displayName={m.display_name} size="sm" />
              <span className="truncate">{m.display_name}</span>
              <span className="truncate text-xs text-muted-foreground">@{m.username}</span>
            </button>
          ))}
        </PopoverContent>
      </Popover>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Ctrl+Enter 发送，@ 可提及成员</span>
        <div className="flex gap-2">
          {onDone ? (
            <Button variant="outline" size="sm" onClick={onDone}>
              取消
            </Button>
          ) : null}
          <Button
            size="sm"
            onClick={submit}
            disabled={create.isPending || content.trim().length === 0}
          >
            发送
          </Button>
        </div>
      </div>
    </div>
  );
}
