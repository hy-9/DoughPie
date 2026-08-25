import { Link } from "react-router-dom";

/** 404 兜底页 */
export function NotFoundPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8">
      <p className="text-2xl font-semibold">404</p>
      <p className="text-[13px] text-muted-foreground">页面不存在或已被删除</p>
      <Link
        to="/"
        className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-[13px] transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        回到看板
      </Link>
    </div>
  );
}
