/**
 * 桌面诊断动作：打开日志目录 / 导出诊断包（seams 全量注入，不碰真实磁盘）。
 */
import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { exportDiagnostics, openLogsDirectory, type DiagnosticsSeams } from "../src/main/log/desktop-diagnostics.js";

function fakeSeams(overrides: Partial<DiagnosticsSeams> = {}): {
  readonly seams: DiagnosticsSeams;
  readonly copied: Array<{ source: string; target: string }>;
  readonly written: Array<{ file: string; data: string }>;
  readonly opened: string[];
} {
  const copied: Array<{ source: string; target: string }> = [];
  const written: Array<{ file: string; data: string }> = [];
  const opened: string[] = [];
  const seams: DiagnosticsSeams = {
    logsDir: path.join("/tmp", "nm-logs"),
    readdir: async () => ["b.log", "a.log", "notes.txt"],
    stat: async (file) => ({ size: path.basename(file) === "a.log" ? 10 : 20 }),
    showOpenDialog: async () => ({ canceled: false, filePaths: [path.join("/tmp", "out")] }),
    mkdir: async () => undefined,
    copyFile: async (source, target) => {
      copied.push({ source, target });
    },
    writeFile: async (file, data) => {
      written.push({ file, data });
    },
    openPath: async (target) => {
      opened.push(target);
      return "";
    },
    now: () => new Date(2026, 10, 7, 12, 34, 56),
    appVersion: "9.9.9",
    platform: "win32",
    arch: "x64",
    packaged: true,
    ...overrides,
  };
  return { seams, copied, written, opened };
}

describe("openLogsDirectory", () => {
  it("把 logs 目录交给系统文件管理器", async () => {
    const { seams, opened } = fakeSeams();
    await openLogsDirectory(seams);
    assert.deepEqual(opened, [seams.logsDir]);
  });
});

describe("exportDiagnostics", () => {
  it("枚举 *.log → 复制 → 写 meta.json → 打开新目录", async () => {
    const { seams, copied, written, opened } = fakeSeams();
    const targetDir = path.join("/tmp", "out", "nm-diagnostics-20261107-123456");

    const result = await exportDiagnostics(seams);

    assert.equal(result, targetDir);
    assert.deepEqual(
      copied.map((entry) => [path.basename(entry.source), path.dirname(entry.target)]),
      [
        ["a.log", targetDir],
        ["b.log", targetDir],
      ],
    );
    assert.equal(written.length, 1);
    assert.equal(written[0]!.file, path.join(targetDir, "meta.json"));
    const meta = JSON.parse(written[0]!.data) as {
      appVersion: string;
      platform: string;
      arch: string;
      packaged: boolean;
      generatedAt: string;
      files: Array<{ name: string; bytes: number }>;
    };
    assert.equal(meta.appVersion, "9.9.9");
    assert.equal(meta.platform, "win32");
    assert.equal(meta.arch, "x64");
    assert.equal(meta.packaged, true);
    assert.equal(meta.generatedAt, new Date(2026, 10, 7, 12, 34, 56).toISOString());
    assert.deepEqual(meta.files, [
      { name: "a.log", bytes: 10 },
      { name: "b.log", bytes: 20 },
    ]);
    assert.deepEqual(opened, [targetDir]);
  });

  it("取消选择时不建目录、不复制", async () => {
    const { seams, copied, written, opened } = fakeSeams({ showOpenDialog: async () => ({ canceled: true, filePaths: [] }) });

    const result = await exportDiagnostics(seams);

    assert.equal(result, undefined);
    assert.deepEqual(copied, []);
    assert.deepEqual(written, []);
    assert.deepEqual(opened, []);
  });
});
