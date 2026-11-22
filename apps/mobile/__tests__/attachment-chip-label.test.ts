/**
 * attachmentChipLabel：消息附件中文 action:path。
 */
import {describe, expect, it} from '@jest/globals';
import {RowLogic} from '@/web/chat-transcript/webview/runtime/render/row-logic';
import {CORE_CATALOGS, createTranslator} from '@novel-master/core/i18n';

const zhT = createTranslator(CORE_CATALOGS, 'zh-CN');
// descriptor 化兼容 shim：断言保持旧字符串口径（zh 渲染逐字一致）。
const attachmentChipLabel = (a: Parameters<typeof RowLogic.attachmentChipDescriptor>[0]): string => {
    const d = RowLogic.attachmentChipDescriptor(a);
    return d == null ? '' : zhT(d as never);
};

describe('attachmentChipLabel', () => {
    it('user_ops + action → 中文二字:path', () => {
        expect(
            attachmentChipLabel({
                source: 'user_ops',
                type: 'text',
                name: '/a.md',
                path: '/a.md',
                action: 'write',
            }),
        ).toBe('创建:/a.md');
        expect(
            attachmentChipLabel({
                source: 'user_ops',
                name: '/n.md',
                path: '/n.md',
                action: 'annotate',
            }),
        ).toBe('批注:/n.md');
    });

    it('T-CR8: workplace + action/无 action → 规则:path', () => {
        expect(
            attachmentChipLabel({
                source: 'workplace',
                name: '/r.md',
                path: '/r.md',
                action: 'workplaceChange',
            }),
        ).toBe('规则:/r.md');
        expect(
            attachmentChipLabel({
                source: 'workplace',
                name: '/r.md',
                path: '/r.md',
            }),
        ).toBe('规则:/r.md');
    });

    it('无 action 旧 name=write:/x → 创建:/x', () => {
        expect(
            attachmentChipLabel({
                source: 'user_ops',
                name: 'write:/ops.md',
                path: '/ops.md',
            }),
        ).toBe('创建:/ops.md');
    });

    it('attach → @path（不进中文状态口径）', () => {
        expect(
            attachmentChipLabel({
                source: 'attach',
                name: '/a.md',
                path: '/a.md',
                action: 'userAttach',
            }),
        ).toBe('@/a.md');
    });
});
