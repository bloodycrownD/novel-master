/**
 * Tool path policy (A-14)：tool input 路径白名单二次校验。
 *
 * @remarks
 * 这是 schema 校验之后的「第二道闸」。`Tool.inputSchema` 只能约束单个字段
 * 的类型与必填，没法表达「这个 agent 只能写 src/ 下的文件」这种跨字段、
 * 跟运行时上下文相关的策略，所以单独抽出来一层做。
 *
 * 语义：从 tool input 顶层抽取约定好的路径字段，逐一检查是否落在
 * `allowedPaths` 任一前缀下；只要有一条越界就拒绝。`allowedPaths === undefined`
 * 表示不限制（向后兼容，三端目前都走这个语义）。
 *
 * @module domain/tool/logic/tool-path-policy
 */

/** 约定：tool input 顶层这些字段出现时一律视为路径参与校验。 */
const PATH_FIELDS = ["path", "filePath", "from", "to"] as const;

/** 从 tool input 顶层提取所有路径字段（约定字段名见 {@link PATH_FIELDS}）。 */
export function extractInputPaths(input: unknown): readonly string[] {
  if (typeof input !== "object" || input === null) {
    return [];
  }
  const rec = input as Record<string, unknown>;
  const paths: string[] = [];
  for (const key of PATH_FIELDS) {
    const v = rec[key];
    if (typeof v === "string" && v.length > 0) {
      paths.push(v);
    }
  }
  return paths;
}

/**
 * 单条路径是否落在 `prefix` 之下。
 *
 * @remarks
 * `prefix` 是相对 session root 的逻辑前缀；自动忽略尾部斜杠。
 * 同时容忍 `/` 与 `\` 两种分隔符，方便 Windows 端直接复用。
 * 空前缀或 `/` 表示「整个工作区」，恒为通过。
 */
export function pathStartsWithPrefix(path: string, prefix: string): boolean {
  if (prefix === "" || prefix === "/" || prefix === "\\") {
    return true;
  }
  const normalizedPrefix = prefix.endsWith("/") || prefix.endsWith("\\")
    ? prefix.slice(0, -1)
    : prefix;
  if (path === normalizedPrefix) {
    return true;
  }
  return (
    path.startsWith(normalizedPrefix + "/") ||
    path.startsWith(normalizedPrefix + "\\")
  );
}

/**
 * 单条路径是否被 `allowedPaths` 放行。
 *
 * `allowedPaths === undefined` 表示不限制（向后兼容）。
 */
export function isPathAllowed(
  path: string,
  allowedPaths?: readonly string[],
): boolean {
  if (allowedPaths === undefined) {
    return true;
  }
  return allowedPaths.some((prefix) => pathStartsWithPrefix(path, prefix));
}

/**
 * 在所有路径里找出第一条越界的；全部放行返回 `null`。
 *
 * 给 `ToolRunner.call()` 用——它只需要知道「是否要拒」以及「拒哪条路径」，
 * 不需要知道每条具体校验过程。
 */
export function findDisallowedPath(
  paths: readonly string[],
  allowedPaths?: readonly string[],
): string | null {
  if (allowedPaths === undefined) {
    return null;
  }
  for (const p of paths) {
    if (!isPathAllowed(p, allowedPaths)) {
      return p;
    }
  }
  return null;
}

/**
 * 鸭子读 ctx 上的 `allowedPaths` 字段（不强制 ctx 必须是 BuiltinToolContext）。
 *
 * @remarks
 * `ToolRunner` 是 `Ctx = unknown` 的泛型，这里用 duck typing 把 path
 * policy 与具体上下文类型解耦：只要 ctx 长得像 `{ allowedPaths?: string[] }`
 * 就能套上策略。
 */
export function readAllowedPaths(
  ctx: unknown,
): readonly string[] | undefined {
  if (typeof ctx !== "object" || ctx === null) {
    return undefined;
  }
  if (!("allowedPaths" in ctx)) {
    return undefined;
  }
  const v = (ctx as { allowedPaths?: unknown }).allowedPaths;
  if (v === undefined || v === null) {
    return undefined;
  }
  if (Array.isArray(v)) {
    return v as readonly string[];
  }
  return undefined;
}

/**
 * 一次性把策略跑完，返回首个越界路径或 `null`。
 *
 * 这是 `ToolRunner.call()` 实际调的入口——把 input 抽取与 ctx 读取封装在一起，
 * runner 那边只关心结果。
 */
export function checkToolPathPolicy(
  input: unknown,
  ctx: unknown,
): string | null {
  const allowedPaths = readAllowedPaths(ctx);
  const paths = extractInputPaths(input);
  return findDisallowedPath(paths, allowedPaths);
}
