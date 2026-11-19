// T-SI1~T-SI8：symbol-index 八值 form 收集矩阵与限定引用计数（spec §3.2）。
// fixture 一律就地构造（多文件 import 场景用多 unit），不落 cwd 文件；snapshot allowlist 用 os.tmpdir。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildSymbolIndex, isProductionPath } from "../dist/lib/symbols.js";

const unit = (file, text) => ({ file, text });
const refs = (prodCalls, prodRefs, testCalls, testRefs) => ({ prodCalls, prodRefs, testCalls, testRefs });

test("T-SI1 八值 form 收集矩阵：嵌套函数与全部容器成员一表全收", () => {
  const index = buildSymbolIndex([
    unit(
      "packages/demo/src/forms.ts",
      `
function topBare() {}
const topVar = () => {};
export function outer() {
  function innerFn() {}
  const innerVar = () => {};
}
function persist() {}
export const Store = {
  save() {},
  load: () => {},
  check: persist,
};
export class Repo {
  find() {}
  get size() { return 1; }
  set size(value) {}
}
export namespace NsUtils {
  export function helper() {}
}
`,
    ),
  ]);
  const of = (name) => index.symbols.filter((symbol) => symbol.name === name);
  assert.deepEqual(of("topBare").map((s) => [s.form, s.container]), [["bare-fn", null]]);
  assert.deepEqual(of("topVar").map((s) => [s.form, s.container]), [["var-fn", null]]);
  // 嵌套函数同收且 container=null（旧 dup 全递归口径）
  assert.deepEqual(of("innerFn").map((s) => [s.form, s.container]), [["bare-fn", null]]);
  assert.deepEqual(of("innerVar").map((s) => [s.form, s.container]), [["var-fn", null]]);
  assert.deepEqual(of("save").map((s) => [s.form, s.container?.name]), [["object-method", "Store"]]);
  assert.deepEqual(of("load").map((s) => [s.form, s.container?.name]), [["object-arrow", "Store"]]);
  assert.deepEqual(of("check").map((s) => [s.form, s.container?.name]), [["object-binding", "Store"]]);
  assert.deepEqual(of("find").map((s) => [s.form, s.container?.name]), [["class-method", "Repo"]]);
  assert.deepEqual(of("size").map((s) => s.form).sort(), ["class-accessor", "class-accessor"]);
  // 顶层导出的对象字面量与 namespace 本身 → namespace-object
  assert.deepEqual(of("Store").map((s) => [s.form, s.container, s.exported]), [["namespace-object", null, true]]);
  assert.deepEqual(of("NsUtils").map((s) => [s.form, s.container, s.exported]), [["namespace-object", null, true]]);
  const helper = of("helper")[0];
  assert.deepEqual([helper.form, helper.container, helper.exported], ["bare-fn", { kind: "namespace", name: "NsUtils" }, true]);
  // object-binding 挂载关系可追溯
  assert.equal(index.bindings.length, 1);
  assert.equal(index.bindings[0].boundName, "persist");
  assert.equal(index.bindings[0].bound?.name, "persist");
  assert.equal(index.bindings[0].bound?.container, null);
  // 负例：非导出的顶层对象不产生 namespace-object 符号，但成员照收
  const privateOnly = buildSymbolIndex([unit("packages/demo/src/private-obj.ts", "const Inner = { run() {} };\n")]);
  assert.deepEqual(privateOnly.symbols.filter((s) => s.container === null).map((s) => s.name), []);
  assert.deepEqual(privateOnly.symbols.map((s) => [s.name, s.form, s.container?.name]), [["run", "object-method", "Inner"]]);
});

