/**
 * r3-run-1/2 单测专用 loader hook：与 agent-run-early-exit-mock-hook 同款，
 * 只把 mock 目标换成本组用例的可控 runAgentTurn。
 *
 * 仅在当前测试进程内生效（node --test 每个测试文件独立子进程），并用
 * parentURL 限定只对 ipc/handlers/agent 模块生效。
 */

const runtimeMockUrl = new URL(
  "./agent-prelude-terminal-mock-runtime.mjs",
  import.meta.url,
).href;
const agentRunMockUrl = new URL(
  "./agent-prelude-terminal-mock-agent-run.mjs",
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
