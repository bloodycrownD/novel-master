/**
 * RealPromptPanel 测试的模块重定向钩子：@/components/MermaidMarkdown →
 * prompt-turn-mermaid-stub。拦截原始 specifier（含 @/ 别名形态），形态对齐
 * prompt-turn-code-editor-hook.mjs（已随 Modal 换组件删除）/ chat-search-shell-nav-hook.mjs 先例。
 */
const mermaidStubUrl = new URL(
  "./prompt-turn-mermaid-stub.mjs",
  import.meta.url,
).href;

export async function resolve(specifier, context, nextResolve) {
  if (
    specifier === "@/components/MermaidMarkdown" ||
    specifier.endsWith("components/MermaidMarkdown") ||
    specifier.endsWith("components/MermaidMarkdown.tsx")
  ) {
    return { shortCircuit: true, url: mermaidStubUrl };
  }
  return nextResolve(specifier, context);
}
