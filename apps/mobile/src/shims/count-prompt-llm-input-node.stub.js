/**
 * RN stub for core's Node-only dynamic import.
 * polyfills.ts installs PromptTokenCounterBridge before App; this path must not run on device.
 */
export async function countPromptLlmInputNode() {
  throw new Error(
    'countPromptLlmInputNode is Node-only; mobile polyfills must install PromptTokenCounterBridge',
  );
}
