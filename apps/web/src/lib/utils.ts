import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** shadcn 惯例：条件类名合并 + tailwind 冲突去重 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
