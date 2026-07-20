import {
  findWhitelistMacroRanges,
  insertTextAtSelection,
  splitPromptMacroSegments,
  tryAtomicMacroDelete,
} from '../src/components/agent/prompt-macro-input';

describe('splitPromptMacroSegments', () => {
  it('芯片形态：白名单宏分段为 macro', () => {
    expect(
      splitPromptMacroSegments('hi {{$filetree}} there {{$time}}'),
    ).toEqual([
      {kind: 'text', value: 'hi '},
      {kind: 'macro', value: '{{$filetree}}'},
      {kind: 'text', value: ' there '},
      {kind: 'macro', value: '{{$time}}'},
    ]);
  });

  it('手输完整：带空格内文仍视为 macro', () => {
    expect(splitPromptMacroSegments('前缀 {{ $week_cn }} 后缀')).toEqual([
      {kind: 'text', value: '前缀 '},
      {kind: 'macro', value: '{{ $week_cn }}'},
      {kind: 'text', value: ' 后缀'},
    ]);
  });

  it('非法/非白名单 {{…}} 保持普通文本', () => {
    expect(splitPromptMacroSegments('{{$unknown}} {{.filetree}}')).toEqual([
      {kind: 'text', value: '{{$unknown}} {{.filetree}}'},
    ]);
  });

  it('半输入/未闭合 {{ 不成 tag', () => {
    expect(splitPromptMacroSegments('typing {{$time')).toEqual([
      {kind: 'text', value: 'typing {{$time'},
    ]);
  });

  it('已闭合但非白名单根键不成 tag', () => {
    expect(splitPromptMacroSegments('{{$ti}}')).toEqual([
      {kind: 'text', value: '{{$ti}}'},
    ]);
  });
});

describe('findWhitelistMacroRanges', () => {
  it('返回白名单宏 span 坐标', () => {
    const text = 'a{{$time}}b{{ $week_cn }}c';
    expect(findWhitelistMacroRanges(text)).toEqual([
      {start: 1, end: 10, value: '{{$time}}'},
      {start: 11, end: 25, value: '{{ $week_cn }}'},
    ]);
  });
});

describe('tryAtomicMacroDelete', () => {
  /** 模拟退格一次：删掉 cursor 前一字 */
  function backspaceOnce(value: string, cursor: number): string {
    if (cursor <= 0) {
      return value;
    }
    return value.slice(0, cursor - 1) + value.slice(cursor);
  }

  /** 模拟 Delete 一次：删掉 cursor 后一字 */
  function deleteForwardOnce(value: string, cursor: number): string {
    if (cursor >= value.length) {
      return value;
    }
    return value.slice(0, cursor) + value.slice(cursor + 1);
  }

  it('T-M1：芯片 {{$time}} 内退格整段删', () => {
    const prev = '前缀{{$time}}后缀';
    const macroStart = prev.indexOf('{{$time}}');
    const cursorInside = macroStart + '{{$time'.length;
    const changed = backspaceOnce(prev, cursorInside);

    expect(tryAtomicMacroDelete(prev, changed)).toBe('前缀后缀');
  });

  it('T-M1：芯片 {{$time}} 上 Delete 整段删', () => {
    const prev = '前缀{{$time}}后缀';
    const macroStart = prev.indexOf('{{$time}}');
    const changed = deleteForwardOnce(prev, macroStart);

    expect(tryAtomicMacroDelete(prev, changed)).toBe('前缀后缀');
  });

  it('T-M3：手输完整 {{ $week_cn }} 退格整段删', () => {
    const prev = '见 {{ $week_cn }} 后';
    const macroStart = prev.indexOf('{{ $week_cn }}');
    const cursorInside = macroStart + '{{ $week'.length;
    const changed = backspaceOnce(prev, cursorInside);

    expect(tryAtomicMacroDelete(prev, changed)).toBe('见  后');
  });

  it('T-M4：非白名单 {{$unknown}} 退格不原子删', () => {
    const prev = '{{$unknown}}';
    const changed = backspaceOnce(prev, prev.length - 1);

    expect(tryAtomicMacroDelete(prev, changed)).toBeNull();
  });

  it('T-M4：残缺/半输入 {{$time 退格不原子删', () => {
    const prev = 'x{{$time';
    const changed = backspaceOnce(prev, prev.length);

    expect(tryAtomicMacroDelete(prev, changed)).toBeNull();
  });

  it('已整段删完宏时不拦截', () => {
    const prev = '{{$time}}';
    const changed = '';

    expect(tryAtomicMacroDelete(prev, changed)).toBeNull();
  });
});

describe('insertTextAtSelection', () => {
  it('inserts at cursor', () => {
    const result = insertTextAtSelection('ab', {start: 1, end: 1}, '{{$time}}');
    expect(result.next).toBe('a{{$time}}b');
    expect(result.selection).toEqual({start: 10, end: 10});
  });
});
