---
date: 2026-07-20
dependency:
  - Iterations/implementation-simplification/prd.md
  - Iterations/message-attachment-unified/prd.md
  - Iterations/annotate-user-ops-unify/prd.md
  - Iterations/ux-polish-macro-editor-workplace/prd.md
  - Iterations/chat-send-render-refactor/prd.md
---

# v1.3.14→HEAD 全量代码审查（CR 治理）PRD

## 背景

自 `v1.3.14`（2026-07-14）至当前 `main` / `HEAD`，仓库累计约 **221** 次提交（约 650 文件、+39k/−8k 行），并已发布 `v1.4.01`、`v1.4.02`。主交付面包括：常驻工作区与 Composer 附件双管道、批注与 user-ops 协议统一、Mobile WebView/Preact 基建、以及进行中的 worktree→workplace 命名收敛与宏 Tag / FileEditor 滑动。

仓库已有三套互补审查范式，但**缺少统一的合入式 CR 规范**：

| 范式 | 代表迭代 | 本轮关系 |
|------|----------|----------|
| Domain Explore | `core-explore-remediation` | 引用其四维（风格/可维护/正确性/测试）；**不重开**已合入正确性 P0 |
| 健康度审计 | `codebase-audit-remediation` | 已覆盖条目不重复立项；可作回归检查点 |
| 费力实现 | `implementation-simplification` | **强制复用**「偶然 hop / 必要 hop / 费力实现」术语与判定 |

本迭代目标不是立刻改代码，而是：用一份 PRD **钉死审查范围、规则与严重级** → 按包派出只读 CR Agent → 汇总为**审查报告型** `spec.md`（记录发现与建议，不要求可编码 Step / T- 用例）。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 全量覆盖 | 5 个 CR 包（见「核心需求」）各产出一份结构化结论，并汇总进单一 `spec.md` |
| 强制绕弯审查 | **每一包**均含「必要 hop vs 偶然 hop / 费力实现」专节；无收益多层至少标 Should-fix（P1） |
| 严重级可对照 | 每条发现同时给出 **Blocker / Should-fix / Should-Fix / Nit** 与 **P0–P3**，符合下方映射表 |
| 可追溯 | 每条发现附证据（路径/符号/测试或 commit 主题）；注明现行 SSOT 文档（若有） |
| 零重复立项噪音 | 已由 audit / explore / simplification **明确合入**的项：标「已知/已整改」或不重复开条，除非本 diff 引入回归 |

**成功判定（本轮）**：覆盖完成即可——**不要求** Blocker 清零后方可结束审查报告。

## 用户与场景

| 用户 | 场景 |
|------|------|
| 维护者 / 负责人 | 发下一版前了解 1.3.14→HEAD 的正确性、协议、双端一致与费力路径风险全景 |
| CR Agent（本流程） | 严格按本 PRD 的包切分、维度、严重级与产出模板执行只读审查 |
| 后续实现者 | 阅读报告型 SPEC 后，可另开整改迭代（不在本 PRD 强制范围内） |

## 范围

### 包含范围

1. **Diff 基线**：`git` 范围 `v1.3.14..HEAD`（含已发 1.4.01/1.4.02 与 post-1.4.02 未打 tag 增量）。
2. **五包审查**（按交互面竖切，避免按迭代目录横切已废止验收）：
   - **CR-A Core 协议**：session kkv、user_ops / attachments、workplace 引擎、prepare/assemble、发送门闩与差集
   - **CR-B Composer 全链路**：双管道硬合同（状态 chip vs `@path`）、draft、picker、双端一致
   - **CR-C Workplace 改名 + migration**：符号/表/IPC/CLI、`check:workplace-rename`、升级破坏性（旧 `type:worktree`）
   - **CR-D Annotate**：划词批注生命周期、chip 中文口径、append 成功后清空、门闩
   - **CR-E Mobile WebView**：esbuild/资产、Preact ui↔runtime、transcript/富文档行为回归面、TrustedHtml 边界
3. **强制维度**：正确性、层边界、双端一致、测试门禁线索、**绕弯/费力实现（偶然 hop）**。
4. **产出**：各包 CR 结论 + 汇总审查报告型 `spec.md`。

### 不包含范围

1. 本轮**不编码**、不提交修复、不要求可执行 Step / 自动门禁 T- 用例矩阵。
2. 不重开 `core-explore-remediation` / `codebase-audit-remediation` / `implementation-simplification` 已合入条目的「正确性 P0 再猎杀」（除非本范围 diff 引入回归）。
3. 不强制 Android+iOS 真机 blocking smoke（可记建议；手工 smoke 不挡本轮报告完成）。
4. 不把 CI 当前缺失 test/lint 门禁本身当作本 diff 的代码缺陷（可记工程建议 Nit/P3）。
5. 不审查历史 `.apm` 文档回写、Explorer 的 `workspace` 命名（与 workplace 产品线无关）。

## 审查规范与规则

### 术语（与 simplification 对齐）

| 术语 | 定义 |
|------|------|
| **费力实现** | 功能可跑、局部也可能 DRY，但改一处需同步多文件或双端易漂移 |
| **偶然 hop** | 平行装配、无意中间态、分散递减、同质样板、可删除仍正确的中间层 |
| **必要 hop** | Electron IPC 沙箱、事务边界、流式合批、WebView bridge 等**必须保留**的间接层 |
| **绕弯实现** | 与「偶然 hop / 费力实现」同族：多一层无收益间接、用状态补状态、兼容壳叠兼容壳、为过测而绕、跨层泄漏后的补丁链 |

