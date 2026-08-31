import { useState } from "react";
import { Button } from "../ui/button";
import { CreateWorkspaceDialog } from "./create-workspace-dialog";

/**
 * 无工作区空状态：看板/智能视图/清单页共用。
 * 加载完成且列表为空时必须渲染此引导，不能继续骨架屏（否则「今天」等页会永远转圈）。
 */
export function NoWorkspacePrompt() {
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3">
      <p className="text-lg font-semibold">欢迎使用豆排排</p>
      <p className="text-[13px] text-muted-foreground">创建第一个工作区，或等待同事邀请你加入</p>
      <Button onClick={() => setCreateOpen(true)}>新建工作区</Button>
      <CreateWorkspaceDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
