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
