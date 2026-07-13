import {excerptReleaseNotes} from '../../src/update-check/excerpt-release-notes';

const WORKFLOW_BODY = `# Novel Master v1.0.3

## 更新说明

### 修复
- 停止对话后保留已生成内容

## 下载 · Android

| APK | ABI |
| --- | --- |
| NovelMaster-1.0.3-universal.apk | 通用 (fat) |

**安装提示：** 多数手机请下载 universal。`;

describe('excerptReleaseNotes', () => {
  it('prefers 更新说明 over platform tables', () => {
    const text = excerptReleaseNotes(WORKFLOW_BODY, 'mobile');
    expect(text).not.toMatch(/\|/);
    expect(text).toMatch(/保留已生成内容/);
    expect(text).not.toMatch(/universal\.apk/);
  });

  it('falls back to legacy Android section', () => {
    const body = `## Android

| APK | ABI |
| --- | --- |
| NovelMaster-1.0.3-universal.apk | all (fat) |

Install tip: use universal.`;
    const text = excerptReleaseNotes(body, 'mobile');
    expect(text).not.toMatch(/\|/);
    expect(text).toMatch(/universal/i);
  });
});
