import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const settingsViewsPath = path.join(
  __dirname,
  "..",
  "renderer",
  "features",
  "settings",
  "SettingsViews.tsx",
);
/** 迁移行定义与取值逻辑所在纯函数模块（ic-22 抽出，label 字面量在彼处）。 */
const migrationRowsModulePath = path.join(
  __dirname,
  "..",
  "renderer",
  "features",
  "settings",
  "migration-row-value.ts",
);

/** 提取函数源码片段（从声明行到函数体收尾的 `};`）。 */
function extractFunction(source: string, name: string): string {
  const start = source.indexOf(`const ${name} = async () => {`);
  assert.ok(start >= 0, `${name} 未找到`);
  const end = source.indexOf("\n  };", start);
  assert.ok(end > start, `${name} 函数体未闭合`);
  return source.slice(start, end);
}

describe("SettingsViews 数据清理 UI（T-UID1）", () => {
  const source = readFileSync(settingsViewsPath, "utf8");

  it("数据清理分区展示库体积与可回收量，失败回退占位 '—'", () => {
    assert.match(source, /title="数据清理"/);
    assert.match(
      source,
      /当前库体积 \$\{dbStats \? formatStorageBytes\(dbStats\.fileBytes\) : "—"\}/,
    );
    assert.match(
      source,
      /可回收约 \$\{dbStats \? formatStorageBytes\(dbStats\.reclaimableBytes\) : "—"\}/,
    );
  });

  it("清理按钮挂 ConfirmModal 二次确认", () => {
    assert.match(
      source,
      /onClick=\{\(\) => setConfirmMaintenance\(true\)\}>\s*\n\s*清理/,
    );
    assert.match(source, /open=\{confirmMaintenance\}/);
    assert.match(source, /title="确认清理"/);
    assert.match(source, /耗时随库体积增长/);
    assert.match(
      source,
      /onConfirm=\{\(\) => void runMaintenance\(\)\}/,
    );
  });

  it("controlsDisabled 纳入 maintenanceBusy", () => {
    assert.match(source, /status\?\.maintenanceBusy === true/);
  });

  it("执行前置 busy：setBusy(true) 先于 invoke ipcDbMaintenance", () => {
    const body = extractFunction(source, "runMaintenance");
    const busyAt = body.indexOf("setBusy(true)");
    const invokeAt = body.indexOf("await ipcDbMaintenance()");
    assert.ok(busyAt >= 0, "runMaintenance 内未找到 setBusy(true)");
    assert.ok(invokeAt > busyAt, "setBusy(true) 必须在 invoke 之前");
  });

  it("结果反馈：成功含前后体积对比，失败走 toastSettingsError", () => {
    const body = extractFunction(source, "runMaintenance");
    assert.match(
      body,
      /formatStorageBytes\(res\.data\.beforeBytes\)/,
    );
    assert.match(
      body,
      /formatStorageBytes\(res\.data\.afterBytes\)/,
    );
    assert.match(body, /toastSettingsError\(res\.error\.message\)/);
  });
});

describe("SettingsViews 存量数据迁移卡片（指标卡形态，用户拍板 2026-09-28）", () => {
  const source = readFileSync(settingsViewsPath, "utf8");
  /** 迁移行定义随取值逻辑抽到同目录纯函数模块（ic-22），label 字面量在彼处。 */
  const migrationRowsSource = readFileSync(migrationRowsModulePath, "utf8");

  it("三行进度：消息正文明文化 + 版本内容去 base64 + 文件缓存去 base64", () => {
    assert.match(source, /title="存量数据迁移"/);
    assert.match(migrationRowsSource, /label: "消息正文明文化"/);
    assert.match(migrationRowsSource, /label: "版本内容去 base64"/);
    assert.match(migrationRowsSource, /label: "文件缓存去 base64"/);
  });

  it("cr-06 第三态：done 且 failedCount > 0 显示「已完成（N 条需人工处理）」", () => {
    assert.match(migrationRowsSource, /failedCount > 0/);
    assert.match(migrationRowsSource, /条需人工处理/);
  });

  it("消息正文「去 base64」不设状态行（发版形态无用户可见中间态）", () => {
    assert.doesNotMatch(source, /消息正文去 base64/);
  });
});

describe("SettingsViews 存量数据迁移卡片（cr-17 / cr-18 / cr-20b / ic-22 源码契约）", () => {
  const source = readFileSync(settingsViewsPath, "utf8");
  const migrationRowsSource = readFileSync(migrationRowsModulePath, "utf8");
  /** 迁移卡片 JSX 段：从分区标题到「数据清理」分区之间的片段。 */
  const migrationSection = (() => {
    const start = source.indexOf('title="存量数据迁移"');
    const end = source.indexOf('title="数据清理"', start);
    assert.ok(start > 0 && end > start, "迁移卡片段未找到");
    return source.slice(start, end);
  })();

  it("cr-17：三行状态行用 settings-row 类族，不用 settings-field / 内联缩进", () => {
    assert.match(migrationSection, /settings-row__label/);
    assert.match(migrationSection, /settings-row__value/);
    assert.doesNotMatch(migrationSection, /settings-field__/);
    assert.doesNotMatch(migrationSection, /marginLeft/);
  });

  it("cr-20b：表顺序无双份平行常量（无独立 BLOB_BINARY_TABLE_ORDER 字面量声明）", () => {
    // 指标卡形态下顺序由 MIGRATION_ROWS 单一事实源承担；钉死不得回退到
    // 「LABELS + ORDER 两份平行常量」的旧形态。
    assert.doesNotMatch(source, /const BLOB_BINARY_TABLE_ORDER/);
    assert.doesNotMatch(source, /const BLOB_BINARY_TABLE_LABELS/);
  });

  it("ic-18：tone 三态着色走主题变量，无 #a60 兜底", () => {
    assert.match(source, /tone === "success"/);
    assert.match(source, /tone === "warning"/);
    assert.match(migrationSection, /var\(--success\)/);
    assert.match(migrationSection, /var\(--warning\)/);
    assert.doesNotMatch(source, /#a60/);
  });

  it("ic-22：迁移取值逻辑走同目录纯函数模块（可被测试直接 import）", () => {
    assert.match(source, /from "\.\/migration-row-value"/);
    assert.match(source, /MIGRATION_ROWS/);
    assert.match(source, /migrationRowValue\(dbStats, row\)/);
  });

  it("ic-04：消息解压状态行 null 分支显示占位 '—'（三态口径）", () => {
    // null → '—' 的分支行为由 test/migration-row-value.test.ts 的夹具直测；
    // 此处锁纯函数模块里消费的是升级后可空 DTO（status == null → '—'）。
    assert.match(migrationRowsSource, /dbStats\?\.messageDecompress/);
    assert.match(migrationRowsSource, /status == null/);
    // 行 kind/label 换向钉死：防止回退成旧的压缩语义与旧字段名。
    assert.match(migrationRowsSource, /kind: "messageDecompress"/);
    assert.match(migrationRowsSource, /label: "消息正文明文化"/);
    assert.doesNotMatch(migrationRowsSource, /messageCompaction/);
  });
});
