// react-native 桩：把 `react-native` 的 resolve 重定向到测试用桩模块，
// 这样在 Node 里跑 sksp-android 的测试时不必真的加载 RN 运行时。
// 桩模块从全局对象上读取 NativeModules，方便测试用例注入假的 SkspModule。
const STUB_URL =
  "data:text/javascript," +
  encodeURIComponent(
    "export const NativeModules = (globalThis.__RN_NATIVE_MODULES__ ||= {});",
  );

/**
 * @param {string} specifier
 * @param {{parentURL?: string}} context
 * @param {(specifier: string, context: unknown) => Promise<unknown>} nextResolve
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "react-native") {
    return { url: STUB_URL, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
