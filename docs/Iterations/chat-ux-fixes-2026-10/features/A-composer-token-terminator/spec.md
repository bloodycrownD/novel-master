---
date: 2026-10-27
iteration: chat-ux-fixes-2026-10
feature: A
scope: mobile-only
depends_on: []
---

# A · composer 胶囊显式终止符（`$skill$` / `@path@`）技术规格（SPEC）

> 本 feature 即总纲中的原 F1。**改动范围严格限 mobile**；core 实现与 desktop 零改动（core 侧只补三个既有测试文件的用例断言，见「非目标」）。
> 本迭代无独立 PRD——需求为用户口述，原话见「需求来源」。

## 需求来源

用户口述（2026-10-27，本会话）原话：

> 「回滚的时候，skill 胶囊重放到输入框中，此时 skill 会和普通文本结合在一起成为大胶囊。看看有没有办法优化？我一个思路是用 `$skill$` 优化，增加一个 `$`，这样正则准确性提高了。很多问题就好解决了。类似的文件引用也是。」

用户追加确认（2026-10-27）：三条 bug 全部只发生在 mobile 端，范围为 mobile。

路线拍板（2026-10-27，AskUserQuestion）：**`$skill$` / `@path@` 双终止符**（skill 侧即用户提的「双 `$`」）——否决「发送时把确认区间持久化进消息 `raw` + 历史消息按附件字面量反推」路线。该否决带来的固有代价见「风险」第 1 条。

## 设计目标

1. 明文 token 以触发符开头、**同一字符收尾**（`$技能名$` / `@路径@`），bounded 自证——正则不再需要靠空白猜测边界。
2. 回滚重放正文后，兜底正则扫描不再把尾随普通文本吞进胶囊；新消息 100% 精确。
3. 存量已被固化的错误大胶囊区间能自愈，不要求用户手动删。

## 非目标

- 不做消息元数据持久化 `composerTokenRanges`（`message.service.ts:190` 的 `raw` 通道本迭代不用）。
- **不改 core 发送扫描正则与 `composerAtPath`**：`attachment-scanner.ts:17-18` 的 `@([^\s@]+)` 在 `@` 停、`(?<!\S)\$([^\s$/@]+)` 在 `$` 停，新语法天然被正确切分——core 实现一行不改即可切准 `$skill$` / `@path@`。core 侧**只补既有测试文件的用例**（三个：`test/chat/scan-at-path-attachments.test.ts`、`test/chat/scan-skill-attachments.test.ts`、`test/chat/composer-at-path.test.ts`），不动任何实现。
- **不改 core `composerAtPath.formatToken` / `tokensFromPickerSelection`**（`composer-at-path.ts:18-30`）：它们被 desktop renderer（经 `apps/desktop/shared/logic/chat.ts` 薄再导出）与 `VfsMoveDirPicker`（移动目录，非 composer 引用）共用。终止符属 composer 落文形态，只在 mobile 插入 handler 拼。
- 不改 desktop 高亮正则与插入形态；双端明文形态分叉（mobile `$name$` / desktop `$name`）是本迭代已知结果。
- 不做哨兵字符（前序迭代 `composer-capsule-atomic-2026-10` 已否决 U+200B/U+FFFC）。
- 不做「手输自动成胶囊」：手打半截 `$foo`（无尾 `$`）仍不成胶囊，与现状一致。
- 正则真源不上移 core：`apps/mobile/src/web/code-editor` 与 `web/composer-input` 两个 WebView 包目前零 `@novel-master/core` 依赖（已核查，core import 仅存在于 chat-transcript 的 `row-logic.ts` / `tool-logic.ts`），上移会把 core barrel 拖进 WebView bundle。

## 现状实现摘要

