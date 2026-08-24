import type { TokenPair } from "@doughpie/shared";

/**
 * 令牌存储抽象（web.md §6）：Web 用 localStorage，移动端用 expo-secure-store，
 * 测试用内存实现。client 不感知存储介质。
 */
export interface TokenStore {
  getAccessToken(): string | null;
  getRefreshToken(): string | null;
  setTokens(tokens: TokenPair): void;
  clear(): void;
}

export class MemoryTokenStore implements TokenStore {
  private tokens: TokenPair | null = null;

  getAccessToken(): string | null {
    return this.tokens?.access_token ?? null;
  }

  getRefreshToken(): string | null {
    return this.tokens?.refresh_token ?? null;
  }

  setTokens(tokens: TokenPair): void {
    this.tokens = tokens;
  }

  clear(): void {
    this.tokens = null;
  }
}
