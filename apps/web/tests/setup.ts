// 组件测试全局装配：jest-dom 断言扩展（toBeInTheDocument 等）
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// vitest 未开 globals：testing-library 的自动清理不会注册，这里显式挂上（否则跨用例 DOM 残留）
afterEach(() => cleanup());

// ---- jsdom 能力补齐（Radix 浮层 / 业务代码依赖，jsdom 未实现） ----

// Radix Dropdown/Popover 的指针捕获（jsdom 无 Pointer Events 完整实现）
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}

// 通知深链锚定评论（comment-section）使用 scrollIntoView
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// 任务列表无限滚动哨兵（task-table）依赖 IntersectionObserver
if (typeof globalThis.IntersectionObserver === "undefined") {
  class IntersectionObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(globalThis, "IntersectionObserver", {
    writable: true,
    value: IntersectionObserverStub,
  });
}

// next-themes / sonner 读 prefers-color-scheme
if (typeof window !== "undefined" && !window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    }),
  });
}
