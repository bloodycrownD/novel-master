import type { DbStatsResult } from "@shared/ipc-types";

/**
 * 存量数据迁移卡片的三行进度（用户拍板 2026-09-28）：消息正文压缩 +
 * 两张 blob 表去 base64，只读状态行（非菜单项）。消息正文「去 base64」
 * 不设状态行——发版形态下压缩搬运直接写二进制，不存在用户可见的中间
 * 态，仅开发机历史形态由归一任务静默收敛。
 *
 * 抽成同目录纯 ts 模块的原因（ic-22）：渲染取值要被测试直接 import 喂
 * 夹具断言四组分支（null→'—' / done→已完成 / 进行中 / 第三态），留在
 * SettingsViews.tsx 里会把 React 组件树与 electron preload 依赖一起拖进
 * 测试进程。
 */
export const MIGRATION_ROWS = [
  { kind: "messageCompaction", label: "消息正文压缩" },
  { kind: "vfsContent", label: "版本内容去 base64" },
  { kind: "fileCache", label: "文件缓存去 base64" },
] as const;

/**
 * 迁移状态行取值：文案 + tone 三态着色（ic-18，对齐 mobile 的
 * default/success/warning 三态）——已完成 → success；第三态
 * （已完成但存在坏行）→ warning；进行中/未取到 → default。
 */
export type MigrationRowValue = {
  readonly text: string;
  readonly tone: "default" | "success" | "warning";
};

/**
 * 单行迁移状态文案（cr-06 三态 + ic-04 未取到）：
 * 已完成 / 已完成（N 条需人工处理）/ 进行中（剩余 N 条）/ 未取到 '—'。
 */
export function migrationRowValue(
  dbStats: DbStatsResult | null,
  row: (typeof MIGRATION_ROWS)[number],
): MigrationRowValue {
  if (row.kind === "messageCompaction") {
    const status = dbStats?.messageCompaction;
    if (status == null) {
      return { text: "—", tone: "default" };
    }
    return status.done
      ? { text: "已完成", tone: "success" }
      : { text: `进行中（剩余 ${status.pendingCount} 条）`, tone: "default" };
  }
  const status = dbStats?.blobBinary.tables.find(
    (item) => item.table === row.kind,
  );
  if (!status) {
    return { text: "—", tone: "default" };
  }
  if (status.done) {
    return status.failedCount > 0
      ? {
          text: `已完成（${status.failedCount} 条需人工处理）`,
          tone: "warning",
        }
      : { text: "已完成", tone: "success" };
  }
  return { text: `进行中（剩余 ${status.pendingCount} 条）`, tone: "default" };
}
