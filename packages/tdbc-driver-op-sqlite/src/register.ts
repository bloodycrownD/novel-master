/**
 * op-sqlite 驱动注册的共享实现（内部单点）。
 *
 * `index.ts` 与 `native.ts` 两个入口的 `registerOpSqliteDriver` 是平行
 * 实现（默认 adapter 不同：动态加载 / 原生静态绑定），统一转发到这里：
 * 单点实现、两入口天然一致，杜绝「只改 index.ts 漏掉 native.ts」的分叉。
 *
 * @module tdbc-driver-op-sqlite/register
 * @internal
 */

import { registerDriver } from "@novel-master/core";
import type { OpSqliteAdapter } from "./adapter.js";
import { OpSqliteDriver } from "./driver.js";

/**
 * 注册 op-sqlite 驱动为 `op-sqlite`（入口转发目标）。
 *
 * @param adapter - 默认 adapter，由入口决定（动态加载 / 原生静态绑定）。
 * @param isBackground - 可选后台探测函数，由 app 层注入（如 RN
 *   `AppState.currentState === 'background'`）。返回 true 时事务内跳过
 *   休眠量子让步、连续执行——RN 后台 JS 定时器停摆，`setTimeout(0)`
 *   让步会让事务挂死到回前台；后台无 UI 交互可阻塞、其他 DB 使用者
 *   同样停摆，持锁延长无碍；回前台即恢复让步节奏。未注入
 *   （desktop/CLI/测试默认）恒按前台口径让步，行为与现状一致。驱动包
 *   保持零依赖、不 import RN API，探测函数由 app 层经此注入。
 */
export function registerOpSqliteDriverWith(
  adapter: OpSqliteAdapter,
  isBackground?: () => boolean,
): void {
  registerDriver(new OpSqliteDriver(adapter, isBackground));
}