test("T-SI2 跨容器同名不互算：精确归因不泄漏，未知接收者按属性名保守命中全部同名成员", () => {
  const index = buildSymbolIndex([
    unit(
      "packages/demo/src/two.ts",
      `
export const A = { resolve(x) { return x; } };
export const B = { resolve(x) { return x; } };
A.resolve(1);
B.resolve(2);
unknownThing.resolve(3);
`,
    ),
  ]);
  const [aResolve] = index.find("resolve", "A");
  const [bResolve] = index.find("resolve", "B");
  // A.resolve = 精确 1 + 兜底 1；B.resolve = 精确 1 + 兜底 1。若精确归因互算，两侧会变 3。
  assert.deepEqual(index.globalRefs(aResolve), refs(2, 0, 0, 0));
  assert.deepEqual(index.globalRefs(bResolve), refs(2, 0, 0, 0));
});

test("T-SI3 Container.member 属性链命中：create 只吃 create 位，容器符号吃接收者位", () => {
  const index = buildSymbolIndex([
    unit(
      "packages/demo/src/log-factory.ts",
      `
export const LogFactory = { create() {}, destroy() {} };
LogFactory.create();
LogFactory.destroy();
LogFactory.destroy();
`,
    ),
  ]);
  const [store] = index.find("LogFactory", null);
  const [create] = index.find("create", "LogFactory");
  const [destroy] = index.find("destroy", "LogFactory");
  assert.deepEqual(index.globalRefs(create), refs(1, 0, 0, 0));
  assert.deepEqual(index.globalRefs(destroy), refs(2, 0, 0, 0));
  // 负例：destroy 的两次调用没有串到 create 上；容器符号（namespace-object）的三处接收者位都是值引用
  assert.deepEqual(index.globalRefs(store), refs(0, 3, 0, 0));
});

test("T-SI4 object-binding：注册位不计裸名消费，成员经链计数，挂载关系可查", () => {
  const index = buildSymbolIndex([
    unit(
      "packages/demo/src/updater.ts",
      `
function checkForUpdates() {}
export const Updater = { check: checkForUpdates };
export function bootstrap() { checkForUpdates(); }
`,
    ),
    unit(
      "packages/demo/src/use-updater.ts",
      `
import { Updater } from "./updater";
Updater.check();
`,
    ),
  ]);
  const [bare] = index.find("checkForUpdates", null);
  const [check] = index.find("check", "Updater");
  assert.equal(check.form, "object-binding");
  // 正例：绑定位被豁免，bare 只剩 bootstrap 内的一次裸调用（旧工具在这里报假 INLINE）
  assert.deepEqual(index.globalRefs(bare), refs(1, 0, 0, 0));
  assert.deepEqual(index.localRefs(bare), { calls: 1, refs: 0, selfRefs: 0 });
  // 成员经 Updater.check 链计数（含跨文件 import 感知）
  assert.deepEqual(index.globalRefs(check), refs(1, 0, 0, 0));
  assert.equal(index.bindings.length, 1);
  assert.equal(index.bindings[0].member, check);
  assert.equal(index.bindings[0].boundName, "checkForUpdates");
  // 负例：非符号值的属性不是绑定，不产生成员符号
  const plain = buildSymbolIndex([unit("packages/demo/src/plain.ts", 'const tag = "x";\nexport const Bag = { tag };\n')]);
  assert.deepEqual(plain.symbols.map((s) => s.name), ["Bag"]);
  assert.deepEqual(plain.bindings, []);
});

test("T-SI5 裸名与成员互不串扰：裸调用只进顶层符号，属性名位不计裸名", () => {
  const index = buildSymbolIndex([
    unit(
      "packages/demo/src/mixed.ts",
      `
export const LogFactory = { resolve() {} };
export function resolve() {}
resolve();
LogFactory.resolve();
`,
    ),
  ]);
  const [bare] = index.find("resolve", null);
  const [member] = index.find("resolve", "LogFactory");
  assert.deepEqual(index.globalRefs(bare), refs(1, 0, 0, 0));
  assert.deepEqual(index.globalRefs(member), refs(1, 0, 0, 0));
});

