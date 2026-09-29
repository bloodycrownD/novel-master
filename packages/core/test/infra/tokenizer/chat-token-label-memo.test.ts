/**
 * chat-token-label-memo 单测：stamp 组成（任一输入变化即换指纹）、
 * memo 命中/LRU、KKV 缺省退化。
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import type { SessionKkvService } from "../../../src/service/session-kkv/session-kkv.port.js";
import { sessionApiPromptTokenCache } from "../../../src/infra/tokenizer/logic/session-api-prompt-token-cache.js";
import {
  chatTokenLabelMemo,
  computeChatTokenLabelStamp,
  type ChatTokenLabelStampDeps,
} from "../../../src/infra/tokenizer/logic/chat-token-label-memo.js";

/** 内存假 KKV：可编程的域键值与读失败开关。 */
function createFakeKkv(overrides?: {
  readError?: boolean;
}): SessionKkvService & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async get(sessionId, domain, key) {
      if (overrides?.readError) {
        throw new Error("kkv boom");
      }
      return store.get(`${sessionId}#${domain}#${key}`) ?? null;
    },
    async set(sessionId, domain, key, value) {
      store.set(`${sessionId}#${domain}#${key}`, value);
    },
  } as SessionKkvService & { store: Map<string, string> };
}

function createDeps(overrides?: {
  updatedAtMs?: number;
  visibleCount?: number;
  maxSeq?: number | null;
  sessionKkv?: SessionKkvService | null;
}): ChatTokenLabelStampDeps {
  return {
    sessions: {
      get: async () => ({ updatedAtMs: overrides?.updatedAtMs ?? 100 }),
    },
    messages: {
      sessionMessageStamp: async () => ({
        visibleCount: overrides?.visibleCount ?? 3,
        maxSeq: overrides?.maxSeq ?? 9,
      }),
    },
    sessionKkv:
      overrides?.sessionKkv === undefined
        ? createFakeKkv()
        : overrides.sessionKkv,
  };
}

describe("computeChatTokenLabelStamp", () => {
  beforeEach(() => {
    // api store 的进程内热层跨用例回填（readSessionApiPromptTokenEntry 命中
    // 热层时不再触 KKV），先清避免用例间串扰。
    sessionApiPromptTokenCache.clearAll();
  });

  it("任一组成变化 → 指纹变化（消息面/会话行/模型/规则/API 真值）", async () => {
    const kkv = createFakeKkv();
    const base = await computeChatTokenLabelStamp("s", createDeps({ sessionKkv: kkv }), "m1");

    assert.notEqual(
      await computeChatTokenLabelStamp(
        "s",
        createDeps({ sessionKkv: kkv, updatedAtMs: 101 }),
        "m1"
      ),
      base,
      "会话行 updatedAtMs 变 → 指纹变"
    );
    assert.notEqual(
      await computeChatTokenLabelStamp(
        "s",
        createDeps({ sessionKkv: kkv, visibleCount: 4 }),
        "m1"
      ),
      base,
        "可见条数变（压缩/置位）→ 指纹变"
    );
    assert.notEqual(
      await computeChatTokenLabelStamp(
        "s",
        createDeps({ sessionKkv: kkv, maxSeq: 10 }),
        "m1"
      ),
      base,
      "MAX(seq) 变（append/回滚）→ 指纹变"
    );
    assert.notEqual(
      await computeChatTokenLabelStamp("s", createDeps({ sessionKkv: kkv }), "m2"),
      base,
      "会话模型变 → 指纹变"
    );

    // 规则面：canon 写入后指纹变。
    const beforeCanon = await computeChatTokenLabelStamp(
      "s",
      createDeps({ sessionKkv: kkv }),
      "m1"
    );
    await kkv.set("s", "rule_snapshot", "canon", '[{"path":"a.md"}]');
    assert.notEqual(
      await computeChatTokenLabelStamp("s", createDeps({ sessionKkv: kkv }), "m1"),
      beforeCanon,
      "rule canon 变 → 指纹变"
    );

    // API 真值面：条目写入后指纹变。
    const beforeApi = await computeChatTokenLabelStamp(
      "s",
      createDeps({ sessionKkv: kkv }),
      "m1"
    );
    await kkv.set(
      "s",
      "prompt_tokens",
      "lastPromptUsage",
      JSON.stringify({ promptTokens: 123, atMs: 5, savedModelId: "m1" })
    );
    assert.notEqual(
      await computeChatTokenLabelStamp("s", createDeps({ sessionKkv: kkv }), "m1"),
      beforeApi,
      "API 真值条目写入 → 指纹变"
    );
  });

  it("同输入同指纹（确定性）；KKV 缺省/读失败有稳定退化字面量", async () => {
    const a = await computeChatTokenLabelStamp("s", createDeps(), "m1");
    const b = await computeChatTokenLabelStamp("s", createDeps(), "m1");
    assert.equal(a, b);

    const noKkv = await computeChatTokenLabelStamp(
      "s",
      createDeps({ sessionKkv: null }),
      "m1"
    );
    assert.match(noKkv, /rno-kkv#ano-kkv/);
    assert.notEqual(noKkv, a);

    const readErr = await computeChatTokenLabelStamp(
      "s",
      createDeps({ sessionKkv: createFakeKkv({ readError: true }) }),
      "m1"
    );
    // api store 自吞库读异常为 miss（读口设计），api 段与真缺失同为 "none"。
    assert.match(readErr, /rread-error#anone/);
  });
});

describe("chatTokenLabelMemo", () => {
  beforeEach(() => {
    chatTokenLabelMemo.clearForTests();
  });

  it("set 后同 stamp 命中返回 payload；stamp 不等 → miss", () => {
    chatTokenLabelMemo.set("s", "st-1", "glm = 1k / 128k (1%)");
    assert.equal(chatTokenLabelMemo.get<string>("s", "st-1"), "glm = 1k / 128k (1%)");
    assert.equal(chatTokenLabelMemo.get<string>("s", "st-2"), null);
    assert.equal(chatTokenLabelMemo.get<string>("other", "st-1"), null);
  });

  it("覆盖写取最新；payload 可为任意形态（desktop 存对象）", () => {
    const stats = { tokenCount: 42, label: "远程 = 42 / 128k (0%)" };
    chatTokenLabelMemo.set("s", "st-1", "old");
    chatTokenLabelMemo.set("s", "st-1", stats);
    assert.deepEqual(chatTokenLabelMemo.get<typeof stats>("s", "st-1"), stats);
  });

  it("LRU：第 9 个会话写入淘汰最旧会话条目", () => {
    for (let i = 0; i < 9; i += 1) {
      chatTokenLabelMemo.set(`s${i}`, "st", `label-${i}`);
    }
    assert.equal(chatTokenLabelMemo.get<string>("s0", "st"), null, "最旧被淘汰");
    assert.equal(chatTokenLabelMemo.get<string>("s8", "st"), "label-8");
  });
});
