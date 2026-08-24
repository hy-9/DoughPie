import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/globals.css";
import "./styles/themes.css";

// 主题：P0 内置单主题 linear-blue（ui.md §3）；模式三态交给 next-themes（data-mode 属性与生成物对齐）
document.documentElement.dataset.theme = "linear-blue";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 服务端状态以 events/socket 失效为准（D 阶段），窗口聚焦不主动 refetch
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="data-mode" defaultTheme="system" enableSystem>
        <App />
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
