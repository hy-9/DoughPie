import * as DialogPrimitive from "@radix-ui/react-dialog";
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import { cn } from "../../lib/utils";

/**
 * 详情抽屉（ui.md §1：抽屉+路由双形态）：右侧 480px 滑出，200ms 滑入。
 * 与 Dialog 同属 Radix Dialog 语义（Esc 关闭/焦点圈禁），视觉形态不同。
 */
export const Drawer = DialogPrimitive.Root;
export const DrawerClose = DialogPrimitive.Close;

export const DrawerContent = forwardRef<
  ElementRef<typeof DialogPrimitive.Content>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-overlay" />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed inset-y-0 right-0 z-50 w-full max-w-[480px]",
        "border-l border-border bg-card text-foreground shadow-lg",
        "duration-200 ease-out data-[state=open]:animate-in data-[state=open]:slide-in-from-right",
        "data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right",
        "focus:outline-none",
        className,
      )}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
DrawerContent.displayName = "DrawerContent";
