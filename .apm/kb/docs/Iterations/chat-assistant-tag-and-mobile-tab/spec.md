---
date: 2026-07-19
---

# 助手伪标签可见性与对话态藏底栏 技术规格（SPEC）

> **PRD**：`.apm/kb/docs/Iterations/chat-assistant-tag-and-mobile-tab/prd.md`  
> **需求来源**：PRD（已确认）  
> **范围**：A — Mobile 助手伪标签不挖空 + Desktop 回归；B — Mobile 对话态隐藏 MainTabs

## 设计目标

1. Mobile 富文本助手气泡中，未知/伪 XML 标签以字面量可见，禁止 `discard` 挖空；安全禁标签行为不回退。
2. Desktop 助手气泡保持现网 escape 可见，本迭代以回归验收为主，不改渲染栈。
3. Mobile `chatSubview === 'conversation'`（含「聊天工作区」）隐藏 MainTabs；回 `sessions` 恢复；不破坏 conversation-back。
4. 不改消息落库、不改 `** 空格**` Markdown 容错；工作区 `.md` 预览不强制验收（可随共用管线顺带变化）。

## 总体方案

```text
A. 伪标签可见（Mobile 主改；Desktop 回归）
   prepareTranscriptRichHtml:
     decode(入口) → markdown-it(html:true) → sanitize(escape 未知/禁止标签)
       → decode(出口：保留 &lt; &gt;，仍解 &amp;quot; 等)
   TrustedHtml 收到含 &lt;xxx&gt; 的 HTML → 用户看见 <xxx>
   Desktop MessageList: 不改代码；验收同一样例

B. 对话态藏底栏（仅 Mobile）
   ChatTabScreenContent:
     chatSubview==='conversation' → setOptions({ tabBarStyle: { display:'none' } })
     sessions → 显式恢复与 RootNavigator 等价的 tabBarStyle
   Composer / 对话面板：无底栏时补 insets.bottom
   E2E：ensureWorkspaceModel 勿在 conversation 点 ~我的
```

**现状约束（探索确认，勿重复实现）**

- 挖空根因：`sanitizeRichHtml` 的 `disallowedTagsMode: 'discard'`。
- **仅改 `escape` 不够**：`prepareTranscriptRichHtml` 出口 `decodeLiteralHtmlEntities` 会把 `&lt;`/`&gt;` 还原成裸标签，再经 `TrustedHtml` → `innerHTML` 仍挖空。必须配套调整出口 decode（或等价：最终串对用户可见尖括号以实体形式保留）。
- Web transcript bundle **无**第二套 sanitize；富文本 HTML 只信 RN `prepareTranscriptRichHtml`。
- Desktop：`react-markdown` + `remarkGfm`、无 `rehype-raw`，伪标签已 `&lt;…&gt;` 可见。
- 藏底栏：无既有 `tabBarVisible` / 动态 `setOptions` 先例；Stack 全屏页靠压栈藏栏，与本需求不同。
- `conversationPanel === 'workspace'` 仍属 `chatSubview === 'conversation'`，一并藏栏。

## 最终项目结构

```text
apps/mobile/
  src/components/rich-content/
    sanitize-rich-html.ts          # discard → escape（或等价）
    decode-literal-html-entities.ts # 出口策略：不还原 lt/gt
    prepare-transcript-rich-html.ts # 管线顺序不变；行为随上两者变
  src/web/shared/
    decode-entities.ts             # 与 RN decode 语义对齐
  src/navigation/RootNavigator.tsx # 可选：抽出 buildTabBarStyle
  src/screens/tabs/ChatTabScreen.tsx  # setOptions 藏/显底栏
  src/components/chat/ChatComposer.tsx  # 或 ConversationPanel：补 bottom inset
  e2e/pageobjects/app.page.ts      # ensureWorkspaceModel 路径
  __tests__/
    sanitize-rich-html.test.ts
    prepare-transcript-rich-html.test.ts
    decode-literal-html-entities.test.ts
    （可选）chat-tab-bar-visibility 相关测

apps/desktop/
  （渲染不改；可选轻量回归测 MessageList / react-markdown）
```

## 变更点清单

