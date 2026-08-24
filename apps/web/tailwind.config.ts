import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

/**
 * Tailwind 配置（ui.md §2）：颜色全部映射 L2 语义 token 的 CSS 变量——
 * 组件只允许 bg-primary / text-muted-foreground 这类语义类，禁止 text-blue-600 等硬编码色值。
 * 深色模式用 [data-mode="dark"] 属性选择器（与 themes.css 生成物对齐）。
 */
export default {
  darkMode: ["selector", '[data-mode="dark"]'],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        card: {
          DEFAULT: "var(--card)",
          foreground: "var(--foreground)",
        },
        muted: {
          DEFAULT: "var(--muted)",
          foreground: "var(--muted-foreground)",
        },
        border: "var(--border)",
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)",
        },
        ring: "var(--ring)",
        overlay: "var(--overlay)",
        destructive: "var(--destructive)",
        success: "var(--success)",
        warning: "var(--warning)",
        // 业务语义 token（ui.md §2 L2）
        kanban: "var(--kanban-column-bg)",
        state: {
          todo: "var(--state-todo)",
          doing: "var(--state-doing)",
          review: "var(--state-review)",
          done: "var(--state-done)",
        },
        priority: {
          high: "var(--priority-high)",
          mid: "var(--priority-mid)",
          low: "var(--priority-low)",
          none: "var(--priority-none)",
        },
        notify: {
          high: "var(--notify-high)",
          mid: "var(--notify-mid)",
          low: "var(--notify-low)",
        },
        mention: {
          pending: "var(--mention-pending)",
          acked: "var(--mention-acked)",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      // 字号阶梯（ui.md §7）：12 辅助 / 13 正文 / 15 强调 / 18 页标题 / 22 大标题
      fontSize: {
        xs: "12px",
        base: "13px",
        lg: "15px",
        xl: "18px",
        "2xl": "22px",
      },
    },
  },
  plugins: [animate],
} satisfies Config;
