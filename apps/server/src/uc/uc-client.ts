import { z } from "zod";
import type { UcConfig } from "../env.js";
import { ApiError } from "../lib/api-error.js";

/**
 * UC HTTP 客户端（backend.md §2.9，契约以 UC 代码 C:\code\Rust\userSystem 为准）。
 * fetch 实现可注入（测试用 mock fetch 严格校验请求体形状）；禁止凭记忆编造 UC 行为。
 */

/** UC userinfo 响应：{id, username, role, client_id}，无 email/头像（§2.9） */
const ucUserinfoSchema = z.object({
  id: z.string(),
  username: z.string(),
  role: z.string(),
  client_id: z.string().optional(),
});
export type UcUserinfo = z.infer<typeof ucUserinfoSchema>;

const ucTokenResponseSchema = z.object({
  access_token: z.string(),
});

/** force-logout-ts 响应（以 UC 代码为准）：{ user_id, force_logout_before: RFC3339 | null } */
const ucForceLogoutSchema = z.object({
  user_id: z.string(),
  force_logout_before: z.string().datetime({ offset: true }).nullable(),
});

export interface UcClient {
  exchangeCode(params: { code: string; codeVerifier: string }): Promise<{ accessToken: string }>;
  getUserinfo(accessToken: string): Promise<UcUserinfo>;
  /** 按 UC 用户 sub 查询强退水位线；null = 未强退 */
  getForceLogoutBefore(ucUserId: string): Promise<Date | null>;
}

/** UC 错误结构扁平 {code,message}（§2.9）；文案透传给用户 */
async function readUcError(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { message?: unknown };
    return typeof body.message === "string" ? body.message : null;
  } catch {
    return null;
  }
}

/** UC 不可达/响应形状异常（COPY 无对应文案，缺口已记录） */
function ucUnavailable(): ApiError {
  return new ApiError(502, "INTERNAL", "统一认证服务暂时不可用，请稍后再试");
}

export function createUcClient(config: UcConfig, fetchImpl: typeof fetch = fetch): UcClient {
  /** 请求封装：网络异常 → 502；非 2xx → 401 + 透传 UC 文案；响应形状不符 → 502 */
  async function request<T>(url: string, init: RequestInit, schema: z.ZodType<T>): Promise<T> {
    let res: Response;
    try {
      res = await fetchImpl(url, init);
    } catch {
      throw ucUnavailable();
    }
    if (!res.ok) {
      const message = await readUcError(res);
      throw new ApiError(401, "UNAUTHORIZED", message ?? "统一认证登录失败，请重试");
    }
    const parsed = schema.safeParse(await res.json());
    if (!parsed.success) throw ucUnavailable();
    return parsed.data;
  }

  return {
    /** 授权码换 token（§2.9）：请求体严格五字段，无 grant_type */
    async exchangeCode({ code, codeVerifier }) {
      const data = await request(
        `${config.baseUrl}/oauth/token`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            code,
            client_id: config.clientId,
            client_secret: config.clientSecret,
            redirect_uri: config.redirectUri,
            code_verifier: codeVerifier,
          }),
        },
        ucTokenResponseSchema,
      );
      return { accessToken: data.access_token };
    },

    async getUserinfo(accessToken) {
      return request(
        `${config.baseUrl}/oauth/userinfo`,
        { headers: { authorization: `Bearer ${accessToken}` } },
        ucUserinfoSchema,
      );
    },

    async getForceLogoutBefore(ucUserId) {
      const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
      const data = await request(
        `${config.baseUrl}/auth/force-logout-ts?user_id=${encodeURIComponent(ucUserId)}`,
        { headers: { authorization: `Basic ${basic}` } },
        ucForceLogoutSchema,
      );
      return data.force_logout_before ? new Date(data.force_logout_before) : null;
    },
  };
}
