/**
 * 用户气泡引用胶囊切分单测（附件真源口径）：
 * 胶囊边界 = 消息附件（skillName/path 与正文捕获逐字相等），不再正则猜测——
 * 尾随文字无空白也精确切分，与输入框 chip 模型语义一致。
 */
import {
  attachedRefTokensFrom,
  RefTokenText,
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

/**
 * F-A7：新格式明文（`$技能名$` / `@路径@`）下，胶囊要连终止符一起吃掉；
 * 旧格式贴邻（`$A$B`、`@path$skill`）保持两颗各自成药丸，不许退化。
 */
describe('新格式终止符消费', () => {
  it('新格式技能：终止符进胶囊，后面的普通字留在外面', () => {
    const attached = {skills: new Set(['写文档']), paths: new Set<string>()};
    expect(splitRefTokenSpans('看$写文档$呀', attached)).toEqual([
      {kind: 'text', text: '看'},
      {kind: 'skill', text: '$写文档$', displayText: '写文档'},
      {kind: 'text', text: '呀'},
    ]);
  });

  it('新格式路径：终止符进胶囊', () => {
    const attached = {skills: new Set<string>(), paths: new Set(['notes/a.md'])};
    expect(splitRefTokenSpans('看@notes/a.md@谢', attached)).toEqual([
      {kind: 'text', text: '看'},
      {kind: 'path', text: '@notes/a.md@', displayText: 'notes/a.md'},
      {kind: 'text', text: '谢'},
    ]);
  });

  it('旧格式贴邻双技能：各自成药丸，不被当成终止符吞掉', () => {
    const attached = {skills: new Set(['A', 'B']), paths: new Set<string>()};
    expect(splitRefTokenSpans('$A$B', attached)).toEqual([
      {kind: 'skill', text: '$A'},
      {kind: 'skill', text: '$B'},
    ]);
  });

  it('旧格式 @path 贴邻 $skill：路径胶囊不被技能触发符吞掉', () => {
    const attached = {
      skills: new Set(['写作文']),
      paths: new Set(['/docs/a.md']),
    };
    expect(splitRefTokenSpans('@/docs/a.md$写作文', attached)).toEqual([
      {kind: 'path', text: '@/docs/a.md'},
      {kind: 'skill', text: '$写作文'},
    ]);
  });

  it('相邻字符恰好是触发符但无第二条命中：按新格式消费终止符', () => {
    const attached = {skills: new Set(['A']), paths: new Set<string>()};
    // 只有一个附件命中，尾随 `$` 就是终止符（不是第二颗胶囊的开头）
    expect(splitRefTokenSpans('$A$', attached)).toEqual([
      {kind: 'skill', text: '$A$', displayText: 'A'},
    ]);
  });

  it('终止符位置是普通字（非触发符）时不推进：旧文本不被吞', () => {
    const attached = {skills: new Set(['写作文']), paths: new Set<string>()};
    expect(splitRefTokenSpans('$写作文本', attached)).toEqual([
      {kind: 'skill', text: '$写作文'},
      {kind: 'text', text: '本'},
    ]);
  });

  /**
   * F-A7 第 5 组：新格式相邻，每颗消费**自己**的终止符。
   * 这里的牙齿是 `matchStarts`——正向消费后下一颗仍要被正常处理（不是被跳过）。
   */
  it('新格式相邻两颗技能 `$A$$B$`：各自消费终止符、互不吞噬', () => {
    const attached = {skills: new Set(['A', 'B']), paths: new Set<string>()};
    expect(splitRefTokenSpans('$A$$B$', attached)).toEqual([
      {kind: 'skill', text: '$A$', displayText: 'A'},
      {kind: 'skill', text: '$B$', displayText: 'B'},
    ]);
  });

  it('新格式路径贴技能 `@docs/a.md@$写作$`：两种触发符各自收尾', () => {
    const attached = {
      skills: new Set(['写作']),
      paths: new Set(['/docs/a.md']),
    };
    expect(splitRefTokenSpans('@docs/a.md@$写作$', attached)).toEqual([
      {kind: 'path', text: '@docs/a.md@', displayText: 'docs/a.md'},
      {kind: 'skill', text: '$写作$', displayText: '写作'},
    ]);
  });
});

describe('RefTokenText 渲染（气泡里只显示名字）', () => {
  /** 拍平 VNode 树成整串：字符串段原样拼，胶囊 span 取其子节点。 */
  const flatText = (text: string, attached: any): string => {
    const vnode = RefTokenText({text, attached}) as any;
    return (vnode.props.children as unknown[])
      .map(child => (typeof child === 'string' ? child : (child as any).props.children))
      .join('');
  };
  /** 胶囊子节点（字符串段是纯文本，对象段就是胶囊 span）。 */
  const chipLabels = (text: string, attached: any): unknown[] => {
    const vnode = RefTokenText({text, attached}) as any;
    return (vnode.props.children as unknown[])
      .filter(child => typeof child === 'object' && child != null)
      .map((chip: any) => chip.props.children);
  };

  it('新格式 `$名字$` / `@路径@`：整串里不残留任何终止符', () => {
    const attached = {
      skills: new Set(['写文档']),
      paths: new Set(['/docs/a.md']),
    };
    const flat = flatText('$写文档$ 看 @/docs/a.md@', attached);
    // 只查胶囊标签会漏掉「裸终止符落在文字段」的坏形状（span 拉长了但 cursor 没推进）
    expect(flat).toBe('写文档 看 /docs/a.md');
    expect(flat).not.toMatch(/[$@]/);
    expect(chipLabels('$写文档$ 看 @/docs/a.md@', attached)).toEqual([
      '写文档',
      '/docs/a.md',
    ]);
  });

  it('旧格式（无尾终止符）照旧原样显示，不误裁', () => {
    const attached = {skills: new Set(['写作文']), paths: new Set<string>()};
    expect(flatText('$写作文', attached)).toBe('$写作文');
    expect(chipLabels('$写作文', attached)).toEqual(['$写作文']);
  });
});
