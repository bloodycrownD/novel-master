import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import { ToolRegistry } from "../../src/domain/tool/logic/tool-registry.js";
import { ToolRunner } from "../../src/domain/tool/logic/tool-runner.js";
import {
  extractInputPaths,
  findDisallowedPath,
  isPathAllowed,
  pathStartsWithPrefix,
  readAllowedPaths,
} from "../../src/domain/tool/logic/tool-path-policy.js";
import { ToolError } from "../../src/errors/tool-errors.js";

/**
 * A-14 / T-SC9：agent 试图写 allowedPaths 之外的路径，必须被 ToolRunner 拒掉。
 *
 * @module test/tool/tool-runner-path-policy.test
 */

describe("A-14 tool path policy", () => {
  describe("pathStartsWithPrefix / isPathAllowed", () => {
    it("空前缀与根前缀恒为通过", () => {
      assert.equal(pathStartsWithPrefix("any/path", ""), true);
      assert.equal(pathStartsWithPrefix("any/path", "/"), true);
      assert.equal(pathStartsWithPrefix("any/path", "\\"), true);
    });

    it("精确匹配与子路径匹配", () => {
      assert.equal(pathStartsWithPrefix("src/a.ts", "src"), true);
      assert.equal(pathStartsWithPrefix("src/a.ts", "src/"), true);
      assert.equal(pathStartsWithPrefix("src", "src"), true);
      // 不能只看字符串前缀，得是路径层级前缀，避免 src-foo 被放行
      assert.equal(pathStartsWithPrefix("src-foo/a.ts", "src"), false);
      assert.equal(pathStartsWithPrefix("source/a.ts", "src"), false);
    });

    it("Windows 风格反斜杠分隔符同样识别", () => {
      assert.equal(pathStartsWithPrefix("src\\a.ts", "src"), true);
      assert.equal(pathStartsWithPrefix("src\\a.ts", "src\\"), true);
    });

    it("allowedPaths undefined 表示不限制", () => {
      assert.equal(isPathAllowed("/etc/passwd"), true);
      assert.equal(isPathAllowed("/etc/passwd", undefined), true);
    });

    it("allowedPaths 非空时落在任一前缀下放行", () => {
      assert.equal(isPathAllowed("src/a.ts", ["docs", "src"]), true);
      assert.equal(isPathAllowed("docs/notes.md", ["docs", "src"]), true);
      assert.equal(isPathAllowed("secrets/key.txt", ["docs", "src"]), false);
    });
  });

  describe("extractInputPaths", () => {
    it("抽取约定字段 path / filePath / from / to，跳过空串与非字符串", () => {
      assert.deepEqual(
        extractInputPaths({
          path: "a/b.ts",
          filePath: "c/d.ts",
          from: "x",
          to: "y",
          pattern: "*.ts", // 非约定字段，不抽
          ignored: "",
          ignored2: 42,
        }),
        ["a/b.ts", "c/d.ts", "x", "y"],
      );
    });

    it("非对象 input 返回空数组", () => {
      assert.deepEqual(extractInputPaths(null), []);
      assert.deepEqual(extractInputPaths(undefined), []);
      assert.deepEqual(extractInputPaths("not an object"), []);
    });
  });

  describe("readAllowedPaths", () => {
    it("鸭子读 ctx.allowedPaths；缺失或非数组时返回 undefined", () => {
      assert.deepEqual(readAllowedPaths({}), undefined);
      assert.deepEqual(readAllowedPaths({ allowedPaths: undefined }), undefined);
      assert.deepEqual(
        readAllowedPaths({ allowedPaths: ["src"] }),
        ["src"],
      );
      assert.deepEqual(
        readAllowedPaths({ allowedPaths: "not-array" }),
        undefined,
      );
      assert.deepEqual(readAllowedPaths(null), undefined);
      assert.deepEqual(readAllowedPaths("str"), undefined);
    });
  });

  describe("findDisallowedPath", () => {
    it("全部放行返回 null；任一越界返回第一条越界路径", () => {
      assert.equal(
        findDisallowedPath(["src/a.ts", "src/b.ts"], ["src"]),
        null,
      );
      assert.equal(
        findDisallowedPath(["src/a.ts", "secret/k.txt"], ["src"]),
        "secret/k.txt",
      );
    });

    it("allowedPaths undefined 时一律返回 null", () => {
      assert.equal(findDisallowedPath(["/etc/shadow"], undefined), null);
    });
  });
});

