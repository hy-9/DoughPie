import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCurrentWorkspace } from "../../hooks/use-current-workspace";
import { useUiStore } from "../../stores/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { CreateWorkspaceDialog } from "./create-workspace-dialog";

/** 工作区切换器（顶栏最左；切换后回看板首页，选择持久化在 ui store） */
export function WorkspaceSwitcher() {
  const { workspaces, workspace } = useCurrentWorkspace();
  const setCurrentWorkspace = useUiStore((s) => s.setCurrentWorkspace);
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex h-8 max-w-[220px] items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="切换工作区"
          >
            <span className="truncate">{workspace?.name ?? "选择工作区"}</span>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          {workspaces.map((w) => (
            <DropdownMenuItem
              key={w.id}
              onSelect={() => {
                setCurrentWorkspace(w.id);
                navigate("/");
              }}
            >
              <span className="truncate">{w.name}</span>
              {w.id === workspace?.id ? <Check className="ml-auto h-3.5 w-3.5" /> : null}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> 新建工作区
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateWorkspaceDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}
