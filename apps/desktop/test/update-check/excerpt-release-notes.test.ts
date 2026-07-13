import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { excerptReleaseNotes } from "../../src/main/update-check/excerpt-release-notes.js";

const WORKFLOW_BODY = `# Novel Master v1.0.3

## 更新说明

### 修复
- 停止对话后保留已生成内容

## 下载 · Android

| APK | ABI |
| --- | --- |
| NovelMaster-1.0.3-universal.apk | 通用 (fat) |

**安装提示：** 多数手机请下载 universal。

## 下载 · Desktop

| 平台 | 文件 |
| --- | --- |
| Windows (NSIS) | NovelMaster-1.0.3-windows-setup.exe |

**安装提示：** 安装包未签名。`;

const LEGACY_BODY = `# Novel Master v1.0.3

## Android

| APK | ABI |
| --- | --- |
| NovelMaster-1.0.3-universal.apk | all (fat) |

**Install tip:** use universal on most phones.

## Desktop

| Platform | File |
| --- | --- |
| Windows (NSIS) | NovelMaster-1.0.3-windows-setup.exe |

**Desktop note:** installers are unsigned.`;

describe("excerptReleaseNotes", () => {
  it("prefers 更新说明 over platform sections", () => {
    const text = excerptReleaseNotes(WORKFLOW_BODY, "desktop");
    assert.match(text, /保留已生成内容/);
    assert.doesNotMatch(text, /universal\.apk/);
    assert.doesNotMatch(text, /未签名/);
  });

  it("prefers 更新说明 for mobile focus too", () => {
    const text = excerptReleaseNotes(WORKFLOW_BODY, "mobile");
    assert.match(text, /保留已生成内容/);
    assert.doesNotMatch(text, /windows-setup/);
  });

  it("falls back to 下载 · Desktop section without tables", () => {
    const body = `# v1.0.3

## 下载 · Desktop

| 平台 | 文件 |
| --- | --- |
| Windows | setup.exe |

**安装提示：** 安装包未签名。`;
    const text = excerptReleaseNotes(body, "desktop");
    assert.ok(!text.includes("|"));
    assert.match(text, /未签名/);
  });

  it("falls back to legacy Desktop section", () => {
    const text = excerptReleaseNotes(LEGACY_BODY, "desktop");
    assert.ok(!text.includes("|"));
    assert.match(text, /unsigned/i);
    assert.doesNotMatch(text, /universal\.apk/);
  });

  it("falls back to legacy Android section for mobile focus", () => {
    const text = excerptReleaseNotes(LEGACY_BODY, "mobile");
    assert.ok(!text.includes("|"));
    assert.match(text, /universal/i);
    assert.doesNotMatch(text, /windows-setup/);
  });

  it("returns fallback when body is empty", () => {
    const text = excerptReleaseNotes("", "desktop");
    assert.match(text, /GitHub Releases/);
  });
});