| 位置 | 现状 |
|---|---|
| `apps/mobile/src/components/chat/composer-highlight.ts:10` | `COMPOSER_TOKEN_RE = /@([^\s@$]+)\|\$([^\s$@]+)/g`——字符类已互相排除对方触发符并排除空白，但**无尾终止符要求**，token 一路吞到空白 |
| `apps/mobile/src/components/chat/composer-token-insert.ts:31-52` | `buildTokenInsertion` 零空格直插（chip 口径，2026-10-20 拍板），区间=每个 token 的 `[start,end)`，光标落插入段末尾 |
| `apps/mobile/src/components/chat/useChatComposerController.ts:805-828` | dock 的 `insertSkillToken` 产 `$` + 技能名；`onAtPickerConfirm` 收 picker 交上来的裸 `@path` token |
| `apps/mobile/src/screens/stack/PromptEditorScreen.tsx:244-262 / :265-` | 全屏 `insertSkillToken` 产 `$` + 名称；`insertPathTokens` 收裸 `@path` |
| `apps/mobile/src/screens/tabs/chat-tab/useChatTabMessageActions.ts:187-253` | 回滚只写 `{text: restoreText, attachments: []}`，**不带 tokenRanges**（D1 带外路径，注释自述允许兜底扫描一次） |
| `apps/mobile/src/components/chat/useChatComposerController.ts:384-409` | 水化 `draft.tokenRanges ?? scanTokensToRanges(draft.text)`；undefined 时**兜底扫描结果写回草稿固化** |
| `apps/mobile/src/components/chat/native-composer/token-ranges.ts:308-321` | `synthesizeToken`：`body = token.slice(1)`，按区间整段包 `[token](scheme://body)` |
| `apps/mobile/src/web/chat-transcript/webview/ui/render/RefTokenText.tsx:23-61` | 转录层用**消息附件 skillName/path 做字面量匹配**切胶囊（不用正则），构造即精确边界 |

**大胶囊成因链**（已由既有测试纸面复现）：插入 `帮我$skill总结`（零空格）→ 发送后正文保留该明文 → 回滚恢复正文、ranges=undefined → 兜底扫描 `\$([^\s$@]+)` 命中 `$skill总结` 整段 → 合成层忠实包成一颗大胶囊 → `syncFromDraft` 把错误区间**写回草稿固化**（重启仍在）。根因是**扫描口径**，不是合成/区间下发（`__tests__/native-composer.test.tsx:472-483` 证明给定正确区间时尾追不并入）。

## 实现方案

### D1-1 正则为唯一真源改动点

`apps/mobile/src/components/chat/composer-highlight.ts`：

```ts
/** 完整 token 含两端触发符：`$技能名$` / `@路径@`；终止符计入区间 */
const COMPOSER_TOKEN_RE = /@([^\s@$]+)@|\$([^\s$@]+)\$/g;
```

- 字符类不变，变化仅是**强制尾终止符**。
- 相邻两胶囊 `$A$$B$`：第一段命中 `$A$` 后 `lastIndex` 停在第二个 `$`，继续命中 `$B$`——天然可分。
- 空体 `$$` / `@@` 不命中；孤立 `$` / `@` 维持不成 token。
- 路径含 `@`、技能名或路径含 `$` 无法表达——**既有限制**（旧正则同样不识别），不新增限制。
- 文件头注释同步改写：删除「与桌面蓝本严格对齐」表述（已分叉），改为「终止符=触发符，样本表见 `__tests__/fixtures/composer-token-cases.json`」。

新增同文件导出（与正则同真源）：

```ts
/** 区间文本形态是否合法（含两端同字符触发符，长度≥3）。水化自愈用。 */
export function isValidTokenRangeText(plain: string, range: {start: number; end: number}): boolean;
```

### D1-2 插入点（mobile 四个 handler）

| 位置 | 改动 |
|---|---|
| `useChatComposerController.ts:805-828` | dock skill token：`` `$${skillName}$` `` |
| `useChatComposerController.ts` 的 `onAtPickerConfirm` | picker 交上来的裸 `@path` token 逐条补尾 `@`（`tokens.map(t => \`${t}@\`)`）后交给 `buildTokenInsertion` |
| `PromptEditorScreen.tsx:244-262` `insertSkillToken` | `` `$${name}$` `` |
| `PromptEditorScreen.tsx:265-` `insertPathTokens` | 收到的裸 `@path` token 逐条补尾 `@` |

- `buildTokenInsertion`（`composer-token-insert.ts`）**零改动**：它只拼接并按每个 token 长度登记区间，token 自带终止符后语义自动正确。
- **不改** `FileReferencePicker`（`props.onConfirm(tokens)` 边界在 `:192-201`）：它是共享选择器，`VfsMoveDirPicker.tsx:25` 以 `pick-directory` 模式复用做目录移动，终止符必须在 composer 侧补。
- **不改** core `composerAtPath.replaceToken`（`:57-67`，收尾补空格的 desktop 全键盘口径，mobile chip 走 `buildTokenInsertion`）。

### D1-3 合成：终止符剥进 destination、LINK 文本保留全文

`apps/mobile/src/components/chat/native-composer/token-ranges.ts` 的 `synthesizeToken`（`:308-321`）：