describe("ToolRunner path policy (T-SC9)", () => {
  // 构造一个会「真实落盘」的 tool 太重，且这一层只关心 runner 是否在调 tool 之前
  // 把越权调用挡掉，所以这里用 run() 断言「绝不被调到」就够。
  function makeWriteTool(ran: { ok: boolean }): {
    name: "write";
    description: string;
    inputSchema: z.ZodType<{ path: string; content: string }>;
    run: () => Promise<{ ok: true }>;
  } {
    return {
      name: "write",
      description: "stub write",
      inputSchema: z.object({
        path: z.string().min(1),
        content: z.string(),
      }),
      async run() {
        ran.ok = true;
        return { ok: true as const };
      },
    };
  }

  function makeFsMvTool(ran: { ok: boolean }): {
    name: "fs";
    description: string;
    inputSchema: z.ZodType<{ action: "mv"; from: string; to: string }>;
    run: () => Promise<{ ok: true }>;
  } {
    return {
      name: "fs",
      description: "stub fs mv",
      inputSchema: z.object({
        action: z.literal("mv"),
        from: z.string().min(1),
        to: z.string().min(1),
      }),
      async run() {
        ran.ok = true;
        return { ok: true as const };
      },
    };
  }

  it("allowedPaths 未设置时正常通过（向后兼容）", async () => {
    const ran = { ok: false };
    const registry = new ToolRegistry();
    registry.register(makeWriteTool(ran));
    const runner = new ToolRunner(registry);

    const out = await runner.call(
      "write",
      { path: "anywhere/secret.txt", content: "x" },
      {}, // 没有 allowedPaths
    );
    assert.deepEqual(out, { ok: true });
    assert.equal(ran.ok, true);
  });

  it("allowedPaths 覆盖到放行前缀，调用正常", async () => {
    const ran = { ok: false };
    const registry = new ToolRegistry();
    registry.register(makeWriteTool(ran));
    const runner = new ToolRunner(registry);

    const out = await runner.call(
      "write",
      { path: "src/a.ts", content: "x" },
      { allowedPaths: ["src", "docs"] },
    );
    assert.deepEqual(out, { ok: true });
    assert.equal(ran.ok, true);
  });

  it("T-SC9: 越界写被拒，抛 FORBIDDEN，且 tool.run 绝不被调到", async () => {
    const ran = { ok: false };
    const registry = new ToolRegistry();
    registry.register(makeWriteTool(ran));
    const runner = new ToolRunner(registry);

    await assert.rejects(
      () =>
        runner.call(
          "write",
          { path: "secrets/key.txt", content: "x" },
          { allowedPaths: ["src", "docs"] },
        ),
      (e: unknown) => {
        assert.ok(e instanceof ToolError, "应为 ToolError");
        assert.equal((e as ToolError).code, "FORBIDDEN");
        assert.equal((e as ToolError).toolName, "write");
        const details = (e as ToolError).details as { path: string };
        assert.equal(details.path, "secrets/key.txt");
        return true;
      },
    );
    // 关键：被拒时 run() 绝不执行
    assert.equal(ran.ok, false);
  });

  it("T-SC9: 路径层级伪前缀不能绕过（src-foo 不在 src 下）", async () => {
    const ran = { ok: false };
    const registry = new ToolRegistry();
    registry.register(makeWriteTool(ran));
    const runner = new ToolRunner(registry);

    await assert.rejects(
      () =>
        runner.call(
          "write",
          { path: "src-evil/x.ts", content: "x" },
          { allowedPaths: ["src"] },
        ),
      (e) => e instanceof ToolError && e.code === "FORBIDDEN",
    );
    assert.equal(ran.ok, false);
  });

  it("T-SC9: fs.mv 同时校验 from 与 to，任一越界即拒", async () => {
    const ran = { ok: false };
    const registry = new ToolRegistry();
    registry.register(makeFsMvTool(ran));
    const runner = new ToolRunner(registry);

    // from 在 src 下，to 跑到 secrets 下——必须被拒
    await assert.rejects(
      () =>
        runner.call(
          "fs",
          { action: "mv", from: "src/a.ts", to: "secrets/a.ts" },
          { allowedPaths: ["src"] },
        ),
      (e: unknown) => {
        assert.ok(e instanceof ToolError);
        assert.equal((e as ToolError).code, "FORBIDDEN");
        assert.equal(
          ((e as ToolError).details as { path: string }).path,
          "secrets/a.ts",
        );
        return true;
      },
    );
    assert.equal(ran.ok, false);
  });

  it("schema 校验失败时仍走 INVALID_ARGUMENT（policy 在 schema 之后）", async () => {
    const ran = { ok: false };
    const registry = new ToolRegistry();
    registry.register(makeWriteTool(ran));
    const runner = new ToolRunner(registry);

    await assert.rejects(
      () =>
        runner.call(
          "write",
          // @ts-expect-error 故意少字段
          { path: "src/a.ts" },
          { allowedPaths: ["src"] },
        ),
      (e) => e instanceof ToolError && e.code === "INVALID_ARGUMENT",
    );
    assert.equal(ran.ok, false);
  });
});