test("T-SI6 剔除位：定义名/属性名/TypeReference/TypeQuery/JSDoc 都不算引用", () => {
  const index = buildSymbolIndex([
    unit(
      "packages/demo/src/exclude.ts",
      `
/** 文档 {@link shadow} 与 @deprecated 字样都不是引用 */
export function shadow() {}
const typed: shadow = null as unknown as shadow;
let queried: typeof shadow;
const bag = { shadow: 1 };
bag.shadow;
shadow();
`,
    ),
  ]);
  const [bare] = index.find("shadow", null);
  // 唯一的命中是最后的裸调用；{@link}、类型位、属性名位全部剔除（forEachChild 语义）
  assert.deepEqual(index.globalRefs(bare), refs(1, 0, 0, 0));
  assert.deepEqual(index.localRefs(bare), { calls: 1, refs: 0, selfRefs: 0 });
});

test("T-SI7 private class 方法：this 调用计（同文件同类），跨文件引用不计", () => {
  const index = buildSymbolIndex([
    unit(
      "packages/demo/src/repo.ts",
      `
export class Repo {
  private prune() {}
  clean() { this.prune(); }
}
`,
    ),
    unit(
      "packages/demo/src/repo-user.ts",
      `
import { Repo } from "./repo";
export function touch(repo: Repo) { repo.prune(); }
`,
    ),
  ]);
  const [prune] = index.find("prune", "Repo");
  assert.equal(prune.isPrivate, true);
  assert.equal(prune.exported, false);
  // 正例：this.prune() 在同类内，计 1；负例：跨文件 repo.prune() 不计（接收者未知不得跨类归因）
  assert.deepEqual(index.localRefs(prune), { calls: 1, refs: 0, selfRefs: 0 });
  assert.deepEqual(index.globalRefs(prune), refs(1, 0, 0, 0));
});

test("T-SI8 导出面：import 感知 + prod/test 分桶 + core/public 不算消费者 + uniqueNames + snapshot allowlist", () => {
  const snapshotDir = fs.mkdtempSync(path.join(os.tmpdir(), "nm-style-snap-"));
  fs.writeFileSync(path.join(snapshotDir, "public.json"), JSON.stringify(["alpha"]));
  try {
    const index = buildSymbolIndex(
      [
        unit("packages/demo/src/a.ts", "export function alpha() {}\nexport const Store = { ping() {} };\n"),
        unit(
          "packages/demo/src/b.ts",
          `
import { alpha, Store } from "./a";
alpha();
Store.ping();
`,
        ),
        unit(
          "packages/demo/src/c.ts",
          `
import { alpha as al } from "./a";
al();
`,
        ),
        unit(
          "packages/demo/src/d.ts",
          `
import * as mod from "./a";
mod.alpha();
mod.Store.ping();
`,
        ),
        unit(
          "packages/demo/test/e.test.ts",
          `
import { alpha } from "./a";
alpha();
`,
        ),
        unit(
          "packages/core/src/public/reexport.ts",
          `
import { alpha } from "./a";
alpha();
`,
        ),
      ],
      { snapshotDir },
    );
    const [alpha] = index.find("alpha", null);
    // named(1) + as 别名(1) + namespace import(1) = 3 个生产调用点；测试文件进 test 桶；core/public 两个都不算
    assert.deepEqual(index.globalRefs(alpha), refs(3, 0, 1, 0));
    const [ping] = index.find("ping", "Store");
    assert.deepEqual(index.globalRefs(ping), refs(2, 0, 0, 0)); // b.ts 直链 + d.ts namespace 链
    const [store] = index.find("Store", null);
    assert.deepEqual(index.globalRefs(store), refs(0, 2, 0, 0)); // b.ts 接收者 + d.ts mod.Store
    // uniqueNames：同名多定义（导出顶层）→ AMBIGUOUS 依据
    assert.equal(index.topLevelNameCount("alpha"), 1);
    const duplicated = buildSymbolIndex([unit("packages/demo/src/a.ts", "export function alpha() {}\n"), unit("packages/demo/src/other.ts", "export function alpha() {}\n")]);
    assert.equal(duplicated.topLevelNameCount("alpha"), 2);
    // snapshot allowlist 注入生效
    assert.deepEqual([...index.publicNames], ["alpha"]);
    assert.equal(index.publicNames.has("nope"), false);
    // isProductionPath 口径抽检
    assert.equal(isProductionPath("packages/demo/src/a.ts"), true);
    assert.equal(isProductionPath("apps/desktop/renderer/main.ts"), true);
    assert.equal(isProductionPath("packages/core/src/public/reexport.ts"), false);
    assert.equal(isProductionPath("packages/demo/test/e.test.ts"), false);
    assert.equal(isProductionPath("scripts/tool.mjs"), false);
  } finally {
    fs.rmSync(snapshotDir, { recursive: true, force: true });
  }
});