```ts
function synthesizeToken(token: string): string {
  // 终止符 = 触发符同字符：先做形态校验，不合法则原文返回
  if (token.length < 3 || token[0] !== token[token.length - 1]) return token;
  const body = token.slice(1, -1);          // 剥掉两端触发符
  if (body.length === 0 || body.includes('[') || body.includes(']')) return token;
  const scheme = token[0] === '@' ? NM_TOKEN_SCHEME : NM_SKILL_SCHEME;
  return `[${token}](${scheme}${encodeDestination(body)})`;   // LINK 文本保留 `$x$` 全文
}
```

- **LINK 文本保留完整 `$skill$`**（两个 `$` 都显示在胶囊内）：native 库 `onChangeText` 回声必须与明文逐字一致，剥掉终止符会造成基线/区间错位（库是外部 npm 包 + patch，仓库内无法静态验证归一化行为）。胶囊内可见双 `$` 是**视觉口径变更**，见「待确认问题」2。
- destination 不含终止符：`@` → `NM_TOKEN_SCHEME`（`token-ranges.ts:40`，实际值 `nmtoken://`）、`$` → `NM_SKILL_SCHEME`（`:43`，实际值 `nmskill://`），与既有 scheme 消费方对齐；`NativeChatComposer.tsx` 的 `linkVariants['^nmskill:']` 匹配不受影响（destination 无终止符，前缀命中不变）。

### D1-4 用例表（mobile 单端行为锁）

新增 `apps/mobile/__tests__/fixtures/composer-token-cases.json`（`fixtures/` 目录当前不存在，需新建；`apps/mobile/tsconfig.json` 已开 `resolveJsonModule`，测试里直接 `import cases from './fixtures/composer-token-cases.json'`）：

```json
[
  {"plain": "$写文档$", "ranges": [{"start": 0, "end": 5}]},
  {"plain": "$写文档$总结", "ranges": [{"start": 0, "end": 5}]},
  {"plain": "帮我$写文档$看下", "ranges": [{"start": 2, "end": 7}]},
  {"plain": "@notes/a.md@", "ranges": [{"start": 0, "end": 12}]},
  {"plain": "@notes/@$A$", "ranges": [{"start": 0, "end": 8}, {"start": 8, "end": 11}]},
  {"plain": "$A$$B$", "ranges": [{"start": 0, "end": 3}, {"start": 3, "end": 6}]},
  {"plain": "$写文档总结", "ranges": []},
  {"plain": "$$ @@ $ $", "ranges": []},
  {"plain": "价格$100$是", "ranges": [{"start": 2, "end": 7}]}
]
```

`__tests__/composer-highlight.test.ts` 逐条读表断言。表即 mobile 行为契约：改语法只改表 + 一处正则。

### D1-5 转录层与既有消费方

- `RefTokenText.tsx`（切分逻辑在 `splitRefTokenSpans`，`:101-126`）：字面量命中（`trigger + name`）后**有条件消费紧邻终止符**，两个条件必须同时成立才把 `end` 推进到 `end+1`：
  1. `end < text.length && text[end] === trigger`——**字符判定不能省**。只查邻居就推进的话，`$写作`（附件技能 `写`）的 `end` 落在 `作` 上也会被推进，现有用例 `chat-transcript-ref-token.test.ts:109-115`、`:126-132`、`:157-163`、`:71-81`（`甲$agent-config乙`）会全红。
  2. 没有另一条 match 恰好从 `end` 开始。
  - 无条件推进（`end+1` 不看邻居）会吞掉旧格式贴邻 token：`$A$B`（附件 A、B）中 `$A` 命中 `[0,2)`、`$B` 命中 `[2,4)`，若第一条把 `cursor` 推到 3，则 `$B` 被 `match.index < cursor` 跳过、`B` 沦为明文；`@/docs/a.md$写作` 同理会把 `$写作` 的 `$` 吃掉。现有用例 `__tests__/chat-transcript-ref-token.test.ts:84-101`（贴邻双技能、`@path$skill`）就是这道回归网。
  - 消费时 **span 文本也要一起延长**：用 `text.slice(index, end+1)` 建 span，而不是沿用 `match.text`（`RefTokenText.tsx:119-120` 现在用的是 `match.text`）——否则只推进 cursor 不延长 span，终止符会从渲染里整个消失。
  - 旧格式的精确表述：**贴邻且另一条附件命中时不退化**（`$A$B`、`@path$skill` 保持两颗胶囊）；其余同字符相邻仍会被并入（如旧消息 `$A$B` 但只有 A 挂附件 → 胶囊变 `$A$`、`B` 落明文），属纯视觉降级。
  - **改后须 `npm run build:webview`**（真机还需 `build:webview:native`）。
