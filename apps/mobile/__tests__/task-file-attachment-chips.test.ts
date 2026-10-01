/**
 * T-TA4：task `fileAttachment` 落到子会话后，附件在**行渲染**里出 `@path` chip 文案。
 *
 * 背景（task-attach-unref spec 测试策略 T-TA4，blocking: yes / Step11）：
 * `SubagentSessionScreen` 复用主会话的 `ChatTranscriptWebView`（见该屏文件头注释），
 * 因此子会话屏的附件 chip 走的就是「`buildTranscriptRows` 出行模型 → `MessageRow`
 * 挂 `AttachGroup` → chip 标签取 `row-logic.ts` 的 `attachmentChipLabel`」这一条链。
 * desktop 本版无子会话渲染链，不覆盖。
 *
 * 观测面与既有 attach 分支断言同款（对照 `attachment-chip-label.test.ts` 与
 * `build-transcript-rows.test.ts`），但走完整两跳（行模型 + 行渲染），而不是直接
 * 调标签函数——chip 分支被删掉即红。
 *
 * 形态取自 core 侧 `attachmentsFromPaths` 的落库口径（`source:"attach"` +
 * `action:"userAttach"` + `type:"text"` + `content:null` + `name = attachmentStorageName(path)`），
 * 与 T-TA1 牙齿同源：name 写成 basename 会被落库硬 parse 拒掉。
 */
import type {VNode} from 'preact';
import {
  attachmentStorageName,
  type ChatMessage,
  type MessageAttachment,
} from '@novel-master/core/chat';
import {buildTranscriptRows} from '@/components/chat/message-blocks';
import {MessageRow} from '@/web/chat-transcript/webview/ui/render/MessageRow';
import {AttachGroup} from '@/web/chat-transcript/webview/ui/render/AttachGroup';
import type {AttachmentChip} from '@/web/chat-transcript/webview/runtime/state/state';

/** 子会话屏里 task 挂上来的文本附件（与 core `attachmentsFromPaths` 出口同形）。 */
function userAttachAttachment(path: string): MessageAttachment {
  return {
    name: attachmentStorageName(path),
    source: 'attach',
    type: 'text',
    content: null,
    path,
    action: 'userAttach',
  };
}

/** 造子会话首条 user 消息（附件挂在这条消息上）。 */
function childSessionUserMessage(attachments: MessageAttachment[]): ChatMessage {
  return {
    id: 'child-u1',
    sessionId: 'child-1',
    seq: 1,
    role: 'user',
    content: {blocks: [{type: 'text', text: '看这两份设定'}]},
    attachments,
    provider: null,
    raw: null,
    hidden: false,
    createdAtMs: 1,
  };
}

/** 递归收集 vnode 树里的全部文本节点（preact 未挂载，直接读 props.children）。 */
function collectText(node: unknown, out: string[] = []): string[] {
  if (node == null || node === false || node === true) {
    return out;
  }
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node));
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      collectText(child, out);
    }
    return out;
  }
  if (typeof node === 'object' && 'props' in (node as VNode)) {
    collectText((node as VNode).props.children, out);
  }
  return out;
}

/**
 * 从 user 行的 vnode 树里摘出 AttachGroup 元素（渲染 chip 的那段）。
 *
 * 已知耦合点：按 vnode type 的函数名 === 'AttachGroup' 匹配——生产构建若做压缩/匿名化
 * 或组件改名，此处会以「user 行未挂上 AttachGroup」红掉（不假绿）；重构 AttachGroup 时须同步本选择器。
 */
function pickAttachGroup(vnode: VNode): VNode {
  const found = collectVNodes(vnode).find(
    n =>
      typeof n.type === 'function' &&
      (n.type as {name?: string}).name === 'AttachGroup',
  );
  if (found == null) {
    throw new Error('user 行未挂上 AttachGroup（附件没进渲染树）');
  }
  return found;
}

function collectVNodes(node: unknown, out: VNode[] = []): VNode[] {
  if (node == null || typeof node !== 'object') {
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      collectVNodes(child, out);
    }
    return out;
  }
  const vnode = node as VNode;
  if (typeof vnode.type === 'function' || typeof vnode.type === 'string') {
    out.push(vnode);
  }
  collectVNodes(vnode.props?.children, out);
  return out;
}

