import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * UI 态（web.md §3：Zustand 只放 UI 态）。
 * currentWorkspaceId 持久化：顶栏切换器「记住上次使用」（PLAN.md §8）。
 */
interface UiState {
  currentWorkspaceId: string | null;
  sidebarCollapsed: boolean;
  setCurrentWorkspace: (id: string) => void;
  toggleSidebar: () => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      currentWorkspaceId: null,
      sidebarCollapsed: false,
      setCurrentWorkspace: (id) => set({ currentWorkspaceId: id }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
    }),
    { name: "doughpie.ui" },
  ),
);