- `web/code-editor/webview/runtime/composer-tokens.ts`、`web/composer-input/webview/runtime/editor.ts` 复用 `composerTokenRanges`，高亮与原子删**自动跟随**，零代码改动，仅回归。
- `components/common/atomic-range-delete.ts` 零改动（吃区间）；退格删终止符会整颗删除——删除后区间重映射走 `token-ranges.ts` 的 `remapAroundDeletion`（`:235-252`，删除窗与区间相交即摘除），与现状「删 `$` 整颗删」一致。
- core `composerAtPath.detectQuery`（`composer-at-path.ts:33-54`，已全文核实）**零改动**：它要求触发符前一字符为空白（`at > 0` 时 prev 非空白即 null），终止符前一字符必是名称末字 → `$name$|` 光标处返回 null，**天然不弹候选**。此为隐式依赖，用 F-A6 用例锁死。

### D1-6 兼容与自愈

| 数据 | 新正则下的行为 | 处置 |
|---|---|---|
| 新消息正文 `$skill$尾追文本` | 回滚重放 → 兜底扫描精确命中 `$skill$`，尾追在胶囊外 | **目标行为，不依赖持久化 ranges** |
| 历史消息正文 `$skill总结`（升级前发送） | 不命中 → 回滚后整段纯文本 | 接受降级（拍板路线固有代价），见风险 1 |
| 历史草稿已固化的错误大胶囊区间（如 `$技能尾追` 的 `[{0,5}]`） | 区间是持久化真源、不走正则 → 仍渲染成大胶囊 | **水化自愈**：`syncFromDraft` 采用 `draft.tokenRanges` 前逐条 `isValidTokenRangeText` 校验，不合法丢弃并**把过滤结果写回草稿**（不合法即写 `[]`），不抛错 |
| 旧版 app 读新格式 `$skill$` | 旧正则 `[^\s$@]+` 在 `$` 停 → 匹配 `$skill` + 裸 `$` 尾 | 降级可接受 |
| core 发送扫描 | `@notes/a.md@` → `/notes/a.md`（core 统一补前导 `/`）、`@notes/@` → `/notes/`、`$skill$` → `skill` | **实现零改动**，F-A4 落用例锁死 |
| 手输嵌在中文中间的 `$x$`（如 `帮我$写文档$总结` 未走胶囊） | core `SKILL_TOKEN_RE` 带 `(?<!\S)` 前置空白要求 → 不挂技能附件 | **非回归**（旧格式同样不挂），正文照常入库；胶囊路径走 `composer-send-scan.ts` 的区间扫描不受影响 |
| `composer-send-scan.ts`（mobile，`domain/chat/logic/composer/` 之外的 UI 侧）/ core `composer-send-policy.ts`（D9 掩码二段式） | 掩码区间含终止符后 slice 长度自然正确 | 零改动，回归 |

**回滚路径零改动**：`useChatTabMessageActions.ts` 继续写不带 ranges 的草稿，正确性由新正则在兜底扫描时自证。

**水化自愈的谓词与落点**（三个落点缺一不可）：

- 谓词 `isValidTokenRangeText(plain, range)` **不得**只判「长度≥3 且首尾同字符」——那样 `@a@b@` 这类伪区间会被放行。定义为两步：① 范围合法 `0 <= start < end <= plain.length`（缺这步时 `plain='$A$'` + `range={0,10}` 会 slice 成 `$A$` 判合法，再把越界区间下发给 `setTokenRanges`）；② `composerTokenRanges(plain.slice(start, end))` 恰好返回 `[{start: 0, end: 该段长度}]`（整段恰是一颗命中）。
- **副作用要写进已知限制**：升级前插入的**所有**旧格式区间（如 `$技能` + `[{0,3}]`）都会被判非法而丢弃，不止「错误大胶囊」——未发送草稿里的正常旧胶囊也会降级成纯文本，与历史消息口径一致。
- 落点 1：`syncFromDraft`（`useChatComposerController.ts:388` 采用 `draft.tokenRanges` 处）逐条过滤；**过滤结果与现状文本不同就写回草稿**（现有 `persistDraft` 只在 `tokenRanges === undefined` 时触发，`:404-409`，需把「过滤后变短/变空」也纳入触发条件）。不写回的话坏区间会永久留在 store 里循环，自愈只治当前帧。
- 落点 2：`useState` 初始化的 `initial.tokenRanges`（`useChatComposerController.ts:250-252`）同样先过滤——否则首帧仍会把旧区间下发给 `setTokenRanges`（`NativeChatComposer.tsx:448,481`）画出大胶囊，要等 `syncFromDraft` 才清。
- 落点 3：全屏入口。`ChatTabScreen.tsx:198-213` 组装 payload 时读 store 的 `tokenRanges` 并 **remap 到 `payload.text`**，随后 `PromptEditorScreen.tsx:96` 原样塞进 `confirmedRangesRef`——所以过滤必须做在 `ChatTabScreen` 组装处、且**针对 remap 后的 `payload.text`**（对 `entryDraft.text` 过滤会坐标错位）。全屏侧不做额外改动。