test("容器归因形态：嵌套对象 / 工厂返回 / 别名 / namespace 链精确归因，跨容器不被兜底污染", () => {
  const index = buildSymbolIndex([
    unit(
      "packages/demo/src/containers.ts",
      `
export const Outer = { inner: { hit() {} } };
export const Other = { hit() {} };
export function makeSink() { return { drain() {} }; }
export const Service = { go() {} };
`,
    ),
    unit(
      "packages/demo/src/user.ts",
      `
import { Service as Svc } from "./containers";
Outer.inner.hit();
makeSink().drain();
Svc.go();
`,
    ),
    unit(
      "packages/demo/src/ns-user.ts",
      `
import * as containers from "./containers";
containers.Service.go();
`,
    ),
  ]);
  const [innerHit] = index.find("hit", "inner");
  const [otherHit] = index.find("hit", "Other");
  const [drain] = index.find("drain", "makeSink");
  const [go] = index.find("go", "Service");
  // Outer.inner.hit 精确归因到 inner 容器；Other.hit 不被同名兜底污染（接收者可归因时不兜底）
  assert.deepEqual(index.globalRefs(innerHit), refs(1, 0, 0, 0));
  assert.deepEqual(index.globalRefs(otherHit), refs(0, 0, 0, 0));
  // 工厂调用 makeSink().drain() 归因到 makeSink 容器
  assert.deepEqual(index.globalRefs(drain), refs(1, 0, 0, 0));
  // as 别名 + namespace 链各计 1 次
  assert.deepEqual(index.globalRefs(go), refs(2, 0, 0, 0));
});

test("Ns.check = fn 成员赋值注册：绑定位不计消费，箭头赋值收 object-arrow，纯写入不算成员消费", () => {
  const index = buildSymbolIndex([
    unit(
      "packages/demo/src/mount.ts",
      `
function handler() {}
export const Registry = { base() {} };
Registry.extra = handler;
Registry.later = () => {};
`,
    ),
  ]);
  const [bare] = index.find("handler", null);
  assert.deepEqual(index.globalRefs(bare), refs(0, 0, 0, 0));
  const [extra] = index.find("extra", "Registry");
  assert.equal(extra.form, "object-binding");
  assert.deepEqual(index.bindings.map((b) => [b.member.name, b.boundName]), [["extra", "handler"]]);
  const [later] = index.find("later", "Registry");
  assert.equal(later.form, "object-arrow");
  // 负例：注册赋值本身不给成员计消费（写入位不算读取）
  assert.deepEqual(index.globalRefs(extra), refs(0, 0, 0, 0));
  assert.deepEqual(index.globalRefs(later), refs(0, 0, 0, 0));
});

