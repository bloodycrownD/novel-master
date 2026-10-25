import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AppError, isAppError } from "../../src/errors/app-error.js";
import { ErrorCodes } from "../../src/errors/error-codes.js";

/** 各域保留号段；新增域时先在这里登记，守卫会强制 code 落在段内。 */
const DOMAIN_RANGES: Record<string, readonly [number, number]> = {
  AGENT: [101000, 101999],
  VFS: [102000, 102999],
  VFS_CHARACTER_CARD: [103000, 103999],
  CHAT: [106000, 106999],
};

describe("ErrorCodes 注册表", () => {
  it("code 是正整数且落在所属域段内", () => {
    for (const [key, { code }] of Object.entries(ErrorCodes)) {
      assert.ok(Number.isInteger(code) && code > 0, `${key} 的 code 必须是正整数`);
      const domain = key.startsWith("VFS_CHARACTER_CARD_") ? "VFS_CHARACTER_CARD" : key.split("_")[0]!;
      const range = DOMAIN_RANGES[domain];
      assert.ok(range, `${key} 的域 ${domain} 还没登记号段`);
      assert.ok(code >= range[0] && code <= range[1], `${key} 的 code ${code} 超出 ${domain} 段 ${range[0]}-${range[1]}`);
    }
  });

  it("数字码全局唯一（发布后严禁复用或改号）", () => {
    const seen = new Map<number, string>();
    for (const [key, { code }] of Object.entries(ErrorCodes)) {
      const owner = seen.get(code);
      assert.equal(owner, undefined, `code ${code} 被 ${owner} 和 ${key} 重复占用`);
      seen.set(code, key);
    }
  });

  it("desc 非空", () => {
    for (const [key, { desc }] of Object.entries(ErrorCodes)) {
      assert.ok(desc.trim().length > 0, `${key} 缺少 desc`);
    }
  });
});

describe("AppError", () => {
  it("key 映射到注册表的 code/desc，message 缺省时用 desc 兜底", () => {
    const error = new AppError("AGENT_DOOM_LOOP");
    assert.equal(error.name, "AGENT_DOOM_LOOP");
    assert.equal(error.key, "AGENT_DOOM_LOOP");
    assert.equal(error.code, ErrorCodes.AGENT_DOOM_LOOP.code);
    assert.equal(error.desc, ErrorCodes.AGENT_DOOM_LOOP.desc);
    assert.equal(error.message, ErrorCodes.AGENT_DOOM_LOOP.desc);
  });

  it("保留运行期 message、details 与 cause", () => {
    const cause = new Error("boom");
    const error = new AppError(
      "AGENT_DOOM_LOOP",
      'Doom loop: tool "read" invoked 3 times with identical input',
      { toolName: "read" },
      { cause }
    );
    assert.equal(error.message, 'Doom loop: tool "read" invoked 3 times with identical input');
    assert.deepEqual(error.details, { toolName: "read" });
    assert.equal(error.cause, cause);
  });

  it("toJSON 输出跨进程形状", () => {
    const error = new AppError("AGENT_DOOM_LOOP", "boom", { traceId: "t1" });
    assert.deepEqual(error.toJSON(), {
      key: "AGENT_DOOM_LOOP",
      code: ErrorCodes.AGENT_DOOM_LOOP.code,
      desc: ErrorCodes.AGENT_DOOM_LOOP.desc,
      message: "boom",
      details: { traceId: "t1" },
    });
  });

  it("isAppError 收窄实例，并可按 key 校验", () => {
    const error = new AppError("AGENT_DOOM_LOOP");
    assert.equal(isAppError(error), true);
    assert.equal(isAppError(error, "AGENT_DOOM_LOOP"), true);
    assert.equal(isAppError(new Error("x")), false);
  });
});