### 严重级映射（必须两套同时标注）

| 合入口径 | P 口径 | 含义 |
|----------|--------|------|
| **Blocker** | **P0** | 数据丢失/协议不兼容/安全/双端严重不一致/升级不可用；或无收益绕弯已造成上述风险 |
| **Should-fix** | **P1** | 高维护性：明显费力路径、偶然 hop、测试缺口、可复现边界 bug（未达 Blocker） |
| **Should-Fix** | **P2** | 工程化/架构债：命名残留、分层漂移、文档与代码 SSOT 冲突（行为仍可接受） |
| **Nit** | **P3** | 风格、注释、可选清理；不挡报告完成 |

**判定提示**：

- 无收益多层但**尚未**造成可见 bug → 至少 **Should-fix / P1**（因本轮强制绕弯维度），不得降为 Nit 了事。
- 必要 hop **不得**仅因「层数多」判 Should-fix；须说明保留理由（IPC/事务/bridge 等）。
- Desktop renderer 直连 `@novel-master/core`、App 自组 user_ops 绕过 `runAgentTurn`、WebView `runtime→ui` 反向依赖 → 默认按层边界违规，至少 Should-fix/P1，视影响升 Blocker/P0。

### 层边界规则（审查时引用）

1. Core 业务能力优先经 `@novel-master/core/{chat,workplace,agent,...}` 公开子路径；App 深挖 `domain/**` / `service/**` 须说明理由。
2. Desktop：**renderer 禁止**直接 import core；经 main IPC。
3. Mobile：允许同进程直连 core；WebView 内遵循 `ui` / `runtime` / `webview-host` 分工（见 mobile WebView 迭代 SPEC）。
4. 发送路径：App 侧附件增量以既有门闩为准；误传 workplace/user_ops 预览应被丢弃的契约若被破坏 → 正确性发现。

### 每包强制产出模板

```text
## CR-<包ID> <标题>
- 范围与 SSOT 文档
- 结论摘要（Go / Go-with-notes / No-Go）
- 发现列表（每条：标题、严重级双标 Blocker|Should-fix|Should-Fix|Nit ↔ P0–P3、证据路径、是否绕弯、建议）
- 绕弯专节：必要 hop 清单 / 偶然 hop 清单 / 费力实现点
- 双端一致性（若适用）
- 测试与门禁线索
- 已知已整改（避免重复立项）
```

### 现行 SSOT 优先级（避免按废止文档验收）

1. Composer 双管道 / chip：以 `composer-two-pipelines-hard-contract` / `annotate-user-ops-unify` 中文 chip 口径为现行。
2. 本轮增量 XML：以 annotate 后 `user-ops` + action 为准（父级 message-attachment 内层标签叙述可能未回写）。
3. 常驻开关：以 `prompts.workplace` / ux-polish 条款为准（旧 persist 块可忽略且不自动升开）。

### Agent 执行规则

1. 只读；禁止改代码、禁止提交。
2. 并行审查五包；包与包之间不重叠改文件结论，交叉问题记「跨包」并在汇总 SPEC 去重。
3. 证据不足标「未读清 / 疑点」，不得臆造 Blocker。
4. 汇总 `spec.md` 为报告型：发现总表、按包摘要、跨包主题、建议后续动作（可选另开整改迭代）——**不含**强制实现 Step / T- 矩阵。

## 核心需求（5 条）

1. **CR 规范权威化**：本 PRD 作为 `v1.3.14..HEAD` 全量 CR 的唯一范围与规则源；Agent 与人工 reviewer 按此执行。
2. **五包全覆盖**：CR-A～CR-E 均完成并带绕弯专节与严重级双标。
3. **强制绕弯审查**：每包必须区分必要 hop 与偶然 hop；费力实现不得遗漏为 Nit。
4. **报告型 SPEC 汇总**：`.apm/kb/docs/Iterations/post-1.3.14-code-review/spec.md` 汇总全部发现与建议。
5. **与历史整改分工**：引用而非重复 audit / explore / simplification 已合入正确性工作。

## 验收标准

- [ ] Given 本 PRD 已确认，When 五包 CR Agent 完成，Then 每包结论含：结论摘要、发现列表（双严重级）、绕弯专节、证据路径。
- [ ] Given 任一条「无收益多层」发现，When 写入报告，Then 严重级 ≥ Should-fix/P1（或升 Blocker/P0），且说明为何不是必要 hop。
- [ ] Given 汇总 `spec.md` 已落盘，When 对照本 PRD，Then 含五包覆盖声明、发现总表、跨包去重说明，且**不**包含强制编码 Step / T- 用例矩阵作为完成条件。
- [ ] Given 某条与 historical remediation 重复，When 报告出现，Then 标注「已知/已整改」或合并引用，不作为新的正确性 P0 猎杀。
- [ ] Given 用户确认本 PRD，When 流程结束，Then `dynamic` 标记 `prd_confirmed: yes`，并进入只读 CR → 报告型 SPEC 阶段。

## 风险与待确认项

- post-1.4.02 未发版增量与已发 1.4.x 混审，报告中须标注「已发 / 未发」以免误判发布风险。
- 父级 PRD 与 annotate 后协议叙述可能冲突；验收以本 PRD「SSOT 优先级」为准。
- CI 无 test/lint：自动化缺口记工程建议，不单独阻断本轮报告完成。