**既有测试迁移清单**（改正则后这些断言会成片翻红，必须先迁移再判实现对错；不迁移会把「预期变化」误判成「实现错了」）。

**迁移总规则**（先定规则，避免同一条用例被两种改法打架）：断言「水化 / 兜底扫描结果」的用例——**文本保持旧格式不动**，只把期望改成新正则下的结果（如 `$技能` → `[]`）；断言「插入后明文 / 区间」「合成 LINK 文本」的用例——**明文统一补终止符**，区间 end +1、光标右移。两类互斥，逐条按用例意图选定。

| 测试文件 | 受影响处 | 迁移动作 |
|---|---|---|
| `__tests__/composer-highlight.test.ts` | `:7-76` 全部 token 用例 | 改为逐条读 `fixtures/composer-token-cases.json`；`splitComposerTokenSegments` 用例按新区间重写 |
| `__tests__/atomic-range-delete.test.ts` | `:20-126`（如 `:121` 的 `'@a.md 和 $apm-recall'`） | 明文与区间统一补终止符（`@a.md@ 和 $apm-recall$`），end +1 |
| `__tests__/native-composer.test.tsx` | `:98-158`、`:225-244`（T-NC5）、`:246-257`、`:260-287`（T-NC6：`scanTokensToRanges('看看 @src/a.ts 后续')` 期望 `[{3,12}]`）、`:472-483`、`:485-503`（`setText` 旧 token 合成）、`:820-827`（CR-fix-11 旧格式 `@a/b` 区间仍期望合成） | 断言 LINK 文本保留完整 `$x$`、destination 不含终止符；新 `synthesizeToken` 对首尾不等的旧 token 原样返回，相关期望按新明文重算 |
| `__tests__/prompt-editor-screen.test.tsx` | `:595-604`、`:667-671`、`:700-703`（插入后明文）；`:718-783`（D10：`$A`→`$A$`、`$A$B`→`$A$$B$`，光标 2/4 → 3/6）；`:785-832`（D11：初始 `$A$B`→`$A$$B$`，删 A 得 `$B$`，再插 C 得 **`$B$$C$`**（光标 6），不是 `$B$C$`） | 明文断言改 `$name$` / `@path@`，光标与区间随之右移 |
| `__tests__/composer-input-dom.test.ts` | **整个文件**：T-CW2 `:37-41`、T-CW3 `:43-47`、`{{$time}}` token 模式 `:98-100`、原子删 `:111-118`、`:131-135` | 该文件直测 `renderHighlightHtml` / `atomicDeleteRanges`（`web/composer-input/webview/runtime/editor.ts:103,137` 消费 `composerTokenRanges`），用例明文与区间统一补终止符 |
| `__tests__/use-chat-composer-controller.test.tsx` | `:628-639`、`:658-662`、`:719-743`、`:1101-1116`（旧明文断言）；`:232-274`/`:276-316`（T-CA9①②）、`:347-399`（T-CA9③b）、`:401-445`（T-CA9④）（均为 `[0,13],[13,18]` 类旧格式区间，会被自愈丢弃）；`:955-974`（T-CA3 持久化旧区间）；`:976-990`、`:1027-1053`、`:1056-1073`、`:1075-1099`、`:1118-1145`（`tokenRanges:[{0,3}]` 配旧明文）；`:665-678`（未完成 `@` 查询替换）、`:690-717`（连插两颗 `$` 技能，cursor 13 会落到新终止符内侧）、`:787-803`（seed `$时序图大纲` 无 ranges，兜底扫描期望反转）、`:805-840`（T-CA10）、`:842-887`（`$A$A`）、`:889-903`（`换个会话 $技能` 兜底扫描） | 明文补终止符、区间 end +1；无 ranges 的兜底扫描类断言按新正则重算（`$技能尾追` → `[]`）；**T-CA3（`:1009-1017`）期望反转**为 `[]` |
| `__tests__/composer-fullscreen.test.tsx` | `:501-543`、`:545-579`、`:581-606`（三条 T-CA8：`$技能` / `$技能尾追` + `[{0,3}]`；第三条兜底扫描期望也会从 `[{0,3}]` 变 `[]`） | 明文补终止符、区间 end +1；兜底扫描类期望改 `[]` |
| `__tests__/chat-conversation-panel.integration.test.tsx` | `:989-1014`（T-CA6：`$技能尾追` + `[{0,3}]`，断言 `setText` 第三参） | 区间随明文右移；兜底扫描期望改 `[]` |

