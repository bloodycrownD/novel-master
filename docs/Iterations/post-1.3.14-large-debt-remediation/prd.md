---
date: 2026-07-21
dependency:
  - Iterations/post-1.3.14-code-review/prd.md
  - Iterations/implementation-simplification/prd.md
  - Iterations/desktop-app/prd.md
---

# 剩余大债收敛（X1 / X2 / E2）PRD

## 背景

`post-1.3.14-code-review` 全量审查与后续整改波次已闭合多数 P1 正确性与偶然 hop 项（含 D1/B4/A1–A5/A7、门闩 `resolveComposerSendIntent` 进 core、E1 死拼串等），并已合并入 `main`。

仍开放、且不宜再塞进「报告型 CR 随手修」的**大债**为：

| ID | 债 | 性质 |
|----|----|------|
| **X1** | Desktop **renderer** 大量直连 `@novel-master/core*`（34 个源文件：纯函数/类型/文案/表单） | 违背 `desktop-app`「renderer 禁止 import core」；属层边界，非用户功能缺口 |
| **X2 剩余** | Chips 判定、at-path 纯函数、annotate store、批注高亮算法等双端近复制（门闩子项已关） | 费力实现；用户可见主路径已基本一致 |
| **E2** | Mobile WebView `ui` 直读全局 `state` | P2 维护债；用户无感；作附属工作流 |

**不纳入本迭代**：A6（hydrate 启发式 Nit）、C8（局部 worktree 命名 Nit）、Picker/Typeahead UI 壳强行统一、X1 与 Mobile「允许直连 core」不对称的产品化（Mobile 维持现状）。

与 `implementation-simplification` 分工：本迭代聚焦 **Desktop 沙箱边界 + 双端纯函数单点 + WebView 分层纪律**；不重开其已合入的 Runner/VFS 编排正确性 P0。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| X1 层边界闭合 | Desktop **renderer** 源码 **零** `import`/`from` `@novel-master/core`（含纯函数、类型、文案）；**eslint/CI 门禁**失败即挡 |
| 用户无感 | Chat（Composer/`@path`/chip/批注/回滚/流式守卫）、Settings（Agent/事件/采样等）、Workplace 树标签等 **行为零回归**（双端既有自动测绿；关键手工烟测见验收） |
| X2 高 ROI 单点 | annotate store API、at-path 平台无关纯函数、Chips `isComposerStatusAttachment`/`partition*`、批注高亮纯算法 **各仅一处定义**；Desktop/Mobile 只留壳 |
| E2 纪律 | 既有直读可渐进收敛；**新** CT ui 组件禁止 `import { state }`；文档写明例外（流式岛） |
| 不恶化 X2 | X1 迁出的纯逻辑须落在 **双端可复用承载**（shared/core 再经 Desktop 合法出口），禁止 Desktop/Mobile 再抄一份 |

## 用户与场景

| 用户 | 场景 |
|------|------|
| 终端作者 | 发消息、`@` 引用、状态 chip、批注、回滚、设置 Agent/事件——与整改前一致，无新功能承诺 |
| Desktop 维护者 | 改 chip/门闩/表单文案时不再在 renderer 深依赖 core；新增 renderer 代码被 lint 拦住直连 |
| Mobile 维护者 | 与 Desktop 共用纯函数单点；WebView 新 UI 不扩大对全局 state 的依赖 |
| 审查 / CI | renderer→core 成为可自动失败的门禁，而非文档约定 |

## 范围

### 包含范围

