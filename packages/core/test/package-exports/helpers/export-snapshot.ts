/** 收集模块 runtime named exports（不含 default）。 */
export function collectNamedExports(mod: Record<string, unknown>): string[] {
  return Object.keys(mod)
    .filter((k) => k !== "default")
    .sort();
}
