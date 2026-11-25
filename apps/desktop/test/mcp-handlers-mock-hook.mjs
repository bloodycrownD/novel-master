/**
 * MCP handler 单测专用 loader hook：ipc/handlers/mcp 引用 desktop-runtime-singleton
 * 时重定向到同目录 mock（mcp-handlers-mock-runtime.ts），不拉真实 SQLite runtime。
 *
 * 仅在当前测试进程内生效（node --test 每个测试文件独立子进程），并用 parentURL
 * 限定只对 handlers/mcp 模块生效，避免误伤其他导入者。
 */

const runtimeMockUrl = new URL("./mcp-handlers-mock-runtime.ts", import.meta.url).href;

function isMcpHandlerImporter(parentURL) {
  return parentURL != null && parentURL.includes("src/main/ipc/handlers/mcp");
}

export async function resolve(specifier, context, nextResolve) {
  if (isMcpHandlerImporter(context.parentURL) && specifier.endsWith("runtime/desktop-runtime-singleton.js")) {
    return { shortCircuit: true, url: runtimeMockUrl };
  }
  return nextResolve(specifier, context);
}