1. **X1**：盘点并迁出 renderer 全部 `@novel-master/core*` 依赖；提供合法出口（shared 包 / desktop `shared` 再导出 / preload 暴露的纯函数面等——实现选型在 SPEC）；Vite/eslint 门禁；文档对齐 `desktop-app` 与 `ipc-hop-rationale`（废止「仅禁 runtime/DB」缝隙叙事，本迭代口径为**禁一切**）。
2. **X2 剩余**：annotate session store、composer-at-path 纯函数（不含 Mobile mention 专属）、Chips 判定/partition、annotate 高亮纯算法（平台 DOM wrap 保留）；双端改调单点。
3. **E2 附属**：规范 + 新组件禁直读；可选渐进把 `RowList`/`MessageRow`/`StreamTail` 改为 props（不阻塞 X1/X2 门禁若未完成全量）。
4. **回归**：既有 Composer/annotate/chip/@path/Agent 编辑相关自动测；必要时补「renderer 无 core import」契约测。

### 不包含范围

1. 新用户功能或双端入口壳统一（Desktop 浮动条 vs Mobile 原生菜单保持有意差异）。
2. Mobile 禁止直连 `@novel-master/core`（同进程模型不变）。
3. 全仓 `implementation-simplification` 未闭合的 IPC 样板压缩（非本债）。
4. A6/C8 Nit；强制统一 FileReferencePicker / AtPathTypeahead 视觉实现。
5. 假扁平化：破坏 Electron IPC/沙箱、把 DB/service 工厂塞进 renderer。

## 核心需求（5 条）

1. **X1 禁令权威化**：renderer 禁止一切 `@novel-master/core*`；与 CR X1、desktop-app SPEC 一致；门禁可自动执行。
2. **合法共享承载**：迁出的纯逻辑须可被 Mobile 与 Desktop 共用，避免 X2 回潮。
3. **X2 四处高 ROI 单点**：store / at-path 纯函数 / chip 判定 / 高亮算法各单源；平台只留适配壳。
4. **行为零回归**：不改变已发版 Composer 硬合同、中文 chip、append 晚清、批注语义、设置页可编辑行为。
5. **E2 不扩大债**：新 ui 组件禁直读全局 state；全量 props 化可为后续 phase。

## 验收标准

- [ ] Given Desktop renderer 源码树，When 检索 `@novel-master/core`，Then **零命中**（测试文件策略在 SPEC 钉死：禁或允许仅 type-only 等——默认与源码同禁）。
- [ ] Given CI/本地 eslint（或等价门禁），When renderer 新增 core import，Then **失败**。
- [ ] Given 既有 desktop/mobile Composer·annotate·chip·at-path·门闩相关自动测，When 本迭代合入，Then **全绿**；无「为过测改期望」的行为退化。
- [ ] Given annotate store / at-path 纯函数 / chip 判定 / 高亮纯算法，When 改一处规则，Then Desktop 与 Mobile **无需各改一份实现文件**（仅可能改壳接线）。
- [ ] Given 新建 CT `ui/**` 组件，When 代码审查/门禁，Then 不得 `import { state } from '.../runtime/state'`；与 SPEC 对齐：既有 `RowList`/`MessageRow`/`StreamTail` 可暂留直读（`StreamTail` 为 documented exception），**新** ui 组件禁直读。
- [ ] Given 作者完成 Chat 主路径烟测（发消息、仅 chip 可发、`@path`、批注、回滚），When 对比本迭代前，Then **无可见回归**（`qa: manual_user`，不挡自动门禁）。

## 约束与依赖

- 依赖审查结论：`Iterations/post-1.3.14-code-review/`
- 依赖沙箱叙述：`Iterations/desktop-app/`、`implementation-simplification`（必要 hop 保留）
- **张力待 SPEC 拍板**：`stored-config-validity` 曾允许 renderer 本地 `assess`——本 PRD 要求迁出后经合法出口，**不**保留 renderer 直连 core 例外

## 风险与待确认项

- X1 与 X2 必须同迭代推进，否则禁直连易迫使 Desktop 再抄一份逻辑。
- Settings/config-forms 体量大；若排期紧张，SPEC 可分 phase，但 **PRD 成功指标仍要求门禁 + 行为零回归**（未迁完不得开「允许 Settings 直连」口子）。
- E2 全量 props 化成本高；PRD 允许「纪律先于全量」以免拖死 X1/X2。