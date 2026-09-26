/**
 * T-N6（spec §6 / 测试策略）：block-split 块边界纯函数单测。
 * - 段落（空行）/ 代码块（fence）闭合 / 表格闭合的边界判定用例集；
 * - 未闭合语法（流中开着的 fence、缺 delimiter 的表格）不提交；
 * - 超限判定按块：单块 >12k 仅该块 html 降级（undefined）、已提交块不受
 *   影响、<12k 多块流各块均 rich；流式尾块全量 >12k 仍整体降级
 *   （prepareStreamTailHtml 既有语义回归断言）。
 * - 终态/历史行 html 走 enrichTranscriptRows（无 12k 判定，与流式尾块
 *   口径不同，G-1 补真实终态行断言）。
 */
import {splitStreamBlocks} from '@/web/chat-transcript/stream/block-split';
import {prepareStreamTailHtml} from '@/components/chat/prepare-stream-tail-html';
import {enrichTranscriptRows} from '@/components/chat/enrich-transcript-rows';
import {RICH_CONTENT_MAX_CHARS} from '@/components/rich-content/rich-content-limits';

/** 不变式：blocks.join('') + activeTail === 原文（零丢失零重复）。 */
function expectLossless(text: string): void {
  const {blocks, activeTail} = splitStreamBlocks(text);
  expect(blocks.join('') + activeTail).toBe(text);
}