/**
 * 走完「AttachGroup → CollapsibleSection 展开体」，拿到每枚 chip 的主标签文案。
 *
 * preact 未挂载，直接以函数调用形态逐层求值 vnode（与 `collapsible-section-classes`
 * 既有测试同款）：先调 `AttachGroup` 拿到 `<CollapsibleSection>{chips}</CollapsibleSection>`，
 * 再调 `CollapsibleSection` 拿到展开体容器，最后递归收集每枚 chip 的全部文本（不按下标穿透 chip 内部结构）。
 */
function renderChipLabels(
  attachments: AttachmentChip[],
  expanded = true,
): string[] {
  const sectionEl = AttachGroup({
    attachments,
    groupKey: 'attach:child-u1',
    expanded,
    showDividerAbove: true,
  }) as VNode;
  const section = (sectionEl.type as (props: unknown) => VNode)(sectionEl.props);
  // 已知耦合点：CollapsibleSection 展开体固定在 props.children 的第二项（tool-group-items），
  // 折叠态下为 null → 不渲染任何 chip；CollapsibleSection 的 children 形状变化时须同步此行。
  const items = (section.props.children as (VNode | null)[])[1];
  if (items == null) {
    return [];
  }
  const chips = items.props.children as VNode[];
  // chip 文案用递归收集（不按 children 下标穿透——chip 内部结构变化不致误红）。
  return chips.map(chip => collectText(chip).join(''));
}

describe('T-TA4 子会话附件 chip 行渲染（task fileAttachment）', () => {
  it('source:attach + action:userAttach → 行渲染出 `@path` chip 文案', () => {
    const path = '/notes/setting.md';
    const rows = buildTranscriptRows([
      childSessionUserMessage([userAttachAttachment(path)]),
    ]);
    const row = rows[0]!;
    expect(row.kind).toBe('message');
    // 牙齿（与 T-TA1 同源）：name 必须仍是 storageName 口径，basename 形态落库会被拒。
    const chips = (row as {attachments?: AttachmentChip[]}).attachments!;
    expect(chips[0]).toMatchObject({
      source: 'attach',
      type: 'text',
      action: 'userAttach',
      path,
    });
    expect(chips[0]!.name).toBe(attachmentStorageName(path));
    expect(chips[0]!.name).not.toBe('setting.md');

    // 行渲染：user 行挂 AttachGroup → chip 文案走 row-logic 的 attachmentChipLabel。
    const attachGroup = pickAttachGroup(MessageRow({row: row as never}));
    const attachProps = attachGroup.props as unknown as {
      attachments: AttachmentChip[];
    };
    expect(attachProps.attachments).toHaveLength(1);
    // 集合语义：chip 递归文本可能含徽标等附加文案，断言包含即可（消除下标精确匹配的白盒耦合）。
    expect(renderChipLabels(attachProps.attachments)[0]).toContain(`@${path}`);
    // 折叠态：展开体不渲染 → 无 chip 文案（展开/折叠两态都有牙）。
    expect(renderChipLabels(attachProps.attachments, false)).toEqual([]);
  });

  it('牙齿：删掉 row-logic 的 attach 分支即红（chip 不落回中文状态文案）', () => {
    const path = '/notes/setting.md';
    // 直接对照 core 状态 chip：userAttach 在状态口径里返回空串（不进状态 chip）。
    // 所以 @path 只可能来自 row-logic 的 `a.source === 'attach'` 分支。
    const chips: AttachmentChip[] = [userAttachAttachment(path)];
    const label = renderChipLabels(chips)[0]!;
    expect(label).toContain(`@${path}`);
    expect(label).not.toBe('');
  });

  it('对照组：同形态的 workplace 附件仍走中文状态 chip（attach 不是通用兜底）', () => {
    const path = '/notes/setting.md';
    const workplace: AttachmentChip[] = [
      {
        name: path,
        source: 'workplace',
        type: 'text',
        content: null,
        path,
        action: 'workplaceChange',
      },
    ];
    expect(renderChipLabels(workplace)[0]).toContain(`规则:${path}`);
  });

  it('二进制附件同样出 `@path` chip（子会话屏按路径渲染，不区分类型）', () => {
    const path = '/assets/cover.png';
    const atts: AttachmentChip[] = [
      {
        name: attachmentStorageName(path),
        source: 'attach',
        type: 'image',
        content: null,
        path,
        action: 'userAttach',
      },
    ];
    const texts = collectText(
      AttachGroup({
        attachments: atts,
        groupKey: 'attach:child-u2',
        expanded: true,
        showDividerAbove: false,
      }) as VNode,
    );
    expect(texts).toContain(`@${path}`);
    expect(texts).toContain('文件');
  });
});
