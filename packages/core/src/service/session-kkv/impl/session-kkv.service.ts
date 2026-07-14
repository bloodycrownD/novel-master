/**
 * 默认 Session KKV 服务实现。
 *
 * @module service/session-kkv/impl/session-kkv.service
 */

import type { SessionKkvRepository } from "@/domain/session-kkv/repositories/session-kkv.port.js";
import type { SessionKkvService } from "../session-kkv.port.js";

/**
 * 委托 {@link SessionKkvRepository} 的会话级 KKV 服务。
 */
export class DefaultSessionKkvService implements SessionKkvService {
  constructor(private readonly repo: SessionKkvRepository) {}

  async get(
    sessionId: string,
    domain: string,
    key: string,
  ): Promise<string | null> {
    const entry = await this.repo.get(sessionId, domain, key);
    return entry?.value ?? null;
  }

  set(
    sessionId: string,
    domain: string,
    key: string,
    value: string,
  ): Promise<void> {
    return this.repo.set(sessionId, domain, key, value);
  }

  async delete(
    sessionId: string,
    domain: string,
    key: string,
  ): Promise<void> {
    await this.repo.delete(sessionId, domain, key);
  }

  clearSession(sessionId: string): Promise<void> {
    return this.repo.clearSession(sessionId);
  }

  listKeys(sessionId: string, domain: string): Promise<string[]> {
    return this.repo.listKeys(sessionId, domain);
  }
}