test("as const / satisfies 包裹的对象字面量照常识别容器", () => {
  const index = buildSymbolIndex([
    unit(
      "packages/demo/src/wrapped.ts",
      `
export const Wrapped = { run() {} } as const;
const Checked = { validate() {} } satisfies Record<string, () => void>;
`,
    ),
  ]);
  assert.deepEqual(index.find("run", "Wrapped").map((s) => s.form), ["object-method"]);
  assert.deepEqual(index.symbols.filter((s) => s.name === "Wrapped").map((s) => [s.form, s.exported]), [["namespace-object", true]]);
  assert.deepEqual(index.find("validate", "Checked").map((s) => s.form), ["object-method"]);
  // 负例：非导出的 Checked 不产生顶层符号
  assert.deepEqual(index.symbols.filter((s) => s.name === "Checked" && s.container === null).map((s) => s.name), []);
});

test("自引用剔除：递归调用不救活自己，selfRefs 单独给出", () => {
  const index = buildSymbolIndex([
    unit(
      "packages/demo/src/recursive.ts",
      `
export function loop() { loop(); }
function lonely() { lonely(); }
`,
    ),
  ]);
  const [loopSym] = index.find("loop", null);
  const [lonely] = index.find("lonely", null);
  assert.deepEqual(index.globalRefs(loopSym), refs(0, 0, 0, 0));
  assert.deepEqual(index.localRefs(loopSym), { calls: 0, refs: 0, selfRefs: 1 });
  assert.deepEqual(index.localRefs(lonely), { calls: 0, refs: 0, selfRefs: 1 });
});

test("deprecated 标记：裸 fn 与 var-fn（语句级注释）都识别进字段", () => {
  const index = buildSymbolIndex([
    unit(
      "packages/demo/src/deprecated.ts",
      `
/** @deprecated 用 newWay */
export function oldWay() {}
/** @deprecated 用 newConst */
export const oldConst = () => {};
export function fine() {}
`,
    ),
  ]);
  assert.equal(index.find("oldWay", null)[0].deprecated, true);
  assert.equal(index.find("oldConst", null)[0].deprecated, true);
  assert.equal(index.find("fine", null)[0].deprecated, false);
});

test("导出面补标：export { x } 重导出与 export default x 都算导出符号", () => {
  const index = buildSymbolIndex([unit("packages/demo/src/reexport.ts", "function local() {}\nexport { local };\nexport default local;\n")]);
  const [local] = index.find("local", null);
  assert.equal(local.exported, true);
  assert.equal(index.topLevelNameCount("local"), 1);
});

test("具名函数表达式的名字标识符不计引用（cr-func-symbols P1-1 负例：与 ClassExpression 名字位同口径）", () => {
  const index = buildSymbolIndex([
    unit('packages/demo/src/u2.ts', 'export function shadow() {}\n'),
    unit('packages/demo/src/main.ts', 'import { shadow } from "./u2";\nconst f = function shadow() {};\nshadow();\n'),
  ]);
  const [def] = index.find("shadow", null);
  assert.equal(def.file, "packages/demo/src/u2.ts");
  const refs = index.globalRefs(def);
  // 只有 main.ts 的显式调用计 1；函数表达式自己的名字 shadow() {} 不得再加。
  assert.equal(refs.prodCalls + refs.prodRefs, 1);
});

test("简写绑定 { helper }：注册为容器成员且绑定位不计消费（cr-func-symbols P2-5 补测）", () => {
  const index = buildSymbolIndex([
    unit('packages/demo/src/factory.ts', 'export function helper() {}\nexport const Sink = { helper };\nconst out = Sink.helper();\n'),
  ]);
  const [helper] = index.find("helper", null);
  assert.equal(helper.form, "bare-fn");
  // 函数本体零裸名消费（绑定位豁免），经 Sink.helper 成员存活。
  const refs = index.globalRefs(helper);
  assert.equal(refs.prodCalls + refs.prodRefs, 0);
  const [member] = index.find("helper", "Sink");
  assert.equal(member.form, "object-binding");
  const memberRefs = index.globalRefs(member);
  assert.ok(memberRefs.prodCalls + memberRefs.prodRefs >= 1, "Sink.helper() 调用须命中成员");
});
