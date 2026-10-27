---
date: 2026-10-27
iteration: chat-ux-fixes-2026-10
---

# 手机端交互三修（chat-ux-fixes-2026-10）迭代总纲

> 三个独立 feature 合订一次迭代，**各自有独立 SPEC、可分别实现/合并/发版**。本文件只做索引与跨 feature 约束，实现细节一律以 feature spec 为准。
> 本迭代无独立 PRD：需求为用户口述（2026-10-27），原话内嵌在各 feature spec 的「需求来源」节。

## 需求来源（三条，用户口述原话）

1. 「回滚的时候，skill 胶囊重放到输入框中，此时 skill 会和普通文本结合在一起成为大胶囊。看看有没有办法优化？我一个思路是用 `$skill$` 优化，增加一个 `$`，这样正则准确性提高了。很多问题就好解决了。类似的文件引用也是。」→ **feature A**
2. 「对于一个子代理，第一次是可以正常点击访问的，但是假如复用 sessionid 的话，这个子代理无法点击进入访问。」→ **feature B**
3. 「msg 与文件预览 markdown 表格/代码块展示优化，手机屏幕小，换行展示其实还是太挤了，还是有横向 scroll 更方便一些。」→ **feature C**

## 端范围

**三条 bug 全部只发生在 mobile 端，实现范围一律限 mobile**（用户 2026-10-27 追加确认）。desktop 侧不复刻，core 里被双端共用的函数（`composerAtPath.formatToken` 等）不加终止符。双端行为分叉属已知结果，见各 feature 风险节。

## 路线拍板（2026-10-27，AskUserQuestion）

| feature | 路线 | 被否决的替代 |
|---|---|---|
| A | **`$skill$` 与 `@path@` 双终止符**（终止符=触发符同字符） | 发送时持久化确认区间到消息 `raw` + 历史按附件字面量反推 |
| B | **H1 + H2 全修** | 只修 H1；H1+H2+桌面端对称 |
| C | **纯 CSS**（只改样式单源） | HTML 包装 div；表格包装+代码块 CSS 混合 |

## Feature 索引

| feature | SPEC | 一句话 | 改动文件数（含测试） | 构建产物 |
|---|---|---|---|---|
| **A** composer 胶囊终止符 | [`features/A-composer-token-terminator/spec.md`](features/A-composer-token-terminator/spec.md) | 明文 token 升级为 `$技能名$` / `@路径@`，回滚重放不再吞尾随文本；存量错误区间水化自愈 | 5 源 + 12 测试（另 3 个 core 测试补断言）+ 1 fixture | 需 `build:webview`；真机/APK 需 `build:webview:native`（改了 `RefTokenText.tsx`） |
| **B** 子代理复用卡片 | [`features/B-subagent-reuse-card/spec.md`](features/B-subagent-reuse-card/spec.md) | pending 卡读 `input.sessionId` 优先；settled 子单元替换吸收，二次 run 内容实时 | 3 源 + 5 测试 | 无 |
| **C** markdown 横滚 | [`features/C-mobile-md-horizontal-scroll/spec.md`](features/C-mobile-md-horizontal-scroll/spec.md) | 表格/代码块不折行改横向滚动，样式单源一处改两场景生效 | 1 源 + 3 测试 + 2 旧文档标注 | 需 `build:webview`（真机再 `build:webview:native`） |

## 三条的独立度与并行约束

**功能上完全独立**：A（composer 域）、B（转录/流单元域）、C（WebView 样式域）互不依赖，任一条单独实现、单独合并、单独发版都能闭环，不需要凑齐另外两条。三条的 `depends_on` 均为空。

**文件上零交集**：逐文件核对过（见各 feature 的「影响面清单」），不存在同文件改动冲突。

**但共享构建产物，不能无脑并行跑测试**：

1. mobile 的 `pretest` 会先 `build -w @novel-master/core` 再 `build:webview`（`apps/mobile/package.json`），两路 node 同时 `npx jest` 会同时写 `packages/core/dist` 与 `webview-dist/`；
2. A 与 C 都改了 WebView 内代码，**两条都要重建 WebView**——同批执行时应合并成一次 `build:webview` 再跑各自测试；
3. 派单口径：要么各节点串行跑测试（各自 node 内自带 build），要么由一路统一 `build:webview` 完成、其它路只跑 `npx jest`（jest 单跑不触发构建）。

## 跨 feature 验收（不归属单条，收口时统一跑）

- `cd apps/mobile && npm test -- --maxWorkers=2`（**必须走 `npm test`**：npm lifecycle 才会先跑 `pretest` = build core + `build:webview`；`npx jest` 不触发 `pretest`）
- `cd packages/core && npm test`；`cd apps/desktop && npm test`
- `npm run typecheck --workspaces --if-present`
- 真机一轮覆盖三条：A 的胶囊形态与尾追、B 的复用两次 `task` 点卡、C 的横滚手势与超宽内容

## 全局非目标

- 不做消息元数据持久化 `composerTokenRanges`。
- 不引入哨兵字符（U+200B/U+FFFC 已在前序迭代否决）。
- 不改 desktop 任何行为（三条皆 mobile-only）。
- 不改 core 发送扫描正则与 `composerAtPath` 双端共用函数。

## 汇总风险（细节见各 feature）

| # | 风险 | 归属 | 处置 |
|---|---|---|---|
| 1 | A：升级前发送的历史消息回滚后降级纯文本（既非大胶囊也非胶囊） | A | 拍板路线固有代价；不满意则后手是附件字面量反推，另立迭代 |
| 2 | A：胶囊内显示双 `$`（`$写文档$`） | A | 接受；真机截图后若要美化须承担基线错位风险 |
| 3 | A：双端明文形态分叉，desktop 读新格式会留裸 `$` | A | 纯视觉，接受 |
| 4 | B：H2 假设中高置信 | B | 即便 H1 已足，D2-2 仍是独立缺陷修复 |
| 5 | C：横滚可能抢竖向手势（旧迭代的否决理由） | C | 真机 F-C3 不达标即回退到包装 div 路线 |
| 6 | C：Chromium 58 基线上 `display:block` 表格盒模型表现待真机 | C | 不稳则改包装 div |
| 7 | C：复制按钮随横滚移出视口 | C | 接受（外置会破坏 `pre > .code-copy` 契约） |

## 落地流程

1. 按 RULE 开迭代 worktree 分支后动代码；本目录文档已落主仓供阅读，提交由用户决定。
2. 三条可 3 路并行派单（A / B / C 各一路）。A 内部**不要**再拆「正则+插入」与「合成+自愈」两路——两路都要改 `useChatComposerController.ts`（`:805-843` 与 `:250-410`），同文件并行必冲突，A 走单路串行。执行前先 `git grep` 复核各 SPEC 行号（基于 2026-10-27 main）。
3. 每条独立验收通过后各自合并；收口跑「跨 feature 验收」。
4. changelog 走 `novel-master-changelog` skill 的 Unreleased 段（三条各一条）。
