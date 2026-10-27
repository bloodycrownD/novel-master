# 2026-10-27 chat-ux-fixes 三修 SPEC

## 用户口述需求（2026-10-27）

三条 UI 修复诉求，SPEC 已生成：`docs/Iterations/chat-ux-fixes-2026-10/spec.md`。

1. 回滚重放时 skill 胶囊与尾随普通文本并成大胶囊；用户思路 `$skill$` 加终止符，「类似的文件引用也是」。
2. 子代理复用 sessionId 后第二次任务卡片点不进子会话。
3. 手机端聊天/文件预览 markdown 表格、代码块折行太挤，要横向滚动。

## 路线拍板（AskUserQuestion，用户确认）

- F1 **只做 `$skill$` 双 `$`**——否决了「发送时持久化确认区间到消息 raw + 历史附件字面量反推」路线。代价：升级前发送的历史消息回滚后降级纯文本（不成胶囊、也不再大胶囊）。
- F2 **H1+H2 全修**（pending 卡读 input.sessionId + manager settled 单元替换吸收），desktop 不对称修。
- F3 **纯 CSS**（样式单源 pre/table 改横滚），不做 HTML 包装 div；旧 T-CB10「禁止 overflow-x:auto」禁令废止。
- **端范围（用户追加确认）：三条 bug 全部只在 mobile，实现范围一律限 mobile。** 因此 F1 的终止符只在 mobile 的 composer 插入 handler 里拼，**不改 core `composerAtPath.formatToken`**（它被 desktop 与 `VfsMoveDirPicker` 共用），也不改 desktop 高亮正则；双端明文形态分叉（mobile `$name$` / desktop `$name`）记为已知结果。

## 探索关键结论（三个 readonly 子代理，主代理已抽查核实）

- F1 根因：回滚只写 `{text}` 不带 tokenRanges → 水化兜底正则扫描吞到空格 → 错误区间还被写回草稿固化。字符类 `[^\s$@]` 本就排除 `$`，**core 发送扫描正则零改动**即可切准 `$skill$` / `@path@`（`@([^\s@]+)` 在 `@` 停、`$([^\s$/@]+)` 在 `$` 停）。detectQuery 靠「触发符前须空白」天然不误弹（终止符前是名称末字）。正则不上移 core：`web/code-editor`、`web/composer-input` 两个 WebView 包零 core 依赖，上移会拖 barrel 进 bundle——改用共享 fixture `packages/core/test/fixtures/composer-token-cases.json` 双端一致性测试。
- F2 双根因：H1 复用路径不发 child-created 事件、`message-blocks.ts` pending 分支只按 title 匹配不读 `tool_use.input.sessionId`；H2 30s 宽限内 settled consumptive 单元吞掉二次 RUN_STARTED（主 run 在 manager `:1180-1203` 有替换吸收先例，子会话路径缺）。
- F3 聊天与文件预览共用 `prepareTranscriptRichHtml` + 样式单源 `rich-content-styles.ts`（改一处三 root 全生效）；表格无任何 CSS 规则；mermaid 源码 pre 必须豁免横滚；改后必须 `build:webview`（dist 有测试直读）。

## 文档审查（spec-check-loop）

- 2026-10-27：合订 SPEC 拆为总纲 + 三个 feature SPEC（`features/A-composer-token-terminator` / `B-subagent-reuse-card` / `C-mobile-md-horizontal-scroll`），便于三路并行开发。
- 第 1 轮 readonly 审查：No-Go，5 条 P0（C 漏 mermaid 失败态 `pre.mermaid-failed` 豁免；B 替换吸收会清掉 consumptive 标记；A 无条件消费终止符会吞旧格式贴邻 token；A 两处期望值与代码事实不符）+ 9 条 P1。已由主代理 doc-fix 全部闭合，进入第 2 轮复审。

## 待确认遗留（SPEC「待确认问题」节）

`@路径@` 对称终止符、胶囊内显示双 `$`、子会话屏补 pendingSubagentSessions、桌面表格是否同步——均给了默认值，用户未逐条拍板。
