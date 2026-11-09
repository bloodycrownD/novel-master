/**
 * 流式行纯投影测试（chat-streaming-projection Step 3 / T-SP1、T-SP33）。
 *
 * 纯函数零 mock：只喂 `SessionStreamUnitView.streamRows` / DB 行 / 映射，
 * 断输入输出表与引用稳定契约。
 */
import {describe, expect, it} from '@jest/globals';
import type {SessionStreamUnitView} from '@/services/session-stream-unit';
import type {TranscriptRow} from '@/components/chat/ChatTranscriptBridge';
import {
  EMPTY_STREAM_ROW_IDS,
  buildStreamingRows,
  buildStreamingTranscriptRow,
  applyStreamRowIds,
} from '@/components/chat/transcript-stream-projection';

function view(
  streamRows: SessionStreamUnitView['streamRows'],
): SessionStreamUnitView {
  return {streamRows} as unknown as SessionStreamUnitView;
}

function projection(
  overrides: Partial<SessionStreamUnitView['streamRows'][number]> = {},
): SessionStreamUnitView['streamRows'][number] {
  return {
    streamId: 'st:s:1:0',
    status: 'streaming',
    text: '',
    thinking: '',
    tools: [],
    messageId: null,
    ...overrides,
  };
}

function messageRow(
  id: string,
  role: 'user' | 'assistant',
  overrides: Partial<Extract<TranscriptRow, {kind: 'message'}>> = {},
): TranscriptRow {
  return {
    kind: 'message',
    id,
    role,
    hidden: false,
    text: `text-${id}`,
    thinking: '',
    ...overrides,
  };
}

describe('buildStreamingRows（T-SP1）', () => {
  it('null / 空投影 → 稳定空数组', () => {
    expect(buildStreamingRows(null)).toEqual([]);
    expect(buildStreamingRows(view([]))).toEqual([]);
  });

  it('starting/running 只有当前 streaming 行 → 一条 streaming 投影', () => {
    const rows = buildStreamingRows(
      view([projection({text: '流式中', thinking: '想'})]),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      streamId: 'st:s:1:0',
      status: 'streaming',
      text: '流式中',
      thinking: '想',
      messageId: null,
    });
  });

  it('step 提交后：finished-未接管行与当前 streaming 行同现（旧→新）', () => {
    const rows = buildStreamingRows(
      view([
        projection({
          streamId: 'st:s:1:0',
          status: 'finished',
          text: '上一轮',
          tools: [
            {
              toolUseId: 't1',
              name: 'read',
              input: {path: 'a.md'},
              status: 'pending',
            },
          ],
        }),
        projection({streamId: 'st:s:1:1', status: 'streaming', text: ''}),
      ]),
    );
    expect(rows.map(row => row.streamId)).toEqual(['st:s:1:0', 'st:s:1:1']);
    expect(rows[0]).toMatchObject({
      status: 'finished',
      text: '上一轮',
      messageId: null,
      tools: [
        {
          toolUseId: 't1',
          name: 'read',
          input: {path: 'a.md'},
          status: 'pending',
        },
      ],
    });
    expect(rows[1]).toMatchObject({status: 'streaming', text: ''});
  });

  it('interrupted partial → finished 行、无 messageId', () => {
    const rows = buildStreamingRows(
      view([
        projection({
          streamId: 'st:s:interrupted:123',
          status: 'finished',
          text: '半截',
        }),
      ]),
    );
    expect(rows[0]).toMatchObject({status: 'finished', messageId: null});
    expect(rows[0]!.messageId).toBeNull();
  });

  it('引用稳定：同输入两次返回同一数组，内容变化才换新', () => {
    const input = [projection({text: 'abc'})];
    const first = buildStreamingRows(view(input));
    const second = buildStreamingRows(view(input));
    expect(second).toBe(first);
    expect(buildStreamingRows(view(input))[0]!.text).toBe('abc');

    // 内容变化（unit 的 streamRows copy-on-write → 新数组）→ 新输出
    const changedInput = projection({text: 'abcd'});
    const changed = buildStreamingRows(view([changedInput]));
    expect(changed).not.toBe(first);
    expect(changed[0]!.text).toBe('abcd');

    // 新数组但字段全等（含 tools 引用不变）→ 复用上一次输出
    const sameContent = buildStreamingRows(view([{...changedInput}]));
    expect(sameContent).toBe(changed);
  });
});

