import { Toaster as SonnerToaster } from "sonner";
import { useTheme } from "next-themes";

/** toast（ui.md §6：sonner；淡入 150-200ms，随主题模式） */
export function Toaster() {
  const { resolvedTheme } = useTheme();
  return (
    <SonnerToaster
      theme={resolvedTheme === "dark" ? "dark" : "light"}
      position="bottom-right"
      toastOptions={{
        style: {
          background: "var(--card)",
          color: "var(--foreground)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          fontSize: "13px",
        },
      }}
    />
  );
}
