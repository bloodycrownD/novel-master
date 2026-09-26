/**
 * 给 `js-tiktoken/lite` 包一层带构造计数的壳（cr-fix-spec metrics/G-1）。
 *
 * 存在的原因：desktop 测试跑在 `npx tsx --test`（**真 ESM**）下，而
 * `renderer/hooks/stream-token-estimator.ts:20` 是**静态具名导入**
 * `import { Tiktoken } from "js-tiktoken/lite"`——ESM 的具名导入在模块求值
 * 时就绑定了原导出，测试侧事后 monkey-patch 模块 namespace 打不进去（改到
 * 的只是测试自己那份副本，源模块早已取值）。断言「连续两次建估算器只触发
 * 一次编码表构造」在 ESM 下唯一可达的确定性手段就是本仓既有的
 * `module.register` 钩子链（`register-electron-mock.mjs` 已在用
 * `electron-hook` / `core-at-alias-hook`）。
 *
 * ⚠️ **取原模块不能用裸 specifier**：本钩子自己也要解析
 * `js-tiktoken/lite`，若写 `import ... from "js-tiktoken/lite"`，resolve
 * 钩子会把它拦回钩子自己 → 无限递归 / 栈溢出，测试直接起不来。故用
 * `createRequire(import.meta.url).resolve(...)` 取绝对路径，再以真实的
 * file URL 加载。
 *
 * 计数读口由**测试文件自己**从 `js-tiktoken/lite` 取 `__test__`：钩子对
 * 所有 importer 生效，测试文件与被测源码拿到的是同一个模块实例。
 */
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

/** 本文件自身的 file URL：被 `js-tiktoken/lite` 的解析一律短路到这份壳。 */
const stubUrl = import.meta.url;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "js-tiktoken/lite") {
    return {shortCircuit: true, url: stubUrl};
  }
  return nextResolve(specifier, context);
}

/** 构造计数（每次 `new Tiktoken(...)` +1），挂在壳的 `__test__` 上供测试读。 */
const constructionCount = {value: 0};

// createRequire 绕开本钩子的 resolve 链，拿到 `js-tiktoken/lite` 的真实绝对
// 路径；再转 file URL 以动态 import 加载——全程不出现裸 specifier。
const requireFromHook = createRequire(import.meta.url);
const originalUrl = pathToFileURL(
  requireFromHook.resolve("js-tiktoken/lite"),
).href;
const original = await import(originalUrl);

/** 计数版 Tiktoken：行为与原类一致，只多记一次构造。 */
class CountingTiktoken extends original.Tiktoken {
  constructor(ranks) {
    constructionCount.value += 1;
    super(ranks);
  }
}

// 对外命名空间 = 原模块的具名导出 + 换过的 Tiktoken + 计数读口。逐个转出
// （`export … from` 的说明符必须是字面量，而原模块的真实路径是运行期算出来
// 的，故这里用 `export const` 绑定已加载的命名空间成员）：`js-tiktoken/lite`
// 的具名导出就只有 `Tiktoken` 与 `getEncodingNameForModel` 两个，两个都转
// 出以保持导出面与原模块一致。
export const Tiktoken = CountingTiktoken;
export const getEncodingNameForModel = original.getEncodingNameForModel;
export const __test__ = {
  get constructionCount() {
    return constructionCount.value;
  },
};
