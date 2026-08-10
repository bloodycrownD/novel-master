/**
 * T9 (spec §测试策略): global `tokenCounter.mode` must have no public preferences read path.
 * Per-model `tokenCounterMode` validation helpers remain exported; only the preferences loader is banned.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as core from "@novel-master/core";
import * as provider from "@novel-master/core/provider";
import * as tokenizer from "../../../src/infra/tokenizer/index.js";
import * as readPref from "../../../src/infra/tokenizer/logic/read-token-counter-mode-pref.js";
import {
  TOKEN_COUNTER_MODE_OPTIONS,
  TOKEN_COUNTER_MODE_SELECT_OPTIONS,
} from "../../../src/domain/provider/model/token-counter-mode-options.js";

const BANNED_EXPORTS = ["readTokenCounterModeFromPreferences"] as const;

function assertNotExported(
  mod: Record<string, unknown>,
  exportName: (typeof BANNED_EXPORTS)[number],
  label: string,
): void {
  assert.equal(
    mod[exportName],
    undefined,
    `${exportName} must not be exported from ${label}`,
  );
}

describe("T9 tokenCounter.mode no public read path", () => {
  for (const name of BANNED_EXPORTS) {
    it(`${name} is not exported from @novel-master/core`, () => {
      assertNotExported(core as Record<string, unknown>, name, "@novel-master/core");
    });

    it(`${name} is not exported from infra/tokenizer`, () => {
      assertNotExported(
        tokenizer as Record<string, unknown>,
        name,
        "infra/tokenizer",
      );
    });

    it(`${name} is not exported from read-token-counter-mode-pref module`, () => {
      assertNotExported(
        readPref as Record<string, unknown>,
        name,
        "read-token-counter-mode-pref",
      );
    });
  }

  it("saved-model validation helpers are not exported from main entry", () => {
    const mainEntry = core as Record<string, unknown>;
    assert.equal(mainEntry.parseTokenCounterModePref, undefined);
    assert.equal(mainEntry.isValidTokenCounterModePref, undefined);
    assert.equal(mainEntry.TOKEN_COUNTER_MODE_PREF_KEY, undefined);
  });

  it("saved-model validation helpers remain exported from @novel-master/core/provider", () => {
    assert.equal(typeof provider.parseTokenCounterModePref, "function");
    assert.equal(typeof provider.isValidTokenCounterModePref, "function");
    assert.equal(provider.TOKEN_COUNTER_MODE_PREF_KEY, "tokenCounter.mode");
  });
});

describe("T-S8 heuristic removed from user-selectable options", () => {
  it("TOKEN_COUNTER_MODE_OPTIONS no longer lists heuristic", () => {
    assert.equal(
      (TOKEN_COUNTER_MODE_OPTIONS as readonly string[]).includes("heuristic"),
      false,
    );
    // 保留六项核心选项
    assert.deepEqual([...TOKEN_COUNTER_MODE_OPTIONS], [
      "auto",
      "tiktoken",
      "claude",
      "gemma",
      "llama3",
      "mistral",
    ]);
  });

  it("TOKEN_COUNTER_MODE_SELECT_OPTIONS no longer lists heuristic", () => {
    const values = TOKEN_COUNTER_MODE_SELECT_OPTIONS.map((o) => o.value);
    assert.equal(values.includes("heuristic"), false);
    assert.equal(values.includes("auto"), true);
  });

  it("parseTokenCounterModePref normalizes legacy 'heuristic' to 'auto'", () => {
    assert.equal(readPref.parseTokenCounterModePref("heuristic"), "auto");
    // 其他正常值不受影响
    assert.equal(readPref.parseTokenCounterModePref("tiktoken"), "tiktoken");
    assert.equal(readPref.parseTokenCounterModePref("auto"), "auto");
  });

  it("isValidTokenCounterModePref still accepts 'heuristic' (VALID_FAMILIES 保留宽容旧数据)", () => {
    assert.equal(readPref.isValidTokenCounterModePref("heuristic"), true);
    assert.equal(readPref.isValidTokenCounterModePref("tiktoken"), true);
  });
});
