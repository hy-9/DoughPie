import { changePasswordBodySchema, COPY, updateMeBodySchema } from "@doughpie/shared";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { api } from "../lib/api";
import { errorMessage } from "../lib/api-error";
import { UC_ENABLED } from "../lib/env";
import { fieldIssueMessage } from "../lib/form-errors";
import { cn } from "../lib/utils";
import { useAuthStore } from "../stores/auth";

/**
 * 个人设置（/settings）：昵称修改 / 改密（成功后全端下线→清本地跳登录）/
 * UC 绑定解绑（仅 UC_ENABLED 显示）/ 主题模式三态（next-themes）。
 */
export function SettingsPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4">
      <h1 className="text-lg font-semibold">个人设置</h1>
      <ProfileSection />
      <PasswordSection />
      {UC_ENABLED ? <UcSection /> : null}
      <ThemeSection />
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

/** 昵称修改（updateMe；display_name 本地可编辑，默认=用户名） */
function ProfileSection() {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const [name, setName] = useState(user?.display_name ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = updateMeBodySchema.safeParse({ display_name: name.trim() });
    if (!parsed.success) {
      setError(fieldIssueMessage(parsed.error.issues, "display_name", "昵称"));
      return;
    }
    setSaving(true);
    try {
      setUser(await api.users.updateMe(parsed.data));
      toast.success("昵称已保存");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section title="个人资料">
      <form onSubmit={(e) => void submit(e)} className="flex items-end gap-2" noValidate>
        <div className="flex-1 space-y-1">
          <label htmlFor="display-name" className="text-xs text-muted-foreground">
            昵称
          </label>
          <Input
            id="display-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={50}
          />
          {error ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </div>
        <Button type="submit" disabled={saving || name.trim() === (user?.display_name ?? "")}>
          保存
        </Button>
      </form>
      <p className="mt-2 text-xs text-muted-foreground">用户名：{user?.username}（不可修改）</p>
    </Section>
  );
}

/** 修改密码（成功 → 服务端吊销全部会话 → 清本地跳登录页） */
function PasswordSection() {
  const user = useAuthStore((s) => s.user);
  const clear = useAuthStore((s) => s.clear);
  const navigate = useNavigate();
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    // UC-only 账号无旧密码（服务端免验 old_password）
    const parsed = changePasswordBodySchema.safeParse({
      old_password: user?.has_password ? oldPassword : undefined,
      new_password: newPassword,
    });
    if (!parsed.success) {
      setError(
        fieldIssueMessage(parsed.error.issues, "old_password", "当前密码") ??
          fieldIssueMessage(parsed.error.issues, "new_password", "新密码"),
      );
      return;
    }
    if (confirm !== newPassword) {
      setError("两次输入的新密码不一致");
      return;
    }
    setSaving(true);
    try {
      await api.users.changePassword(parsed.data);
      toast.success("密码已修改，请重新登录");
      localStorage.removeItem("doughpie.access_token");
      localStorage.removeItem("doughpie.refresh_token");
      clear();
      navigate("/login", { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section title="修改密码">
      <form onSubmit={(e) => void submit(e)} className="max-w-sm space-y-3" noValidate>
        {user?.has_password ? (
          <Input
            type="password"
            value={oldPassword}
            onChange={(e) => setOldPassword(e.target.value)}
            placeholder="当前密码"
            aria-label="当前密码"
            autoComplete="current-password"
          />
        ) : (
          <p className="text-xs text-muted-foreground">
            当前账号由统一认证创建，设置密码后可账密登录
          </p>
        )}
        <Input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder={`新密码（${COPY.auth.passwordRule}）`}
          aria-label="新密码"
          autoComplete="new-password"
        />
        <Input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="确认新密码"
          aria-label="确认新密码"
          autoComplete="new-password"
        />
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
        <Button type="submit" disabled={saving}>
          修改密码
        </Button>
      </form>
    </Section>
  );
}

/** UC 绑定/解绑（仅 UC_ENABLED；解绑 409 UNBIND_FORBIDDEN 提示先设本地密码） */
function UcSection() {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const [confirmUnbind, setConfirmUnbind] = useState(false);
  const [busy, setBusy] = useState(false);

  const bind = async () => {
    setBusy(true);
    try {
      const { authorize_url } = await api.auth.ssoStart("bind");
      window.location.href = authorize_url;
    } catch {
      toast.error(COPY.auth.ucUnavailable);
      setBusy(false);
    }
  };

  const unbind = async () => {
    setBusy(true);
    try {
      await api.users.unbindUc();
      setUser(await api.users.me());
      setConfirmUnbind(false);
      toast.success("已解绑统一认证");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="统一认证（UC）">
      <div className="flex items-center gap-3">
        {user?.has_uc_identity ? (
          <>
            <Badge variant="state-done">已绑定</Badge>
            <Button variant="outline" size="sm" onClick={() => setConfirmUnbind(true)}>
              解绑
            </Button>
          </>
        ) : (
          <Button variant="outline" size="sm" onClick={() => void bind()} disabled={busy}>
            绑定统一认证
          </Button>
        )}
      </div>
      <Dialog open={confirmUnbind} onOpenChange={setConfirmUnbind}>
        <DialogContent>
          <DialogTitle>解绑统一认证</DialogTitle>
          <p className="mt-2 text-[13px] text-muted-foreground">
            解绑后将无法通过统一认证登录。确定继续吗？
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmUnbind(false)}>
              取消
            </Button>
            <Button variant="destructive" disabled={busy} onClick={() => void unbind()}>
              解绑
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Section>
  );
}

/** 主题模式三态（P0-13；主题包 P0 固定 linear-blue，P2 开放切换器） */
function ThemeSection() {
  const { theme, setTheme } = useTheme();
  const options = [
    { value: "light", label: "浅色", icon: Sun },
    { value: "dark", label: "深色", icon: Moon },
    { value: "system", label: "跟随系统", icon: Monitor },
  ] as const;
  return (
    <Section title="外观">
      <div className="flex gap-2" role="radiogroup" aria-label="主题模式">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={theme === o.value}
            onClick={() => setTheme(o.value)}
            className={cn(
              "flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] transition-colors duration-150",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              theme === o.value ? "bg-muted font-medium" : "hover:bg-muted",
            )}
          >
            <o.icon className="h-3.5 w-3.5" />
            {o.label}
          </button>
        ))}
      </div>
    </Section>
  );
}