**T-CA8 的精确定位**：F-A8「维持不动」只指 `__tests__/use-chat-tab-message-actions-rollback.test.ts` 里「回滚草稿不带 tokenRanges」那条断言；`use-chat-composer-controller.test.tsx` 内的 T-CA3/T-CA4/T-CA8 系列因 ranges 形态变化**都要改**（见上表）。

### D1-7 影响面清单

| 文件 | 类型 |
|---|---|
| `apps/mobile/src/components/chat/composer-highlight.ts` | 改：正则 + `isValidTokenRangeText` + 头注释 |
| `apps/mobile/src/components/chat/native-composer/token-ranges.ts` | 改：`synthesizeToken` 剥两端 |
| `apps/mobile/src/components/chat/useChatComposerController.ts` | 改：skill token 带终止符、`onAtPickerConfirm` 补 `@`、`syncFromDraft` 形态自愈 |
| `apps/mobile/src/screens/stack/PromptEditorScreen.tsx` | 改：`insertSkillToken` / `insertPathTokens` |
| `apps/mobile/src/web/chat-transcript/webview/ui/render/RefTokenText.tsx` | 改：命中后消费终止符 |
| `apps/mobile/__tests__/fixtures/composer-token-cases.json` | 新增 |
| 测试（mobile）：`composer-highlight.test.ts`、`composer-input-dom.test.ts`、`native-composer.test.tsx`、`composer-token-insert.test.ts`、`use-chat-composer-controller.test.tsx`、`composer-fullscreen.test.tsx`、`chat-conversation-panel.integration.test.tsx`、`use-chat-tab-message-actions-rollback.test.ts`（T-CA8 维持）、`prompt-editor-screen.test.tsx`、`atomic-range-delete.test.ts`、`chat-transcript-ref-token.test.ts`、`code-editor-boot-script.test.ts` | 改/补 |
| core 测试（实现零改动，只加断言）：`test/chat/scan-at-path-attachments.test.ts`、`test/chat/scan-skill-attachments.test.ts`、`test/chat/composer-at-path.test.ts` | 补用例 |

**不动（实现）**：`packages/core/src/**`、`apps/desktop/**`、`apps/mobile/src/components/chat/FileReferencePicker.tsx`。core 侧只改测试（`packages/core/test/chat/scan-at-path-attachments.test.ts`、`scan-skill-attachments.test.ts`、`composer-at-path.test.ts` 三个文件补用例）。

## 验收清单

牙齿判据：具体可执行、实现错则红、实现对则绿。