| ID | 文件 / 模块 | 变更 |
|----|-------------|------|
| C1 | `sanitize-rich-html.ts` | `disallowedTagsMode: 'escape'`（未知与 DISALLOWED 标签转实体，不再 discard 剥壳） |
| C2 | `decode-literal-html-entities.ts` | **出口路径**不再把 `&lt;`/`&gt;` 解码为 `<`/`>`；保留对 `&amp;`/`&quot;` 等防双重编码所需的解码（与现有 quot 测对齐） |
| C3 | `decode-entities.ts`（web） | 与 C2 语义对齐（注释已要求双端一致） |
| C4 | `prepare-transcript-rich-html.ts` | 通常无需改调用顺序；若 decode API 拆成 `decodeForMarkdownInput` / `decodeAfterSanitize`，在此接线 |
| C5 | `sanitize` / `prepare-transcript` 单测 | 增 T-S1/T-S2；修订「script 从输出中完全消失」为「不可执行且安全」——允许字面量 `&lt;script&gt;` 或保持剥离策略见下「安全定案」 |
| C6 | `ChatTabScreen.tsx` | `useLayoutEffect`：按 `chatSubview` `setOptions({ tabBarStyle })` |
| C7 | `RootNavigator.tsx`（推荐） | 抽出 `buildMainTabBarStyle(tokens, insets)`，供 screenOptions 与恢复共用 |
| C8 | Composer / ConversationPanel | conversation 且底栏隐藏时，底部 padding ≥ `insets.bottom`（避免贴 Home Indicator） |
| C9 | `e2e/.../app.page.ts` | `ensureWorkspaceModel`：若已在 conversation，先回列表或改用对话内入口，再进「我的」 |
| C10 | Desktop（可选） | 一条回归单测锁 escape；**非** blocking 代码改动 |

### 安全定案（与 chat-rich-render 契约）

- **硬线不变**：`script` / `iframe` / `object` / `embed` / `form` / 事件属性 / `javascript:` scheme **不得可执行**。
- 采用 `escape` 后，危险标签可能以**字面量文本**出现在 HTML 中（不执行）。单测从「输出不得匹配 `/script/i`」改为：
  - 不得出现可执行形态（如未转义的 `<script>` 开标签进入 DOM 执行路径）；或
  - 对 DISALLOWED 集合继续 `discard`、仅对「其它非白名单」`escape`（若 `sanitize-html` 难以二分，优先全量 `escape` + 改断言为「实体可见且无执行」）。
- **禁止**为通过伪标签验收而重新引入 `html` 裸标签进 `innerHTML`。

### Desktop

- **不改** `MessageList` / remark 栈。
- 验收：同 PRD 样例字面量可见（现网已满足）。

## 详细实现步骤

- Step 1 — phase-sanitize-escape — blocking: yes — qa: auto：将 `sanitizeRichHtml` 改为 `disallowedTagsMode: 'escape'`（或「DISALLOWED discard + 其余 escape」若库支持且更贴安全测）；用 node 确认 `<xxx></xxx>` / `<file>notes.md</file>` 经 sanitize 后含 `&lt;`…。
- Step 2 — phase-decode-preserve-ltgt — blocking: yes — qa: auto：调整 RN `decodeLiteralHtmlEntities`（及 web `decode-entities`）使 **sanitize 之后**不再把 `&lt;`/`&gt;` 还原；保留 quot/amp 双重编码修复。更新 `decode-literal-html-entities.test.ts` / `quot-display-path.test.ts`。
- Step 3 — phase-prepare-pipeline-verify — blocking: yes — qa: auto：跑通 `prepareTranscriptRichHtml('表现为 <xxx></xxx> 之间没有文本')` 与 `<file>notes.md</file>`，断言输出含实体尖括号且 TrustedHtml 语义下用户可见标签；回归 heading/strong/style。
- Step 4 — phase-security-regression — blocking: yes — qa: auto：更新并保持 T-S3：script/iframe/on*/javascript: 不可执行；按安全定案改断言。
- Step 5 — phase-desktop-tag-regression — blocking: no — qa: auto：可选 Desktop 轻量测；至少文档/手工清单对齐 PRD Desktop 条。
- Step 6 — phase-tabbar-hide — blocking: yes — qa: auto：`ChatTabScreenContent` 按 `chatSubview` `setOptions`；抽出并复用 `buildMainTabBarStyle`；单测或可测钩子断言 conversation → hide、sessions → restore。
- Step 7 — phase-composer-safe-area — blocking: yes — qa: auto：对话态无底栏时 Composer（或面板）补 `insets.bottom`；可用样式常量/测断言 padding。
- Step 8 — phase-e2e-profile-path — blocking: yes — qa: auto：修正 `ensureWorkspaceModel` / 相关 pageobject，避免 conversation 态依赖 `~我的`。
- Step 9 — phase-manual-accept — blocking: no — qa: manual_user：真机 — 富文本开助手挖空样例；对话藏栏 / 回列表进「我的」；系统返回仍回列表；Desktop 同一样例可见。

## 测试策略

### 测试用例

