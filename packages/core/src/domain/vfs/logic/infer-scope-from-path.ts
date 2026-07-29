/**
 * 物理路径反解为 scope_key + 纯逻辑路径（迁移专用）。
 *
 * 旧库 `vfs_entry.path` 存的是带 scope 物理前缀的完整路径（如
 * `/projects/{pid}/sessions/{sid}/原著/第01部/(01).md`）。entry_id 化后 `path` 列
 * 降级为纯逻辑路径（如 `/原著/第01部/(01).md`），scope 信息独立成 `scope_key` 列。
 * 本函数负责迁移回填时把物理路径拆成 `(scope_key, 逻辑路径)` 两个字段。
 *
 * 反解顺序很关键：必须先判 `/projects/` 前缀再判 `/template`，否则
 * `/projects/{pid}/template/...` 会被 `/template` 规则误判为 global scope。
 *
 * @module domain/vfs/logic/infer-scope-from-path
 */

/** 物理路径反解结果。 */
export interface InferredScope {
  /** scope 归属键，如 `session:{pid}:{sid}` / `project:{pid}` / `global`。 */
  readonly scopeKey: string;
  /** 去掉物理前缀后的纯逻辑路径，如 `/原著/第01部/(01).md`。 */
  readonly logicalPath: string;
}

// 三条物理前缀规则。顺序敏感：先 session（最具体的子串 `/sessions/`），再
// project template（`/projects/{pid}/template`），最后 global template（`/template`）。
// 之所以按这个顺序，是因为 project template 也以 `/projects/` 开头，若先判 global 的
// `/template` 前缀就会把 `/projects/{pid}/template` 错配到 global 上。
const SESSION_RE = /^\/projects\/([^/]+)\/sessions\/([^/]+)(\/.*)?$/;
const PROJECT_TEMPLATE_RE = /^\/projects\/([^/]+)\/template(\/.*)?$/;
const GLOBAL_TEMPLATE_RE = /^\/template(\/.*)?$/;

/**
 * 把旧库的物理 path 反解为 `{ scopeKey, logicalPath }`。
 *
 * 规则（按 SPEC「scope_key 编码规则」表）：
 * - `/projects/{pid}/sessions/{sid}...` → `session:{pid}:{sid}` + 去前缀
 * - `/projects/{pid}/template...` → `project:{pid}` + 去前缀
 * - `/template...` → `global` + 去前缀
 * - 其他 → 抛 `INVALID_PATH`
 *
 * @param physicalPath - 旧库 `vfs_entry.path` 列的物理路径
 * @throws {Error} 当路径不符合任何已知 scope 前缀时，抛出带 `INVALID_PATH` 前缀的错误
 */
export function inferScopeFromPhysicalPath(
  physicalPath: string,
): InferredScope {
  const sessionMatch = physicalPath.match(SESSION_RE);
  if (sessionMatch != null) {
    const [, pid, sid, rest] = sessionMatch;
    return {
      scopeKey: `session:${pid}:${sid}`,
      logicalPath: rest ?? "",
    };
  }

  const projectMatch = physicalPath.match(PROJECT_TEMPLATE_RE);
  if (projectMatch != null) {
    const [, pid, rest] = projectMatch;
    return {
      scopeKey: `project:${pid}`,
      logicalPath: rest ?? "",
    };
  }

  const globalMatch = physicalPath.match(GLOBAL_TEMPLATE_RE);
  if (globalMatch != null) {
    const [, rest] = globalMatch;
    return {
      scopeKey: "global",
      logicalPath: rest ?? "",
    };
  }

  throw new Error(
    `INVALID_PATH: 无法从物理路径反解 scope: ${physicalPath}`,
  );
}