- **F-A1**：用例表九条全绿。牙齿：正则改回无尾终止符版本，至少 4 条翻红（`$写文档总结`→`[]`、`$A$$B$` 分段等）。
- **F-A2**：**在 handler 层断言**，不要放在 `composer-token-insert.test.ts`——`buildTokenInsertion` 零改动、拿到什么 token 就登记什么，在它自己的测试里传 `$写文档$` 属自证，handler 忘补终止符也不会红。落点分两半：`use-chat-composer-controller.test.tsx`（dock 选 skill）断言「明文 `$写文档$`（5 字符）、`current().tokenRanges` 为 `[{0,5}]`、cursor `5`」；`prompt-editor-screen.test.tsx`（全屏选 skill）**只断言明文与光标**——全屏 `setText` 只收 `(text, {start, end})`（`PromptEditorScreen.tsx:229-232`）、`onSaved` 只回 text（`:310`），ranges 无观测出口；**不要用「再插第二颗」间接锁**，新语法下 `detectQuery('$A$', 3, '$')` 因「触发符前须空白」返回 null（`composer-at-path.ts:39-48`），第二颗无论如何都追加到光标处，锁不住登记行为。全屏侧的 range 登记本迭代不设断言，属已知盲区（写进风险）。区间登记口径见 `composer-token-insert.ts:43-45`（`offset + token.length`），与用例表 end=5 一致。
- **F-A10**：全屏入口自愈（落点 `chat-conversation-panel.integration.test.tsx` 或 `chat-tab` 侧用例）——store 里放 `text='$技能尾追'` + `tokenRanges=[{0,5}]`，打开全屏后 mock 的 `PromptEditorScreen` 捕获 props，断言传入的 ranges 已被滤空（`[]`）；另断言过滤基准是 remap 后的 `payload.text`（构造「entryDraft 文本与 payload 文本不同」的场景，若过滤误用 `entryDraft.text` 则区间判定错位、该断言红）。
- **F-A3**（用户报告的核心场景，落点 `use-chat-composer-controller.test.tsx`）：正文 `帮我$写文档$总结` 走回滚链 → 恢复草稿不带 ranges → 水化兜底扫描 → 断言 ranges `[{2,7}]`（只含 `$写文档$`），`总结` 不入胶囊。牙齿：正则去掉尾终止符要求即红。
- **F-A4**：core 扫描器**实现零改动**即可用：`scanAtPaths('看 @notes/a.md@ 谢谢')` 出 path `/notes/a.md`（core 一律补前导 `/`，见 `attachment-scanner.ts:52-57` + `vfs-path-mapper.ts:51-60`，既有用例 `scan-at-path-attachments.test.ts:16` 同款期望）；`scanAtPaths('树 @notes/@')` 出 path `/notes/`（目录尾 `/` 保留）；`scanSkills('$写文档$就好')` 出 skill `写文档`（行首位置满足 `(?<!\S)`）。
- **F-A5**：水化自愈（落点 `use-chat-composer-controller.test.tsx`）——草稿 `text='$技能尾追', tokenRanges=[{0,5}]` → `syncFromDraft` 丢弃该区间，`current().tokenRanges` 变 `[]`；`text='$A$$B$'` 合法区间全保留。**必须同时断言写回**：过滤后 store 里的草稿 ranges 已是 `[]`（spy `persistDraft` 的入参，或过滤后重建 controller 再读 `readChatComposerDraftState` 仍为 `[]`）。牙齿：去掉过滤即红；把写回那一步删掉（只治当前帧）时写回断言即红。
- **F-A6**：`composerAtPath.detectQuery('$写文档$总结', 7, '$')` 返回 null（cursor 7 = 整串长度，光标停在末尾）；补一个 `detectQuery('$写文档$', 5, '$')` 同样 null 的正常光标用例（锁死「触发符前须空白」隐式依赖）。
- **F-A7**：`RefTokenText` 新格式消费终止符、旧格式贴邻不退化。五组用例（`chat-transcript-ref-token.test.ts` 补）：
  - `看$写文档$哈`（附件 skill `写文档`）→ 胶囊包 `$写文档$`，`哈` 在外，无裸终止符；
  - `$A$B`（附件 skill A、B）→ **旧格式**两颗各自成胶囊（不因消费终止符把 `B` 的 `$` 吃掉，否则 `B` 沦明文）；
  - `@docs/a.md$写作`（附件 path + skill）→ 旧格式两个胶囊并存；
  - `$写作`（附件 skill 只有 `写`）→ 胶囊 `$写` + `作` 明文（`end` 处不是触发符就不消费，锁住字符判定）；
  - `$A$$B$` / `@docs/a.md@$写作$`（新格式）→ 每颗消费自己的终止符，中间不出现裸 `$`/`@`。
- **F-A8**：T-CA8 维持（回滚不带 tokenRanges 的原断言不动，防误改）。
- **F-A9**（真机）：插入 skill/文件引用后胶囊显示 `$写文档$` / `@a.md@`，退格删终止符整颗删除，胶囊后继续打字不再吞入。
  - **后手（2026-10-29）**：真机验收后追加两条后续改动——Android 输入框胶囊**不再绘制**成对终止符（`RoundedBackgroundSpan.trimPairedDelimiters`，只裁视觉、明文不变），气泡里的引用胶囊只显示名字（`RefTokenText` 的 `displayText`）。因此本条的真机期望改为「胶囊只显示 `写文档` / `a.md`」，退格与继续打字口径不变。

## 风险点

