/**
 * token 占用来源记号（badge）与完整占用标签的单测（token-source-label T-TL1/T-TL2）。
 *
 * badge 映射此前散在 desktop main service、desktop renderer 的
 * SessionDetailDrawer、mobile service 三处各写一遍三元表达式，改一处忘另两处
 * 就会出现「主进程标签与 chip 打架」。本测试钉住 core 侧这份唯一事实来源。
 *
 * 注意输入域：`(source, counterKind, estimated)` 是驱动产物三元组——部分组合
 * （gpt2 家族、「家族+est=true」）在 fallback-caliber-align 修复后实际不可达，
 * 这里以直接构造 counterKind 值锁定映射行为（防御未来家族/资产失败回潮），
 * 不经驱动构造。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatContextUsageLabel,
  formatPromptTokenUsageLabel,
  formatTokenSourceBadge,
  formatTokenCount,
} from "../../../src/common/format-token-count.js";
// infra 导出面再导出的同一份实现（index → public/provider 链的源头）。
import {
  formatContextUsageLabel as formatContextUsageLabelViaInfra,
  formatTokenSourceBadge as formatTokenSourceBadgeViaInfra,
} from "../../../src/infra/tokenizer/logic/format-token-source-badge.js";

describe("formatTokenSourceBadge（T-TL1 映射表逐行）", () => {
  it("source=api → 远程 =（api ⇒ est=false 恒成立，不看其余两参）", () => {
    assert.deepEqual(formatTokenSourceBadge("api", "api", false), {
      mark: "远程",
      connector: "=",
    });
    // 防御：即使下游违背不变式送来 api+est=true，也按远程精确展示——
    // source=api 的值本身就是 usage.prompt_tokens 真值。
    assert.deepEqual(formatTokenSourceBadge("api", "api", true), {
      mark: "远程",
      connector: "=",
    });
  });

  it("counterKind=tiktoken/gpt2 且 est=false → gpt =（gpt2 行纯防御，驱动不产出）", () => {
    assert.deepEqual(formatTokenSourceBadge("local", "tiktoken", false), {
      mark: "gpt",
      connector: "=",
    });
    assert.deepEqual(formatTokenSourceBadge("local", "gpt2", false), {
      mark: "gpt",
      connector: "=",
    });
  });

  it("家族名 + est=false → 家族展示名 =（映射表：qwen2/llama3/command-r 去代次后缀，其余原样）", () => {
    assert.deepEqual(formatTokenSourceBadge("local", "glm", false), {
      mark: "glm",
      connector: "=",
    });
    assert.deepEqual(formatTokenSourceBadge("local", "qwen2", false), {
      mark: "qwen",
      connector: "=",
    });
    assert.deepEqual(formatTokenSourceBadge("local", "llama3", false), {
      mark: "llama",
      connector: "=",
    });
    assert.deepEqual(formatTokenSourceBadge("local", "command-r", false), {
      mark: "command",
      connector: "=",
    });
    // 未进映射表的家族原样：llama 不映射（PRD 展示名 llama 与原值一致）。
    assert.deepEqual(formatTokenSourceBadge("local", "llama", false), {
      mark: "llama",
      connector: "=",
    });
    assert.deepEqual(formatTokenSourceBadge("local", "claude", false), {
      mark: "claude",
      connector: "=",
    });
  });

  it("家族名 + est=true → gpt ≈（防御：fa 修复后不可达，资产失败回潮时诚实标估算）", () => {
    assert.deepEqual(formatTokenSourceBadge("local", "glm", true), {
      mark: "gpt",
      connector: "≈",
    });
    assert.deepEqual(formatTokenSourceBadge("local", "qwen2", true), {
      mark: "gpt",
      connector: "≈",
    });
  });

  it("counterKind=heuristic → gpt ≈（一切兜底：cl100k 兜底与字符折算终极档同值合并）", () => {
    assert.deepEqual(formatTokenSourceBadge("local", "heuristic", true), {
      mark: "gpt",
      connector: "≈",
    });
    // estimated 与 heuristic 档不一致时以 counterKind 为准（heuristic 恒估算）。
    assert.deepEqual(formatTokenSourceBadge("local", "heuristic", false), {
      mark: "gpt",
      connector: "≈",
    });
  });

  it("未知 counterKind → mark 原样透传（防御未来家族）", () => {
    assert.deepEqual(formatTokenSourceBadge("local", "future-x", false), {
      mark: "future-x",
      connector: "=",
    });
    // 未知家族 + 估算 → 落 est=true 防御行（gpt ≈）。
    assert.deepEqual(formatTokenSourceBadge("local", "future-x", true), {
      mark: "gpt",
      connector: "≈",
    });
  });

  it("source=undefined（旧调用方缺省）→ 非 api 一律走家族/兜底分支，不谎报远程", () => {
    assert.deepEqual(formatTokenSourceBadge(undefined, "tiktoken", false), {
      mark: "gpt",
      connector: "=",
    });
    assert.deepEqual(formatTokenSourceBadge(undefined, "heuristic", true), {
      mark: "gpt",
      connector: "≈",
    });
  });

  it("infra/tokenizer/logic 再导出与 common 真身同源（单源，不是第二份实现）", () => {
    assert.equal(formatTokenSourceBadgeViaInfra, formatTokenSourceBadge);
    assert.equal(formatContextUsageLabelViaInfra, formatContextUsageLabel);
  });
});

describe("formatContextUsageLabel（T-TL2 完整标签格式）", () => {
  it("有窗口：{mark} {connector} {pct}% {cur}/{cw}，K/M 压缩沿用 formatTokenCount", () => {
    // 55000/128000 = 42.97% → 43；55K/128K。
    assert.equal(
      formatContextUsageLabel(
        55_000,
        128_000,
        formatTokenSourceBadge("api", "api", false),
      ),
      "远程 = 43% 55K/128K",
    );
    assert.equal(
      formatContextUsageLabel(
        2_400_000,
        128_000,
        formatTokenSourceBadge("local", "glm", false),
      ),
      "glm = 999% 2.4M/128K",
    );
  });

  it("pct 封顶 999（同旧实现）", () => {
    assert.equal(
      formatContextUsageLabel(
        2_000_000,
        1_000,
        formatTokenSourceBadge("local", "heuristic", true),
      ),
      "gpt ≈ 999% 2M/1K",
    );
  });

  it("无窗口：{mark} {connector} {X} tokens", () => {
    assert.equal(
      formatContextUsageLabel(
        2_345,
        undefined,
        formatTokenSourceBadge("local", "heuristic", true),
      ),
      "gpt ≈ 2.3K tokens",
    );
    // 窗口非法（<=0）按未知处理。
    assert.equal(
      formatContextUsageLabel(
        327,
        0,
        formatTokenSourceBadge("local", "qwen2", false),
      ),
      "qwen = 327 tokens",
    );
  });

  it("badge 缺省 → 无前缀形态（旧调用方纯数字场景）", () => {
    assert.equal(formatContextUsageLabel(64_000, 128_000), "50% 64K/128K");
    assert.equal(formatContextUsageLabel(327), "327 tokens");
  });

  it("非法 count → 显示 —（有/无窗口、有/无 badge 一致）", () => {
    assert.equal(formatContextUsageLabel(Number.NaN, 128_000), "—");
    assert.equal(
      formatContextUsageLabel(
        -1,
        undefined,
        formatTokenSourceBadge("api", "api", false),
      ),
      "远程 = —",
    );
    assert.equal(formatTokenCount(Number.NaN), "—");
  });

  it("formatPromptTokenUsageLabel 是同一实现的兼容名（无 ~ 前缀、无 estimated 参数）", () => {
    assert.equal(formatPromptTokenUsageLabel, formatContextUsageLabel);
    assert.equal(
      formatPromptTokenUsageLabel(64_000, 128_000, {
        mark: "远程",
        connector: "=",
      }),
      "远程 = 50% 64K/128K",
    );
  });
});
