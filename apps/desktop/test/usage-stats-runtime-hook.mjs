/**
 * 把 main 侧 desktop-runtime-singleton 重定向到测试替身（usage-stats IPC 测试用）。
 * node --test 每个测试文件独立进程，注册只影响本文件，不会外溢到其他测试。
 */
const stubUrl = new URL("./usage-stats-runtime-stub.mjs", import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith("runtime/desktop-runtime-singleton.js")) {
    return {
      shortCircuit: true,
      url: stubUrl,
    };
  }
  return nextResolve(specifier, context);
}