| ID | blocking | 映射 Step | 说明 |
|----|----------|-----------|------|
| T-S1 | yes | 1–3 | 空伪标签：`表现为 <xxx></xxx> 之间没有文本` → `prepareTranscriptRichHtml` 输出含 `&lt;xxx&gt;`（或可见等价），无挖空拼接 |
| T-S2 | yes | 1–3 | `<file>notes.md</file>` → 标签名与 `notes.md` 均可在输出中辨认（含 `&lt;file&gt;`…） |
| T-S3 | yes | 4 | 安全回归：script/iframe/事件/javascript: 不可执行 |
| T-S4 | yes | 3 | `enrichTranscriptRows`：`richText=false` 时 plain `text` 仍含尖括号 |
| T-S5 | yes | 3 | `prepareStreamTailHtml` 定稿 HTML 与 T-S1/T-S2 一致（不挖空） |
| T-S6 | no | 5 | Desktop 助手同一样例不挖空（手工或可选单测） |
| T-N1 | yes | 6 | `chatSubview=conversation` → tabBar 隐藏（`display:'none'` 或等价） |
| T-N2 | yes | 6 | 回 `sessions` → tabBar 样式恢复 |
| T-N3 | yes | 6–8 | 返回链：对话 → sessions 语义不变（既有 back-handler 测保持绿） |
| T-N4 | yes | 7 | 无底栏时底部 inset / composer padding 覆盖 safe area |
| T-N5 | yes | 8 | E2E pageobject 在 conversation 后仍能完成模型/Profile 前置（不点不可见的 `~我的`） |

### 命令（建议）

```bash
npm test -w @novel-master/mobile -- --testPathPattern="sanitize-rich-html|prepare-transcript|decode-literal|quot-display|enrich-transcript|prepare-stream-tail|use-android-chat-back"
# Desktop 若补测：
# npm test -w @novel-master/desktop -- --testPathPattern="message-list"
```

## 兼容性与迁移

- **无 DB / 协议迁移**；仅展示层与导航 UI。
- VFS `FileMarkdownPreview` 共用 `prepareTranscriptRichHtml`：行为随 C1–C2 变化；PRD 不强制验收，但实现时勿引入可执行 HTML。
- 旧消息无需重写；重新 enrich / 打开会话即按新管线渲染。
- E2E 依赖底栏的流程必须改路径（产品路径：列表 →「我的」）。

## 风险与回滚方案

| 风险 | 缓解 | 回滚 |
|------|------|------|
| 出口 decode 抵消 escape | Step 2 与 T-S1 同 PR 合入；禁止只合 C1 | 恢复 discard + 旧 decode（接受挖空回归） |
| escape 后危险标签字面可见 | T-S3；文档接受「可见不可执行」 | DISALLOWED 改回 discard、其余 escape（若可拆） |
| 藏栏后 composer 被 Home 条挡住 | Step 7 + 真机看刘海机 | 去掉 setOptions，底栏常显 |
| E2E 大面积红 | Step 8 与功能同 PR | pageobject 临时 skip Profile 或强制先 back |
| 主题切换后 tabBar 样式残留 | 显式 `buildMainTabBarStyle` 写回，勿只清 display | 同左 |

## Context Bundle（实现参考）

```yaml
iteration_name: chat-assistant-tag-and-mobile-tab
requirement_path: Iterations/chat-assistant-tag-and-mobile-tab/prd.md
spec_path: Iterations/chat-assistant-tag-and-mobile-tab/spec.md
explore_summary: |
  Mobile discard 挖空；出口 decode 会抵消 escape；Desktop 已满足；
  藏栏用 Chat setOptions；composer 需 inset；E2E ensureWorkspaceModel 需改。
impact_files:
  - apps/mobile/src/components/rich-content/sanitize-rich-html.ts
  - apps/mobile/src/components/rich-content/decode-literal-html-entities.ts
  - apps/mobile/src/web/shared/decode-entities.ts
  - apps/mobile/src/screens/tabs/ChatTabScreen.tsx
  - apps/mobile/src/navigation/RootNavigator.tsx
  - apps/mobile/src/components/chat/ChatComposer.tsx
  - apps/mobile/e2e/pageobjects/app.page.ts
constraints:
  - 安全禁 tag 不可执行
  - 不改落库 / 不改 conversation-back 返回语义
  - Desktop 渲染栈不改
blocking_steps:
  - phase-sanitize-escape
  - phase-decode-preserve-ltgt
  - phase-prepare-pipeline-verify
  - phase-security-regression
  - phase-tabbar-hide
  - phase-composer-safe-area
  - phase-e2e-profile-path
```
