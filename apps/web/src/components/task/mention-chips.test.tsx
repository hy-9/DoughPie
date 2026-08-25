import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CommentMention } from "@doughpie/shared";
import { describe, expect, it, vi } from "vitest";
import { fakeUuid } from "../../../tests/factories";
import { MentionChips } from "./mention-chips";

/** 提及确认 chips（PLAN.md §5.5 闭环展示：@B✅已确认14:32 绿 / @D⏳待确认 琥珀） */
describe("提及确认 chips", () => {
  const mentions: CommentMention[] = [
    {
      user_id: fakeUuid(1),
      username: "bob",
      display_name: "小博",
      acked_at: "2026-08-24T14:32:00.000Z",
    },
    {
      user_id: fakeUuid(2),
      username: "dora",
      display_name: "小朵",
      acked_at: null,
    },
  ];

  it("应同时渲染已确认（含确认时间）与待确认两态", () => {
    render(<MentionChips mentions={mentions} />);

    const acked = screen.getByText(/@小博/);
    expect(acked.textContent).toContain("✓已确认");
    // 确认时间按本地时区格式化（HH:mm），只校验渲染了时间片段
    expect(acked.textContent).toMatch(/\d{2}:\d{2}/);

    const pending = screen.getByText(/@小朵/);
    expect(pending.textContent).toContain("⏳待确认");
  });

  it("非发起者不显示「再提醒」；发起者可见且点击触发 onRemind", async () => {
    const { unmount } = render(<MentionChips mentions={mentions} />);
    expect(screen.queryByText("再提醒")).not.toBeInTheDocument();
    unmount();

    const onRemind = vi.fn();
    render(<MentionChips mentions={mentions} canRemind onRemind={onRemind} />);
    // 只有待确认的那条可再提醒
    const buttons = screen.getAllByText("再提醒");
    expect(buttons).toHaveLength(1);

    const user = userEvent.setup();
    await user.click(buttons[0] as HTMLElement);
    expect(onRemind).toHaveBeenCalledWith(fakeUuid(2));
  });

  it("无提及时不渲染容器", () => {
    const { container } = render(<MentionChips mentions={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
