/**
 * 主题 token 契约（ui.md §2 三层架构）：组件只消费 L2 语义 token，禁止硬编码 L1 色值。
 * themes.json 是全端单一事实源；本文件列出必须存在的 token 键，供测试与构建期生成校验。
 */

/** L2 语义层必须包含的 token 键（light/dark 两套赋值都要有） */
export const REQUIRED_THEME_TOKENS = [
  "background",
  "foreground",
  "card",
  "muted",
  "muted-foreground",
  "border",
  "primary",
  "primary-foreground",
  "ring",
  "destructive",
  "success",
  "warning",
  "kanban-column-bg",
  "state-todo",
  "state-doing",
  "state-review",
  "state-done",
  "priority-high",
  "priority-mid",
  "priority-low",
  "priority-none",
  "notify-high",
  "notify-mid",
  "notify-low",
  "mention-pending",
  "mention-acked",
  "overlay",
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
  "avatar-1",
  "avatar-2",
  "avatar-3",
  "avatar-4",
  "avatar-5",
  "avatar-6",
  "avatar-7",
  "avatar-8",
  "avatar-9",
  "avatar-10",
  "radius",
] as const;
export type ThemeTokenKey = (typeof REQUIRED_THEME_TOKENS)[number];

export interface ThemeDefinition {
  id: string;
  name: string;
  tokens: {
    light: Record<string, string>;
    dark: Record<string, string>;
  };
}

export interface ThemesFile {
  version: number;
  themes: ThemeDefinition[];
}
