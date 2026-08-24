/**
 * clearSessionPromptCaches 单测：三件套顺序清空、pending 域保留、故障注入吞错。
 *
 * 用内存 SessionKkv（createMemorySessionKkv）做故障注入，
 * 不依赖真实 DB（DB 集成路径由 character-card-import / vfs-zip-io 测试覆盖）。
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  SESSION_KKV_DOMAIN_FILE_CACHE,
  SESSION_KKV_DOMAIN_RULE_SNAPSHOT,
  SESSION_KKV_DOMAIN_USER_VFS_PENDING,
} from "../../src/domain/session-kkv/model/session-kkv-domains.js";
import { sessionApiPromptTokenCache } from "../../src/infra/tokenizer/logic/session-api-prompt-token-cache.js";
import type { SessionKkvService } from "../../src/service/session-kkv/session-kkv.port.js";
import { clearSessionPromptCaches } from "../../src/service/vfs/logic/clear-session-prompt-caches.js";
import { createMemorySessionKkv } from "../helpers/prompt-layout-test-helpers.js";

afterEach(() => {
  sessionApiPromptTokenCache.clearAll();
});

describe("clearSessionPromptCaches", () => {
  it("清空 rule_snapshot/file_cache 并 invalidate token cache，保留 user_vfs_pending", async () => {
    const kkv = createMemorySessionKkv();
    const sessionId = "s-clear-ok";
    await kkv.set(sessionId, SESSION_KKV_DOMAIN_RULE_SNAPSHOT, "canon", "snap");
    await kkv.set(sessionId, SESSION_KKV_DOMAIN_FILE_CACHE, "full:/a.md", "a");
    await kkv.set(
      sessionId,
      SESSION_KKV_DOMAIN_USER_VFS_PENDING,
      "queue",
      "[]",
    );
    sessionApiPromptTokenCache.set(sessionId, {
      promptTokens: 42,
      updatedAt: Date.now(),
    });
    assert.ok(sessionApiPromptTokenCache.get(sessionId) != null);

    await clearSessionPromptCaches(sessionId, kkv);

    assert.deepEqual(
      await kkv.listKeys(sessionId, SESSION_KKV_DOMAIN_RULE_SNAPSHOT),
      [],
    );
    assert.deepEqual(
      await kkv.listKeys(sessionId, SESSION_KKV_DOMAIN_FILE_CACHE),
      [],
    );
    assert.equal(
      await kkv.get(sessionId, SESSION_KKV_DOMAIN_USER_VFS_PENDING, "queue"),
      "[]",
    );
    assert.equal(sessionApiPromptTokenCache.get(sessionId), undefined);
  });

  it("clearDomain 抛错时吞错 + console.warn，且短路后续步骤不抛出", async () => {
    const boom: SessionKkvService = Object.assign(createMemorySessionKkv(), {
      clearDomain: async (): Promise<void> => {
        throw new Error("kkv-boom");
      },
    });
    const sessionId = "s-clear-boom";
    await boom.set(sessionId, SESSION_KKV_DOMAIN_FILE_CACHE, "full:/a.md", "a");
    sessionApiPromptTokenCache.set(sessionId, {
      promptTokens: 7,
      updatedAt: Date.now(),
    });

    const originalWarn = console.warn;
    const warnCalls: unknown[][] = [];
    console.warn = (...args: unknown[]) => {
      warnCalls.push(args);
    };
    try {
      await assert.doesNotReject(clearSessionPromptCaches(sessionId, boom));
    } finally {
      console.warn = originalWarn;
    }

    assert.equal(warnCalls.length, 1);
    // 首步抛错后整体短路：file_cache 未被清、token cache 未被 invalidate
    assert.deepEqual(
      await boom.listKeys(sessionId, SESSION_KKV_DOMAIN_FILE_CACHE),
      ["full:/a.md"],
    );
    assert.ok(sessionApiPromptTokenCache.get(sessionId) != null);
  });
});
