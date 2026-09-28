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

  it("三行进度：消息正文压缩 + 版本内容去 base64 + 文件缓存去 base64", () => {
    assert.match(source, /title="存量数据迁移"/);
    assert.match(source, /label: "消息正文压缩"/);
    assert.match(source, /label: "版本内容去 base64"/);
    assert.match(source, /label: "文件缓存去 base64"/);
  });

  it("cr-06 第三态：done 且 failedCount > 0 显示「已完成（N 条需人工处理）」", () => {
    assert.match(source, /failedCount > 0/);
    assert.match(source, /条需人工处理/);
  });

  it("消息正文「去 base64」不设状态行（发版形态无用户可见中间态）", () => {
    assert.doesNotMatch(source, /消息正文去 base64/);
  });
});
