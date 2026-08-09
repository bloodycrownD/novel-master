/**
 * C-orch-1 单测专用 loader hook：当 agent.ts 引用 desktop-runtime-singleton
 * 与 agent-run.service 时，重定向到本目录下的 mock 模块。
 *
 * 仅在当前测试进程内生效（node --test 每个测试文件独立子进程），并用
 * parentURL 限定只对 ipc/handlers/agent 模块生效，避免误伤其他导入者。
 */

const runtimeMockUrl = new URL(
  "./agent-run-early-exit-mock-runtime.mjs",
  import.meta.url,
).href;
const agentRunMockUrl = new URL(
  "./agent-run-early-exit-mock-agent-run.mjs",
  import.meta.url,
).href;

function isAgentHandlerImporter(parentURL) {
  return (
    parentURL != null &&
    parentURL.includes("src/main/ipc/handlers/agent")
  );
}

export async function resolve(specifier, context, nextResolve) {
  if (isAgentHandlerImporter(context.parentURL)) {
    if (specifier.endsWith("runtime/desktop-runtime-singleton.js")) {
      return { shortCircuit: true, url: runtimeMockUrl };
    }
    if (specifier.endsWith("services/agent-run.service.js")) {
      return { shortCircuit: true, url: agentRunMockUrl };
    }
  }
  return nextResolve(specifier, context);
}
