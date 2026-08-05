import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveSkspEnvOverride } from "../../../src/infra/sksp/logic/env-override.js";

/**
 * T-DS4：resolveSkspEnvOverride parity 套件。
 *
 * 四态：undefined / "" / "   "（仅空白）/ 非空。
 * 三端（desktop/mobile/cli）后续各自 import 同一函数后，行为应当与此一致。
 */
describe("resolveSkspEnvOverride", () => {
  const name = "NOVEL_MASTER_PROVIDER_OPENAI_API_KEY";

  it("undefined 视为不覆盖 DB（返回 null）", () => {
    const env: Record<string, string | undefined> = {};
    assert.equal(resolveSkspEnvOverride(name, env), null);
  });

  it("显式 undefined 也视为不覆盖 DB", () => {
    const env: Record<string, string | undefined> = { [name]: undefined };
    assert.equal(resolveSkspEnvOverride(name, env), null);
  });

  it("空串视为不覆盖 DB", () => {
    const env: Record<string, string | undefined> = { [name]: "" };
    assert.equal(resolveSkspEnvOverride(name, env), null);
  });

  it("仅空白串视为不覆盖 DB", () => {
    const env: Record<string, string | undefined> = { [name]: "   " };
    assert.equal(resolveSkspEnvOverride(name, env), null);
  });

  it("非空值原样返回（含前后空格的有效密钥也保留）", () => {
    const env: Record<string, string | undefined> = { [name]: "sk-test" };
    assert.equal(resolveSkspEnvOverride(name, env), "sk-test");
  });

  it("其它无关变量存在时也不误命中", () => {
    const env: Record<string, string | undefined> = {
      OTHER_VAR: "noise",
      [name]: "  ",
    };
    assert.equal(resolveSkspEnvOverride(name, env), null);
  });
});