describe('splitStreamBlocks 段落边界（空行分段）', () => {
  it('空行分隔的两段：第一段成块提交，第二段留活跃尾块', () => {
    const {blocks, activeTail} = splitStreamBlocks('para one\n\npara two');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toContain('para one');
    expect(activeTail).toContain('para two');
    expectLossless('para one\n\npara two');
  });

  it('无空行的连续段落不提交（懒惰延续，整段留尾块）', () => {
    const {blocks, activeTail} = splitStreamBlocks('line a\nline b');
    expect(blocks).toHaveLength(0);
    expect(activeTail).toBe('line a\nline b');
  });

  it('多块流：多个空行边界逐一切出，剩余为尾块', () => {
    const {blocks, activeTail} = splitStreamBlocks('a\n\nb\n\nc\n\nd');
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toContain('a');
    expect(blocks[1]).toContain('b');
    expect(blocks[2]).toContain('c');
    expect(activeTail).toContain('d');
    expectLossless('a\n\nb\n\nc\n\nd');
  });

  it('流尾以换行/空行结束不触发提交（防止下帧续写同段时段落撕裂）', () => {
    // 'hello\n' 之后下一帧可能来 'world'（同段懒惰延续）——空行挂起语义：
    // 空行之后还没有非空内容到达，不提交
    const tailEnd = splitStreamBlocks('hello\n');
    expect(tailEnd.blocks).toHaveLength(0);
    expect(tailEnd.activeTail).toBe('hello\n');

    const blankEnd = splitStreamBlocks('hello\n\n');
    expect(blankEnd.blocks).toHaveLength(0);
    expect(blankEnd.activeTail).toBe('hello\n\n');

    // 空行之后新内容到达 → 挂起切分生效
    const resumed = splitStreamBlocks('hello\n\nworld');
    expect(resumed.blocks).toHaveLength(1);
    expect(resumed.blocks[0]).toContain('hello');
    expect(resumed.activeTail).toContain('world');
  });

  it('连续空行归属前块尾部，不变式保持', () => {
    const text = 'a\n\n\n\nb';
    const {blocks, activeTail} = splitStreamBlocks(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toContain('a');
    expect(activeTail).toContain('b');
    expectLossless(text);
  });

  it('空输入与纯空白输入', () => {
    expect(splitStreamBlocks('')).toEqual({blocks: [], activeTail: ''});
    expect(splitStreamBlocks('   ').blocks).toHaveLength(0);
  });
});

describe('splitStreamBlocks 代码块（fence）边界', () => {
  it('未闭合 fence 不提交：整体留活跃尾块', () => {
    const {blocks, activeTail} = splitStreamBlocks('```js\nconst x = 1;');
    expect(blocks).toHaveLength(0);
    expect(activeTail).toBe('```js\nconst x = 1;');
  });

  it('fence 闭合即切出：块含开栏行到关闭行', () => {
    const {blocks, activeTail} = splitStreamBlocks('```\ncode\n```\nafter');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toContain('```');
    expect(blocks[0]).toContain('code');
    expect(activeTail).toBe('after');
    expectLossless('```\ncode\n```\nafter');
  });

  it('fence 关闭在文本尾：整块提交，尾块为空', () => {
    const {blocks, activeTail} = splitStreamBlocks('```py\nx = 1\n```');
    expect(blocks).toHaveLength(1);
    expect(activeTail).toBe('');
    expectLossless('```py\nx = 1\n```');
  });

  it('嵌套 fence：内层短 marker 不闭合外层（长度比较）', () => {
    const inner = '````\nouter start\n``` \ninner\n````end';
    const {blocks, activeTail} = splitStreamBlocks(inner);
    // 外层 ```` 未闭合（内层 ``` 长度不足、'````end' 带尾缀非关闭行）→ 全部留尾块
    expect(blocks).toHaveLength(0);
    expect(activeTail).toBe(inner);

    const closed = '````\nhas ``` inside\n````\nnext';
    const split = splitStreamBlocks(closed);
    expect(split.blocks).toHaveLength(1);
    expect(split.blocks[0]).toContain('``` inside');
    expect(split.activeTail).toBe('next');
    expectLossless(closed);
  });

  it('fence 内的空行不是块边界（围栏内容整体成块）', () => {
    const {blocks} = splitStreamBlocks('```\na\n\nb\n```\ntail');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toContain('a\n\nb');
  });

  it('波浪线 fence 同样支持', () => {
    const {blocks, activeTail} = splitStreamBlocks('~~~\ns\n~~~\nz');
    expect(blocks).toHaveLength(1);
    expect(activeTail).toBe('z');
  });

  it('fence 开行带 info string，关闭行带尾随空白', () => {
    const {blocks} = splitStreamBlocks('```ts trim\nx\n```   \nrest');
    expect(blocks).toHaveLength(1);
    expectLossless('```ts trim\nx\n```   \nrest');
  });
});

describe('splitStreamBlocks 表格边界', () => {
  it('表格闭合：非表格行到达时切出（表格行不需要空行结尾）', () => {
    const text = '| a | b |\n|---|---|\n| 1 | 2 |\nplain text';
    const {blocks, activeTail} = splitStreamBlocks(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toContain('|---|---|');
    expect(blocks[0]).not.toContain('plain text');
    expect(activeTail).toBe('plain text');
    expectLossless(text);
  });

  it('表格以空行闭合：空行前切出', () => {
    const text = '| a |\n|---|\n| 1 |\n\npara';
    const {blocks, activeTail} = splitStreamBlocks(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toContain('| 1 |');
    expect(activeTail).toContain('para');
    expectLossless(text);
  });

  it('流中表格未闭合（数据行仍在到达）不提交', () => {
    const growing = '| a | b |\n|---|---|\n| 1 |';
    const {blocks} = splitStreamBlocks(growing);
    expect(blocks).toHaveLength(0);
  });

  it('只有表头没有 delimiter 不算表格（按普通段落处理不误切）', () => {
    const text = '| a | b |\n| c | d |';
    const {blocks} = splitStreamBlocks(text);
    expect(blocks).toHaveLength(0);
  });

  it('delimiter 行必须紧跟表头（隔行的 - 行不触发表格态）', () => {
    const text = '| a |\n\n|---|\n| 1 |';
    // 空行先切出第一段（表头行）；delimiter 不会回头把上一段接成表格
    const {blocks, activeTail} = splitStreamBlocks(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toContain('| a |');
    expect(activeTail).toContain('|---|');
    expectLossless(text);
  });
});

describe('T-N6 超限判定按块（与 RICH_CONTENT_MAX_CHARS 交互）', () => {
  it('单块 >12k：仅该块 html 降级 undefined（流中按块判定）', () => {
    const bigBlock = 'x'.repeat(RICH_CONTENT_MAX_CHARS + 1);
    const {blocks} = splitStreamBlocks(`${bigBlock}\n\nsmall tail`);
    expect(blocks).toHaveLength(1);
    expect(prepareStreamTailHtml(blocks[0], true)).toBeUndefined();
  });

  it('块超限不影响其它块：同流 <12k 块仍 rich', () => {
    const big = 'y'.repeat(RICH_CONTENT_MAX_CHARS + 100);
    const text = `first para\n\n${big}\n\nlast para`;
    const {blocks, activeTail} = splitStreamBlocks(text);
    expect(blocks).toHaveLength(2);
    expect(prepareStreamTailHtml(blocks[0], true)).toContain('first para');
    expect(prepareStreamTailHtml(blocks[1], true)).toBeUndefined();
    expect(prepareStreamTailHtml(activeTail, true)).toContain('last para');
  });

  it('已提交块不受后续尾块超限影响（流式游标推进模拟）', () => {
    // 模拟流式逐帧：帧 1 小块（空行后有新内容，提交），帧 2 追加超限大块
    const frame1 = 'ok block\n\nnext';
    const step1 = splitStreamBlocks(frame1);
    expect(step1.blocks).toHaveLength(1);
    const committedHtml = prepareStreamTailHtml(step1.blocks[0], true);
    expect(committedHtml).toBeDefined();

    const big = 'z'.repeat(RICH_CONTENT_MAX_CHARS + 1);
    const frame2 = frame1 + '\n\n' + big;
    const step2 = splitStreamBlocks(frame2);
    // 已提交块内容稳定（游标语义：step1 的块是 step2 首块）
    expect(step2.blocks[0]).toBe(step1.blocks[0]);
    expect(prepareStreamTailHtml(step2.blocks[0], true)).toBe(committedHtml);
    // 后续小块照常 rich；超限大块作为活跃尾块自身降级，不影响已提交块
    expect(step2.blocks).toHaveLength(2);
    expect(prepareStreamTailHtml(step2.blocks[1], true)).toBeDefined();
    // 尾块 = 空行分隔符 + 超限大块（块不变式：blocks.join + tail === 原文）
    expect(step2.activeTail.endsWith(big)).toBe(true);
    expect(prepareStreamTailHtml(step2.activeTail, true)).toBeUndefined();
  });

  it('<12k 多块流：各块均 rich（主场景块级 rich 生效）', () => {
    const paras = Array.from(
      {length: 20},
      (_, i) => `第 ${i} 段` + '内容'.repeat(700),
    ).join('\n\n');
    expect(paras.length).toBeGreaterThan(RICH_CONTENT_MAX_CHARS);
    const {blocks, activeTail} = splitStreamBlocks(paras);
    // 全量已超 12k（旧全量语义会整体降级），块级判定下各块仍 rich
    expect(prepareStreamTailHtml(paras, true)).toBeUndefined();
    expect(blocks.length).toBeGreaterThanOrEqual(19);
    for (const block of blocks) {
      expect(prepareStreamTailHtml(block, true)).toBeDefined();
    }
    expect(prepareStreamTailHtml(activeTail, true)).toBeDefined();
  });

  it('流式尾块全量 >12k 整体降级（prepareStreamTailHtml 流式口径）', () => {
    // G-1：原断言名写作「终态/历史行…仍整体降级」，但本断言只覆盖流式
    // 尾块的 prepareStreamTailHtml 路径；终态/历史行 html 经 enrichTranscriptRows
    // 且无 12k 判定（见下一条用例），故名实对齐后按流式口径表述。
    const full = '历史正文。'.repeat(RICH_CONTENT_MAX_CHARS);
    expect(full.length).toBeGreaterThan(RICH_CONTENT_MAX_CHARS);
    expect(prepareStreamTailHtml(full, true)).toBeUndefined();
  });

  it('终态/历史行 html 走 enrichTranscriptRows（无 12k 判定，与流式尾块口径不同）', () => {
    // 真实终态行断言（G-1 补）：历史/终态 assistant 行经 enrichTranscriptRows
    // 直出 html——该路径不看 RICH_CONTENT_MAX_CHARS，超限也照样富文本渲染
    // （12k 仅约束流式尾块与 RN RenderHTML 回退提示）。
    const bigText = '历史正文。'.repeat(RICH_CONTENT_MAX_CHARS);
    expect(bigText.length).toBeGreaterThan(RICH_CONTENT_MAX_CHARS);
    const rows = enrichTranscriptRows(
      [
        {
          kind: 'message',
          id: 'hist-1',
          role: 'assistant',
          hidden: false,
          text: bigText,
          thinking: '',
        },
      ],
      true,
    );
    const row = rows[0];
    expect(row?.kind).toBe('message');
    if (row?.kind === 'message') {
      expect(row.textHtml).toBeDefined();
      expect(row.textHtml ?? '').toContain('历史正文。');
    }
    // richText 关闭时不做 html 注入（纯文本路径）
    const plainRows = enrichTranscriptRows(
      [
        {
          kind: 'message',
          id: 'hist-2',
          role: 'assistant',
          hidden: false,
          text: bigText,
          thinking: '',
        },
      ],
      false,
    );
    expect(
      plainRows[0]?.kind === 'message' ? plainRows[0].textHtml : 'x',
    ).toBeUndefined();
  });
});

describe('splitStreamBlocks 流式逐帧游标模拟', () => {
  it('逐帧喂入 delta：游标推进下已提交内容不再出现在尾块（append-only 前提）', () => {
    const deltas = [
      '# 标题\n\n',
      '第一段',
      '文字。\n\n',
      '| h |\n|---|\n',
      '| r |\n',
      '结尾',
    ];
    let committed = '';
    let tail = '';
    const seenBlocks: string[] = [];
    for (const delta of deltas) {
      tail += delta;
      const {blocks, activeTail} = splitStreamBlocks(tail);
      for (const block of blocks) {
        committed += block;
        seenBlocks.push(block);
      }
      tail = activeTail;
    }
    // 全量 = 已提交 + 尾块（与 RN abort overlay 的物化口径一致）
    const full = deltas.join('');
    expect(committed + tail).toBe(full);
    // 已提交块首尾衔接无重叠
    const joined = seenBlocks.join('');
    expect(joined).toBe(committed);
    // 未闭合表格（'| r |' 后无闭合行时）与结尾文本保留在尾块
    expect(tail).toContain('结尾');
  });
});
