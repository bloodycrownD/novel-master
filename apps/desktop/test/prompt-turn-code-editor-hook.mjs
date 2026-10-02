/**
 * T-R6 的模块重定向钩子：@/components/ui/CodeEditor → prompt-turn-code-editor-stub。
 * 拦截原始 specifier（含 @/ 别名形态），形态对齐 chat-search-shell-nav-hook.mjs 先例。
 */
const codeEditorStubUrl = new URL(
  "./prompt-turn-code-editor-stub.mjs",
  import.meta.url,
).href;

export async function resolve(specifier, context, nextResolve) {
  if (
    specifier === "@/components/ui/CodeEditor" ||
    specifier.endsWith("components/ui/CodeEditor") ||
    specifier.endsWith("components/ui/CodeEditor.tsx")
  ) {
    return { shortCircuit: true, url: codeEditorStubUrl };
  }
  return nextResolve(specifier, context);
}
