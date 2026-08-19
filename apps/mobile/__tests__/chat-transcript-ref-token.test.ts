/**
 * 用户气泡引用胶囊切分（splitRefTokenSpans）单测：
 * 口径与 core 扫描同构（@ 路径 / $ 技能 / 边界与非法形态）。
 */
import {
  splitRefTokenSpans,
} from '../src/web/chat-transcript/webview/ui/render/RefTokenText';

describe('splitRefTokenSpans', () => {
  it('普通文本单段原样', () => {
    expect(splitRefTokenSpans('你好，普通消息')).toEqual([
      {kind: 'text', text: '你好，普通消息'},
    ]);
  });

  it('@路径 与 $技能 切为胶囊片段', () => {
    expect(splitRefTokenSpans('看 @/chapters/01.md 与 $写作技能 再回')).toEqual([
      {kind: 'text', text: '看 '},
      {kind: 'path', text: '@/chapters/01.md'},
      {kind: 'text', text: ' 与 '},
      {kind: 'skill', text: '$写作技能'},
      {kind: 'text', text: ' 再回'},
    ]);
  });

  it('$ 无空白边界不成 token（a$b）', () => {
    expect(splitRefTokenSpans('价格是 a$b 吗')).toEqual([
      {kind: 'text', text: '价格是 a$b 吗'},
    ]);
  });

  it('$ 首字符为点的非法技能名视作正文', () => {
    expect(splitRefTokenSpans('$..x')).toEqual([{kind: 'text', text: '$..x'}]);
  });

  it('行首 $ 技能 token 也切分', () => {
    expect(splitRefTokenSpans('$技能 开始吧')).toEqual([
      {kind: 'skill', text: '$技能'},
      {kind: 'text', text: ' 开始吧'},
    ]);
  });

  it('同一路径重复出现都渲染胶囊（展示层不判重）', () => {
    expect(splitRefTokenSpans('@/a.md 然后 @/a.md')).toEqual([
      {kind: 'path', text: '@/a.md'},
      {kind: 'text', text: ' 然后 '},
      {kind: 'path', text: '@/a.md'},
    ]);
  });
});
