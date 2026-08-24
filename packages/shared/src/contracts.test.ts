import { describe, expect, it } from "vitest";
import { eventEnvelopeSchema } from "./events.js";
import themes from "./theme/themes.json" with { type: "json" };
import { REQUIRED_THEME_TOKENS } from "./theme/tokens.js";

describe("主题契约（ui.md §2/§3）", () => {
  it("内置单主题 linear-blue（P0 档位）", () => {
    expect(themes.themes.map((t) => t.id)).toContain("linear-blue");
  });

  it("每个主题的 light/dark 都必须含全部必需 token", () => {
    for (const theme of themes.themes) {
      for (const mode of ["light", "dark"] as const) {
        for (const key of REQUIRED_THEME_TOKENS) {
          expect(theme.tokens[mode], `${theme.id}/${mode} 缺 token: ${key}`).toHaveProperty(key);
        }
      }
    }
  });

  it("色值 token 为合法 hex（radius/overlay 等结构值除外）", () => {
    const NON_HEX = new Set(["radius", "overlay"]);
    for (const theme of themes.themes) {
      for (const [key, value] of Object.entries(theme.tokens.light)) {
        if (NON_HEX.has(key)) continue;
        expect(value, `${theme.id}/light/${key}`).toMatch(/^#[0-9A-Fa-f]{6}$/);
      }
    }
  });
});

describe("事件信封契约", () => {
  it("id 为 string（int8 序列化防精度丢失），type 受目录约束", () => {
    const ok = eventEnvelopeSchema.safeParse({
      id: "1024",
      workspace_id: crypto.randomUUID(),
      actor_id: crypto.randomUUID(),
      type: "task.created",
      entity: "task",
      entity_id: crypto.randomUUID(),
      payload: { title: "x" },
      created_at: new Date().toISOString(),
    });
    expect(ok.success).toBe(true);
    expect(eventEnvelopeSchema.safeParse({ ...ok.data!, type: "task.exploded" }).success).toBe(
      false,
    );
  });
});
