/**
 * X4 守卫：`@novel-master/core/kkv` 这个 exports 子路径必须解析到 **公共 barrel**
 * （`dist/public/kkv.js`），而不是内部 barrel / src 源码。
 *
 * 前置条件（本测试依赖 `packages/core/dist` 产物，dist 是 gitignore 的）：
 *   先跑 `npm run build -w @novel-master/core`，再跑本测试。
 *   CI 侧本测试排在 `Build workspaces` 之后。**刻意不降级为 test.todo**——
 *   守卫静默跳过就等于没有守卫（wave-e X4.2 判据②）。
 *
 * ── 为什么必须在子进程里解析（spec X4.2 约束① 的实测修正）────────────
 * spec 给的写法是 `createRequire(import.meta.url).resolve(...)`，本机位实跑**不成立**，
 * 两个原因都是实测出来的，不是推测：
 *
 *   ① `packages/core/package.json` 的 `"./kkv"` exports 只有 `types` + `import`
 *      两个条件，**没有 `require` 条件**。`createRequire().resolve()` 走的是 CJS 的
 *      `require` 条件 ⇒ 直接抛 `ERR_PACKAGE_PATH_NOT_EXPORTED: './kkv' is not defined`。
 *      （包本身 `"type": "module"`，是 ESM-only。）
 *
 *   ② 换成 `import.meta.resolve()`（走 `import` 条件，本来是对的）在 tsx 下**仍然被劫持**：
 *      core 测试跑在 `tsx --tsconfig tsconfig.test.json` 下，tsx 会把
 *      `import.meta.resolve` 重写成按 tsconfig paths 解析，实测结果是
 *      `file:///.../packages/core/src/public/kkv.ts` —— 正是本测试要排除的那条路径。
 *      同理裸 `import("@novel-master/core/kkv")` 也会被接管。
 *
 * ⇒ 唯一能拿到「线上真实解析结果」的办法是**起一个不挂 tsx loader 的纯 node 子进程**，
 * 由它执行 `import.meta.resolve` 并把结果打印出来。这仍然满足约束① 的实质要求
 * ——「测试解析必须显式绕开 tsx 的 paths 接管」——只是载体从同进程的 require 换成了子进程。
 *
 * ── D-207 顺序约束 ─────────────────────────────────────────────────
 * D-207（wave-d 批次 2）把 `tsconfig.test.json` 的 `@novel-master/core/kkv` 从
 * `./src/service/kkv/index.ts`（内部 barrel）改指 `./src/public/kkv.ts`。
 * 本守卫只锁 **exports 侧**（node 真实解析必须落 dist），不锁 paths 侧：
 * D-207 落地删映射 / 改指向后本测试无需改动，仍绿；反过来若有人把 package.json 的
 * `"./kkv"` exports 指回内部 barrel，本测试必红。src 侧由
 * `public-subpath-allowlist.test.ts` 的 SUBPATHS 契约覆盖（X4.2 约束④）。
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

/** packages/core 根目录（本文件在 test/package-exports/ 下）。 */
const CORE_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DIST_ENTRY_REL = "dist/public/kkv.js";

/**
 * 在纯 node 子进程里做一次真实的 exports 解析，绕开 tsx 的 paths 接管。
 * @returns {string} 解析结果（文件系统路径，posix 分隔符）
 */
function resolveKkvDistViaNode(): string {
  const script =
    "process.stdout.write(import.meta.resolve('@novel-master/core/kkv'));";
  try {
    const stdout = execFileSync(
      process.execPath,
      ["--input-type=module", "--eval", script],
      { cwd: CORE_ROOT, encoding: "utf8" }
    );
    return fileURLToPath(stdout.trim()).replace(/\\/g, "/");
  } catch (err) {
    // 恒红防护：新 clone / 未 build 环境必须给出可操作的失败信息，
    // 而不是抛一句 "Cannot find module" 让人猜。
    assert.fail(
      `纯 node 子进程解析 @novel-master/core/kkv 失败：${(err as Error).message}\n` +
        `本测试需要已构建的 dist 产物，请先跑 \`npm run build -w @novel-master/core\`。\n` +
        `若 dist 已存在仍失败，说明 packages/core/package.json 的 "./kkv" exports 被改坏了` +
        `（注意该子路径只有 types/import 条件，删掉 import 条件会让 node 直接报未导出）。`
    );
  }
}

describe("kkv 子路径的 dist 解析守卫（X4）", () => {
  it("dist 产物存在（否则后续断言都是假绿）", () => {
    const distEntry = fileURLToPath(new URL(`../../${DIST_ENTRY_REL}`, import.meta.url));
    assert.ok(
      existsSync(distEntry),
      `缺少 ${DIST_ENTRY_REL}。先跑 \`npm run build -w @novel-master/core\` 再跑本测试。`
    );
  });

  it("@novel-master/core/kkv 解析到公共 barrel dist/public/kkv.js", () => {
    const resolved = resolveKkvDistViaNode();
    assert.ok(
      resolved.includes("packages/core/dist/public/kkv"),
      `@novel-master/core/kkv 必须解析到公共 barrel（…/packages/core/dist/public/kkv.js），` +
        `实际解析到：${resolved}\n` +
        `若它指向 src/service/kkv/index.ts 或 src/public/kkv.ts，说明 package.json 的 "./kkv" exports 被改回了非 dist 路径。`
    );
    assert.ok(
      !resolved.includes("/src/"),
      `@novel-master/core/kkv 不应解析进 src/ 源码树，实际：${resolved}`
    );
  });

  it("解析到的 dist 模块可 import 且导出非空", async () => {
    const resolved = resolveKkvDistViaNode();
    const mod = (await import(`file:///${resolved}`)) as Record<string, unknown>;
    const named = Object.keys(mod).filter(k => k !== "default");
    assert.ok(
      named.length > 0,
      `${resolved} 解析成功但没有任何 named export，公共 barrel 可能是空壳。`
    );
    assert.ok(
      named.includes("createKkvService"),
      `公共 barrel 应导出 createKkvService，实际导出：${named.join(", ")}`
    );
  });

  it("src 侧（tsx paths 解析）与 dist 侧导出一致（D-207 双向不漂移）", async () => {
    // src 侧走 tsconfig paths（tsconfig.test.json 的 "./src/public/kkv.ts"），
    // dist 侧走 node exports。两边是同一份公共 barrel 的两种产物形态，
    // 导出集合必须一致——不一致就说明有一侧漏了 re-export。
    const resolved = resolveKkvDistViaNode();
    const distMod = (await import(`file:///${resolved}`)) as Record<string, unknown>;
    const srcMod = (await import("@novel-master/core/kkv")) as Record<string, unknown>;
    const names = (m: Record<string, unknown>) =>
      Object.keys(m).filter(k => k !== "default").sort();
    assert.deepEqual(
      names(distMod),
      names(srcMod),
      "dist 侧与 src 侧的 public/kkv 导出集合不一致（dist 是旧产物？请重新 build core）。"
    );
  });
});
