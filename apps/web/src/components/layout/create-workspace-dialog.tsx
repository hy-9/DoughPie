import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Workspace } from "@doughpie/shared";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/api-error";
import { useUiStore } from "../../stores/ui";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";

/**
 * 新建工作区（顶栏切换器与看板空状态共用）：建区不限量，创建者即 owner（PLAN.md P0-2）。
 */
export function CreateWorkspaceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState("");
  const qc = useQueryClient();
  const navigate = useNavigate();
  const setCurrentWorkspace = useUiStore((s) => s.setCurrentWorkspace);

  const create = useMutation({
    mutationFn: (n: string) => api.workspaces.create({ name: n }),
    onSuccess: (ws: Workspace) => {
      void qc.invalidateQueries({ queryKey: ["workspaces"] });
      setCurrentWorkspace(ws.id);
      onOpenChange(false);
      setName("");
      navigate("/");
      toast.success(`工作区「${ws.name}」已创建`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    create.mutate(trimmed);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>新建工作区</DialogTitle>
        <form onSubmit={submit} className="mt-3 space-y-3">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="工作区名称"
            maxLength={50}
            autoFocus
            aria-label="工作区名称"
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={create.isPending || name.trim().length === 0}>
              创建
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
