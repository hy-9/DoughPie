/**
 * 构建期主题生成（ui.md §3.2）：themes.json（全端 SSOT）→ themes.css。
 * 输出形态：[data-theme="x"][data-mode="light|dark"] { --token: value }，
 * 运行时切换 <html data-theme data-mode> 属性即时生效无刷新；shadcn 组件消费 CSS var。
 *
 * 用法：node scripts/generate-themes.mjs（predev/prebuild 自动执行）
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// 直接读源文件（SSOT），不依赖 shared 构建产物
const themesPath = join(root, "../../packages/shared/src/theme/themes.json");
const outPath = join(root, "src/styles/themes.css");

const { themes } = JSON.parse(readFileSync(themesPath, "utf8"));

const lines = [
  "/* 本文件由 scripts/generate-themes.mjs 生成，禁止手改；改 token 请改 packages/shared/src/theme/themes.json */",
  "",
];

for (const theme of themes) {
  for (const mode of ["light", "dark"]) {
    lines.push(`[data-theme="${theme.id}"][data-mode="${mode}"] {`);
    for (const [key, value] of Object.entries(theme.tokens[mode])) {
      lines.push(`  --${key}: ${value};`);
    }
    lines.push("}", "");
  }
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, lines.join("\n"));
console.log(`themes.css 已生成：${themes.length} 个主题 × 2 模式 → ${outPath}`);