1. **历史消息回滚降级为纯文本**（拍板路线固有代价）：升级前发送的 `$skill总结` 回滚后既不是大胶囊也不再是胶囊。若真机反馈不可接受，后手是「附件字面量反推」方案（`RefTokenText.findLiteralTokenMatches` 思路）或「发送时持久化确认区间」，本 SPEC 不含。
2. **胶囊内显示双 `$`**：`$写文档$` 两美元符号可见；相邻两胶囊明文出现 `$$` 连排。需真机截图确认；若要美化（只显示 `$写文档`）须承担 `onChangeText` 基线错位风险（native 库行为只能真机验证）。
   - **已收口（2026-10-29，真机确认）**：风险 2 的原判断（「美化须承担 onChangeText 基线错位」）**不成立**。胶囊是 `ReplacementSpan`，绘制什么、占多宽全由 span 自己算，与 `onChangeText` 基线无关；给基类加 `trimPairedDelimiters`（只对 TOKEN 开启，LINK 恒等）即裁掉成对终止符，明文/区间/发送/回滚零改动。气泡侧同理（`RefTokenText` 渲染裁字）。双 `$` 不再显示。
3. **IME/原生行为未验证**：终止符在中文 IME 组合态、`setComposingText`、LINK 解析下的表现只能真机回归（`react-native-enriched-markdown@1.1.1` + `patches/`，仓库内无法静态验证）。
4. **发给模型的文本多一个 `$`**：正文 `$skill$` 原样入库并进提示词；`skillAttach` 按 skillName 挂载不受影响，token 计数有极小变化——接受。
5. **双端形态分叉**：desktop 读到 mobile 写入的 `$写文档$`（复制粘贴、跨端同步会话正文）时，其旧高亮停在 `$写文档` 并留一个裸 `$`；desktop 自己插入仍是 `$写文档`。纯视觉、无功能影响。若日后要求双端一致，另立迭代（届时才动 core `formatToken` 与 desktop 正则，并补双端一致性用例）。
6. **三处正则更彻底地分叉**：mobile 与 desktop 从此不再逐字相同，`composer-highlight.ts` 头注释里的「严格对齐桌面蓝本」必须删，否则误导后人。

## 已决口径（原「待确认」两项已随总纲拍板，不再开放）

1. `$skill$` 与 `@path@` **双终止符同时做**（用户原话「类似的文件引用也是」，总纲「路线拍板」同口径）；`@` 侧同样在 mobile 插入处补尾 `@`。
2. 胶囊内显示双 `$` / 双 `@` **接受**（正确性优先，LINK 文本必须与明文逐字一致）；真机截图后若要美化，另立迭代承担 `onChangeText` 基线错位风险。

## 落地

1. 按 RULE 开迭代 worktree 分支后动代码；本 SPEC 已落主仓 `docs/Iterations/`，提交由用户决定。
2. 实现前先 `git grep` 复核本文行号（基于 2026-10-27 main，可能有漂移）。
3. 验收命令（**先 build core**——mobile jest 把 `@novel-master/core/*` 映射到 `packages/core/dist`（`apps/mobile/jest.config.js:71-74`），干净 worktree 不 build 会 module-not-found；再重建 WebView，`RefTokenText.tsx` 改了）：

```
cd /d D:\Dev\Js\novel-master && npm run build -w @novel-master/core
cd apps/mobile && npm run build:webview && npx jest \
  __tests__/composer-highlight.test.ts __tests__/composer-input-dom.test.ts \
  __tests__/native-composer.test.tsx \
  __tests__/use-chat-composer-controller.test.tsx __tests__/composer-token-insert.test.ts \
  __tests__/prompt-editor-screen.test.tsx __tests__/chat-transcript-ref-token.test.ts \
  __tests__/atomic-range-delete.test.ts __tests__/code-editor-boot-script.test.ts \
  __tests__/composer-fullscreen.test.tsx __tests__/chat-conversation-panel.integration.test.tsx \
  __tests__/use-chat-tab-message-actions-rollback.test.ts --maxWorkers=2

cd packages/core && node scripts/run-tests.mjs \
  test/chat/scan-at-path-attachments.test.ts test/chat/scan-skill-attachments.test.ts \
  test/chat/composer-at-path.test.ts
```

（F-A6 的 `detectQuery` 用例放 `packages/core/test/chat/composer-at-path.test.ts`；F-A4 的扫描用例放那两个 scan 测试文件——core 实现零改动，只加断言。）

4. **真机验收前先 `npm run build:webview:native`**（`build:webview` 只写 `webview-dist/`，真机加载的是 `android/app/src/main/assets/webview/` / `ios/NovelMaster/WebViewDist/`）。
5. 收口后 changelog 走 `novel-master-changelog` skill 的 Unreleased 段（一条）。
