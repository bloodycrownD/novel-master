/**
 * T-ATD2/3/4 / T-AT3：Mobile `@路径` token 口径（纯函数域）。
 *
 * ## Step 8 后的测试面收缩
 *
 * 本文件原先还有一段「组件层」用例（挂 `ComposerAtPathInput`，断 `init.theme`
 * 带 `tokens.selection`、打字不回写、5 行封顶 metrics、`replaceCommittedText`
 * → `setText{text, selection}`）。`ComposerAtPathInput.tsx` 随 legacy RN 转录
 * 引擎退役删除，组件没有了，这些断言全部迁到统一宿主
 * `ChatConversationWebView` 的等价用例（见 `chat-conversation-webview.test.tsx`）：
 *
 * | 原用例 | 现落点 |
 * | --- | --- |
 * | T-SC1 `init.theme.selection` | T-CU2 恢复链载荷（init 聚合 theme，含 selection 键） |
 * | 带 token 打字不丢 token（v1.5.9 回归） | M1/M6 web change 先推进基线再上抛 |
 * | 打字回流不被当成外部写入 | M4 setSelection 回声抑制 / M6 |
 * | 5 行封顶 metrics（maxHeight 122） | T-CU2 恢复链载荷的 metrics 六值 |
 * | `replaceCommittedText` → setText 带选区 | M7 命令式 `setComposerText` 带选区 |
 *
 * 留在本文件的是**纯函数域**：`composer-at-path.ts` 的 token 生成 / 扫描 /
 * 候选过滤 / 活动查询（函数本体没删——web 侧 typeahead 与 RN 侧 Picker 仍在用）。
 */
import {describe, expect, it} from '@jest/globals';
import {
  partitionComposerChipAttachments,
  scanAtPathAttachments,
} from '@novel-master/core/chat';
import {
  atPathTokensFromPickerSelection,
  countScannedAtPathAttachments,
  filterAtPathTypeaheadCandidates,
  findActiveAtQuery,
  formatComposerAtPathToken,
  replaceActiveAtWithToken,
} from '@/components/chat/composer-at-path';

describe('composer-at-path 纯函数域 (T-ATD* / T-AT*)', () => {
  it('T-ATD2: Picker token 为 @path；目录尾 /；扫描落库带前导 /', () => {
    const tokens = atPathTokensFromPickerSelection(['/notes'], ['/a.md']);
    expect(tokens).toEqual(['@/notes/', '@/a.md']);
    const scanned = scanAtPathAttachments(tokens.join(' '));
    expect(scanned).toHaveLength(2);
    expect(scanned[0]!.path).toBe('/notes/');
    expect(scanned[0]!.type).toBe('dir');
    expect(scanned[1]!.path).toBe('/a.md');
    expect(scanned.every(a => a.path!.startsWith('/'))).toBe(true);
  });

  it('T-ATD3: 手输 @ 搜索 ≤5，点选插入完整 @path', () => {
    const refs = [
      {path: '/a.md', kind: 'file' as const},
      {path: '/ab.md', kind: 'file' as const},
      {path: '/abc.md', kind: 'file' as const},
      {path: '/abcd.md', kind: 'file' as const},
      {path: '/abcde.md', kind: 'file' as const},
      {path: '/abcdef.md', kind: 'file' as const},
    ];
    expect(filterAtPathTypeaheadCandidates(refs, 'a', 5)).toHaveLength(5);

    const active = findActiveAtQuery('见 @ab', 5);
    expect(active).not.toBeNull();
    expect(active!.query).toBe('ab');
    const token = formatComposerAtPathToken('/ab.md', false);
    const next = replaceActiveAtWithToken('见 @ab', 5, active!.start, token);
    expect(next.text).toBe('见 @/ab.md ');
  });

  it('findActiveAtQuery: @/a.md 无尾空格为活跃；带尾空格则关闭', () => {
    const bare = '@/a.md';
    expect(findActiveAtQuery(bare, bare.length)).not.toBeNull();
    expect(findActiveAtQuery(bare, bare.length)!.query).toBe('/a.md');
    expect(findActiveAtQuery(`${bare} `, `${bare} `.length)).toBeNull();
  });

  it('T-ATD4: 删除正文 @path 后扫描为空', () => {
    expect(countScannedAtPathAttachments('看 @/a.md')).toBe(1);
    expect(countScannedAtPathAttachments('看')).toBe(0);
  });

  it('T-AT3: 仅 @path 扫描为 source:attach，不进状态 chip', () => {
    const scanned = scanAtPathAttachments('请看 @/a.md');
    expect(scanned.length).toBeGreaterThan(0);
    expect(scanned.every(a => a.source === 'attach')).toBe(true);
    const {status, attach} = partitionComposerChipAttachments(scanned);
    expect(status).toHaveLength(0);
    expect(attach).toHaveLength(scanned.length);
  });
});