describe('applyStreamRowIds（T-SP1 / T-SP33）', () => {
  it('只改命中映射的 assistant 行：id=streamId、messageId=DB id、status=finished', () => {
    const rows = [
      messageRow('db-a1', 'assistant'),
      messageRow('db-u1', 'user'),
      messageRow('db-a2', 'assistant'),
    ];
    const map = new Map([
      ['db-a1', 'st:s:1:0'],
      ['db-u1', 'st:user-should-not-apply'],
    ]);
    const next = applyStreamRowIds(rows, map);
    expect(next[0]).toMatchObject({
      id: 'st:s:1:0',
      messageId: 'db-a1',
      status: 'finished',
      role: 'assistant',
    });
    expect(next[1]).toBe(rows[1]);
    expect(next[2]).toBe(rows[2]);
  });

  it('空映射原样返回（回滚开关等价面，T-SP33）', () => {
    const rows = [messageRow('db-a1', 'assistant')];
    expect(applyStreamRowIds(rows, EMPTY_STREAM_ROW_IDS)).toBe(rows);
  });
});

describe('buildStreamingTranscriptRow（T-SP3 投影面）', () => {
  it('行身份 id=streamId、status/messageId 原样搬运，plain 不带 html', () => {
    const row = buildStreamingTranscriptRow(
      projection({
        streamId: 'st:s:1:0',
        status: 'finished',
        text: '全文',
        thinking: '思考',
        messageId: 'db-a1',
      }),
      false,
    );
    expect(row).toMatchObject({
      kind: 'message',
      id: 'st:s:1:0',
      messageId: 'db-a1',
      role: 'assistant',
      status: 'finished',
      text: '全文',
      thinking: '思考',
    });
    expect(row).not.toHaveProperty('textHtml');
    expect(row).not.toHaveProperty('thinkingHtml');
  });

  it('richText：textHtml/thinkingHtml 为覆盖后**全量**文本的 HTML', () => {
    const row = buildStreamingTranscriptRow(
      projection({text: '原文', thinking: '原想'}),
      true,
      {text: '第一段\n\n第二段', thinking: '完整思考'},
    );
    expect(row.kind).toBe('message');
    if (row.kind !== 'message') {
      throw new Error('expected message row');
    }
    expect(row.text).toBe('第一段\n\n第二段');
    expect(row.thinking).toBe('完整思考');
    expect(row.textHtml).toContain('第一段');
    expect(row.textHtml).toContain('第二段');
    expect(row.thinkingHtml).toContain('完整思考');
  });

  it('空 tools 不带 tools 字段；非空 tools 结构化搬运', () => {
    const empty = buildStreamingTranscriptRow(projection(), false);
    expect(empty).not.toHaveProperty('tools');
    const withTools = buildStreamingTranscriptRow(
      projection({
        tools: [
          {toolUseId: 't1', name: 'grep', input: {q: 'x'}, status: 'pending'},
        ],
      }),
      false,
    );
    expect(withTools.kind).toBe('message');
    if (withTools.kind !== 'message') {
      throw new Error('expected message row');
    }
    expect(withTools.tools).toEqual([
      {toolUseId: 't1', name: 'grep', input: {q: 'x'}, status: 'pending'},
    ]);
  });
});

describe('buildStreamingRows(null)（T-SP33）', () => {
  it('回滚/无单元时返回空数组，不抛错', () => {
    expect(buildStreamingRows(null)).toEqual([]);
  });
});
