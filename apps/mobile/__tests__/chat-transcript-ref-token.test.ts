/**
 * 用户气泡引用胶囊切分单测（附件真源口径）：
 * 胶囊边界 = 消息附件（skillName/path 与正文捕获逐字相等），不再正则猜测——
 * 尾随文字无空白也精确切分，与输入框 chip 模型语义一致。
 */
import {
  attachedRefTokensFrom,
  splitRefTokenSpans,
} from '@/web/chat-transcript/webview/ui/render/RefTokenText';

const NONE = {skills: new Set<string>(), paths: new Set<string>()};

describe('attachedRefTokensFrom', () => {
  it('skillAttach 取 skillName，attach 路径取 path', () => {
    const attached = attachedRefTokensFrom([
      {source: 'attach', action: 'skillAttach', skillName: '写作技能'},
      {source: 'attach', action: 'userAttach', path: '/chapters/01.md'},
    ]);
    expect([...attached.skills]).toEqual(['写作技能']);
    expect([...attached.paths]).toEqual(['/chapters/01.md']);
  });

  it('转录行形状无 skillName 时回落 name（AttachmentChip 不携带 skillName）', () => {
    const attached = attachedRefTokensFrom([
      {source: 'attach', action: 'skillAttach', name: '助手派遣'},
    ]);
    expect([...attached.skills]).toEqual(['助手派遣']);
  });

  it('非 attach 来源（annotate/user_ops）不产生胶囊真源', () => {
    const attached = attachedRefTokensFrom([
      {source: 'user_ops', action: 'annotate', path: '/a.md'},
      {source: 'workplace', path: '/b.md'},
    ]);
    expect(attached.skills.size).toBe(0);
    expect(attached.paths.size).toBe(0);
  });

  it('空 skillName / 空 path 忽略', () => {
    const attached = attachedRefTokensFrom([
      {source: 'attach', action: 'skillAttach'},
      {source: 'attach', action: 'userAttach', path: ''},
    ]);
    expect(attached.skills.size).toBe(0);
    expect(attached.paths.size).toBe(0);
  });
});

describe('splitRefTokenSpans（附件真源口径）', () => {
  it('无附件普通文本单段原样', () => {
    expect(splitRefTokenSpans('你好，普通消息', NONE)).toEqual([
      {kind: 'text', text: '你好，普通消息'},
    ]);
  });

  it('@路径 与 $技能 按附件命中切分', () => {
    const attached = {
      skills: new Set(['写作技能']),
      paths: new Set(['/chapters/01.md']),
    };
    expect(
      splitRefTokenSpans('看 @/chapters/01.md 与 $写作技能 再回', attached),
    ).toEqual([
      {kind: 'text', text: '看 '},
      {kind: 'path', text: '@/chapters/01.md'},
      {kind: 'text', text: ' 与 '},
      {kind: 'skill', text: '$写作技能'},
      {kind: 'text', text: ' 再回'},
    ]);
  });

  it('尾随文字无空白精确切分（胶囊不吞文字）', () => {
    const attached = {
      skills: new Set(['agent-config']),
      paths: new Set<string>(),
    };
    expect(splitRefTokenSpans('甲$agent-config乙', attached)).toEqual([
      {kind: 'text', text: '甲'},
      {kind: 'skill', text: '$agent-config'},
      {kind: 'text', text: '乙'},
    ]);
  });

  it('贴邻双技能都渲染（chip 模型）', () => {
    const attached = {skills: new Set(['A', 'B']), paths: new Set<string>()};
    expect(splitRefTokenSpans('$A$B', attached)).toEqual([
      {kind: 'skill', text: '$A'},
      {kind: 'skill', text: '$B'},
    ]);
  });

  it('@路径后紧贴 $技能互不吞并', () => {
    const attached = {
      skills: new Set(['写作']),
      paths: new Set(['/docs/a.md']),
    };
    expect(splitRefTokenSpans('@/docs/a.md$写作', attached)).toEqual([
      {kind: 'path', text: '@/docs/a.md'},
      {kind: 'skill', text: '$写作'},
    ]);
  });

  it('未挂载的 $xxx 明文按正文渲染（不伪装胶囊）', () => {
    expect(splitRefTokenSpans('价格是 a$b 与 $未知技能', NONE)).toEqual([
      {kind: 'text', text: '价格是 a$b 与 $未知技能'},
    ]);
  });

  it('前缀技能名按胶囊边界切分（与输入框一致，尾随字符落胶囊外）', () => {
    const attached = {skills: new Set(['写']), paths: new Set<string>()};
    expect(splitRefTokenSpans('$写作', attached)).toEqual([
      {kind: 'skill', text: '$写'},
      {kind: 'text', text: '作'},
    ]);
  });

  it('同一路径重复出现都渲染胶囊（展示层不判重）', () => {
    const attached = {skills: new Set<string>(), paths: new Set(['/a.md'])};
    expect(splitRefTokenSpans('@/a.md 然后 @/a.md', attached)).toEqual([
      {kind: 'path', text: '@/a.md'},
      {kind: 'text', text: ' 然后 '},
      {kind: 'path', text: '@/a.md'},
    ]);
  });

  it('行首技能 token 切分（无边界要求，附件命中即胶囊）', () => {
    const attached = {skills: new Set(['技能']), paths: new Set<string>()};
    expect(splitRefTokenSpans('$技能开始吧', attached)).toEqual([
      {kind: 'skill', text: '$技能'},
      {kind: 'text', text: '开始吧'},
    ]);
  });

  it('互为前缀的技能同挂时同位取最长', () => {
    const attached = {skills: new Set(['A', 'AB']), paths: new Set<string>()};
    expect(splitRefTokenSpans('$AB', attached)).toEqual([
      {kind: 'skill', text: '$AB'},
    ]);
  });

  it('path 与 skill 同名字面量各自成胶囊不互吞', () => {
    const attached = {skills: new Set(['x']), paths: new Set(['x'])};
    expect(splitRefTokenSpans('$x@x', attached)).toEqual([
      {kind: 'skill', text: '$x'},
      {kind: 'path', text: '@x'},
    ]);
  });

  it('手输相对路径命中去前导斜杠形态（落库归一 /、正文原样无斜杠）', () => {
    const attached = {skills: new Set<string>(), paths: new Set(['/notes/a.md'])};
    expect(splitRefTokenSpans('见 @notes/a.md', attached)).toEqual([
      {kind: 'text', text: '见 '},
      {kind: 'path', text: '@notes/a.md'},
    ]);
  });

  it('挂载 path 为正文更长 token 前缀时按挂载边界切分', () => {
    const attached = {skills: new Set<string>(), paths: new Set(['/notes/a.md'])};
    expect(splitRefTokenSpans('@notes/a.md.bak', attached)).toEqual([
      {kind: 'path', text: '@notes/a.md'},
      {kind: 'text', text: '.bak'},
    ]);
  });
});
