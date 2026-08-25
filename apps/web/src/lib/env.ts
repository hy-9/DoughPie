/** 统一认证入口开关（与后端 UC_ENABLED 对齐；样例见 apps/web/.env.example） */
export const UC_ENABLED = import.meta.env.VITE_UC_ENABLED === "true";
