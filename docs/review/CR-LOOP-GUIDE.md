# 全局 Code Review Loop 指导

> 对整个 `novel-master` 仓库做一次**多角度、多模块、交叉式**的大 CR。
> 不改任何实现代码，只产出 review 文档，落到 `docs/review/`。
> 本文件是 loop 的**自包含剧本**——上下文被压缩后，读完这一份 + 状态文件就能接着干，不用回头猜之前做到哪了。

参考 `code-review-loop` skill 的编排思想（主代理编排、子代理 readonly review、动态 DAG、多轮收敛），但本 loop 的终点不是「fix-spec-ready」，而是「**CR 完成度 ready**」：三轴矩阵全部覆盖、角度间冲突已识别、债务登记表已收敛。

---

## 为什么是「多角度交叉」而不是「一次横扫」

这个仓库已经积累了 1700+ 次提交、120+ 个迭代目录，`packages/core/src` 就有 500+ 文件。一次全量横扫的典型失败模式是：每个角度单独扫一遍都觉得「还行」，但把多个角度的结论叠起来，才会暴露真正的架构债。这类问题长在**角度的接缝处**——功能没错、数据模型也合理，可两个叠起来在并发下就脏数据。所以本 loop 的核心不是「跑很多遍」，而是**让不同角度的结论互相打架，打架的地方就是债**。

因此编排成三个正交的轴：

- **轴 A 角度（lens）**：横扫所有模块的一种视角，每角度独立产出一份报告
- **轴 B 模块（slice）**：一个 bounded context 的完整切片，被多个角度看过后产出一份综合 review
- **轴 C 阶段（phase）**：侦察 → 横扫 → 切片 → 交叉 → 综合，控制 loop 推进

每个模块都会被**多个独立视角**看过，而不是被一个视角一路扫过——后者正是「局部最优害全局」的温床。

---

## 核心约束（硬规矩）

| 约束 | 说明 |
|------|------|
| **不改实现代码** | 整个 loop 期间不动 `packages/`、`apps/` 下的任何源码 |
| **只产出文档** | 所有结论写进 `docs/review/` 下的 `.md` |
| **子代理 readonly** | review 类子代理必须 readonly；主代理不得自审 |
| **主代理做交叉** | 角度间冲突识别、综合报告必须主代理亲自做（子代理上下文不够） |
| **不跑门禁** | 不在本 loop 内跑 build/test/lint；这是 review，不是验收 |
| **docs/ 是设计意图真源** | 代码与 `docs/`（尤其 `Iterations/*/`）不一致，就是技术债的精确位置 |

---

## 产出路径与命名

全部落在 `docs/review/`（目录已创建）：

```text
docs/review/
├── CR-LOOP-GUIDE.md            # 本文件（剧本）
├── .cr-loop-state.yaml         # 状态文件（压缩恢复用）
├── guides/                     # 指导文档（每个子代理一份）
│   ├── phase0-recon.md
│   ├── lens-L1-data-model.md ~ lens-L8-api-security.md
│   ├── lens-L9-dead-code.md
│   ├── lens-L10-build-infra.md
│   ├── lens-L11-doc-drift.md
│   ├── module-slice.md
│   └── phase3-cross.md
├── phase0/                     # ✅ 已产出
│   ├── D0-1-code-map.md        # 代码地图、依赖图、分层違規清零确认
│   └── D0-2-docs-index.md      # 151 Iter 归类、模块摇摆度、切片定稿
├── phase1-lens/                # 角度横扫（轴 A × 全模块）
│   ├── D1-01-data-model.md
│   ├── D1-02-algorithm.md
│   ├── D1-03-architecture.md
│   ├── D1-04-error-txn.md
│   ├── D1-05-concurrency.md
│   ├── D1-06-cross-platform.md
│   ├── D1-07-testing.md
│   ├── D1-08-api-security.md
│   ├── D1-09-dead-code.md
│   ├── D1-10-build-infra.md
│   └── D1-11-doc-drift.md
├── phase2-slice/               # 模块切片（6 个已定稿）
│   ├── D2-vfs.md
│   ├── D2-chat-message.md
│   ├── D2-provider-llm.md
│   ├── D2-agent-tool.md
│   ├── D2-compaction.md
│   └── D2-prompt.md
├── phase2.5-pattern/           # 跨模块模式识别（11 个角度各一份）
│   ├── D2a-L1-data-model.md
│   ├── D2a-L2-algorithm.md
│   ├── ...
│   └── D2a-L11-doc-drift.md
├── phase3-cross/               # 交叉（核心）
│   ├── D3-1-conflict-matrix.md
│   └── D3-2-debt-register.md
├── phase4-synthesis/
│   └── D4-1-executive-summary.md
└── phase5-fix-spec/
    ├── D5-1-fix-spec.md        # 可执行修复说明书（按 code-review-loop skill 结构）
    └── D5-2-closure.md         # Fix-Spec Closure 表
```

**命名规则**：`D<阶段>-<序号>-<slug>.md`。阶段间禁止跨目录引用未产出文档；状态文件里的 `matrix.coverage` 才是真实进度。

---

## 角度清单（轴 A）—— 11 个

每个角度只负责它独有的一块，**刻意让视角互不重叠**，叠起来才有冲突可挖。功能正确性（代码 vs `docs/` spec）不单列成角度，而是**每个模块切片的必查项**——因为它必须读对应迭代文档，横扫反而会漏。

| id | 角度 | 只看什么 | 独有抓手 |
|----|------|----------|----------|
| L1 | 数据模型 & 持久化 | schema、migration、repo、归一化 | 一实体多张表、schema 与 domain 漂移、缺索引、N+1 |
| L2 | 算法 & 复杂度（含构建性能） | 时间/空间、边界、热路径、构建管线复杂度 | 藏在「看起来对」里的 O(n²)、漏掉的边界、`--force` 禁用增量、prebuild 链重复构建 |
| L3 | 架构 & 依赖（含 monorepo 依赖图） | 分层、循环、facade 绕过、package.json 依赖摆放 | 违反 `ARCHITECTURE.md` 的真实依赖、私路径 import、core devDep 含下游 driver、driver 误用 dependencies 而非 peer |
| L4 | 错误处理 & 事务 | 原子性、回滚、部分失败 | 多步写中间崩了的脏数据、catch 吞错误 |
| L5 | 并发 & 异步 | 竞态、顺序、abort 语义 | abort 后 partial block 正确性、事件竞态 |
| L6 | 跨端一致性 | cli/desktop/mobile 分歧 | 共享 core 但各自绕路、抽象漏到端侧 |
| L7 | 测试 & 可测性 | 覆盖盲区、脆弱测试 | 核心路径零测试、测试耦合实现细节 |
| L8 | API 稳定性 & 安全（含包导出面 + 发版策略） | `index.ts` 导出、`package.json` exports、版本号、校验、密钥 | 内部路径被外部依赖、exports 暴露 dist/infra、secret 落盘、注入面、0.0.0 vs 1.4.16 版本矛盾 |
| **L9** | **死代码 & 迭代残留** | **knip 报告 + 迭代对照** | **迭代重构后未清理的类型/文件、duplicate exports、废弃常量** |
| **L10** | **工程化基建一致性** | **tsconfig、ESLint、测试运行器、CI、Node engines** | **TS 版本分裂（5.8 vs 6.0）、ESLint 8 vs 9 配置分裂、CI 缺失、Node engines 矛盾** |
| **L11** | **文档与代码漂移** | **docs/ 与实现、examples、monorepo.md 承诺的脚本** | **monorepo.md 列了不存在的 vfs:* 脚本、export 清单错误、examples 与 API 不同步** |

> **注意**：不单列「可读性」「命名」这种软角度。命名、god module、死代码这些不是独立视角，而是每个角度路过时顺手记一笔，汇进综合报告。否则十一个角度里有三个在重复「这个函数太长」，token 全浪费。
>
> **L9 的特殊性**：L9 的主要数据源是 knip 扫描报告（已完成，见 [`phase0/D0-3-knip-scan.md`](phase0/D0-3-knip-scan.md)），不是 grep。knip 已做引用图分析，L9 的价值在于**语义核实**——knip 说的对不对、能不能删、有没有 Iteration 对应。Phase 0 已确认 core 几乎无死代码（2 unused files + ~23 exports），L9 在 core 工作量很小。
>
> **L10/L11 的边界**：L10 只看「基建工具链本身是否一致」（tsconfig 选项、ESLint 版本、测试运行器、CI 配置）；L11 只看「文档承诺与代码现实是否漂移」（monorepo.md 列的脚本存不存在、examples 能不能跑、export 清单对不对）。L10 不看业务代码质量，L11 不看工具链配置——两者刻意分开，避免一个角度既查 ESLint 又查文档把 token 撑爆。

---

## 模块清单（轴 B）—— Phase 0 已定稿

Phase 0 已完成侦察，模块清单已在 [`phase0/D0-2-docs-index.md`](phase0/D0-2-docs-index.md) 定稿。**6 个切片**（合并强耦合 context 后），其余 21 个模块只进横扫。

| 切片 | 包含 context | 摇摆度 | 入选理由 |
|------|-------------|--------|----------|
| **D2-vfs** | domain/vfs, service/vfs, bootstrap/vfs | 17 迭代 | 摇摆冠军，3 张表 + 3 god module + 5512 行 |
| **D2-chat-message** | domain/chat, domain/message-checkpoint, service/chat, service/message-checkpoint | 23 迭代 | 双巨头之一，rollback 反复修补 |
| **D2-provider-llm** | domain/provider, infra/llm-protocol, service/provider | 10 迭代 | 三协议 parity，god module adapter.port |
| **D2-agent-tool** | domain/agent, domain/tool, service/agent | 19 迭代 | config shape 反复改，tool v1→v2 |
| **D2-compaction** | domain/compaction-conditions, service/compaction-conditions | 5 迭代 | 小代码大复杂度（195 行 / 5 迭代） |
| **D2-prompt** | domain/prompt, service/prompt, infra/prompt-template | 4 迭代 | 依赖 chat，LLM input parity |

**横扫-only 模块**（21 个）：events, events-config, regex, workplace, session-kkv, kkv, persistent-preferences, persistent-state, depth, format, character-card, cloud-sync, sksp, tdbc, sql-template, tokenizer, nmtp, db-backup, serialization, feature-flags, session-fs

### Phase 0 关键发现（影响所有角度）

1. **分层纪律优秀**：domain→service、infra→service、apps 绕过 facade **三類違規全清零**。L3 角度不要浪费时间扫違規，聚焦 god module 和灰色地带。
2. **domain context 大多没有 index.ts barrel**：只有顶层 `index.ts`（183 行）+ 少数 infra/service 有 barrel。domain/<ctx>/ 下无 index.ts，外部通过顶层 facade 消费。L8 角度要注意公共面其实很窄。
3. **vfs 是复杂度黑洞**：17 迭代 + 3 表（entry/revision/content-blob）+ 3 god module（vfs-path-mapper 42 次、vfs-entry.port 28 次、sqlite-vfs-entry.repository 24 次）。所有角度都要重点看 vfs。
4. **mobile 极端不对称**：35766 行 vs desktop 7192 vs cli 4010。L6 跨端角度的核心张力。
5. **测试盲区已定位**：regex（3 测试/1014 行）、cloud-sync（2/532）、session-kkv（1/298）、bootstrap（7/2661）严重不足。
6. **唯一跨 context 引用**：prompt → chat（normalize-for-llm-export.ts）。L3 需确认是否该补 documented exception。

模块切片的**必查项**（不论被哪些角度横扫过，切片都得查）：

- 功能正确性：代码 vs 该模块对应 `Iterations/<x>/` 的 spec/prd
- 数据流：从入口到落盘的完整路径画一遍
- 公共面：该模块对外的 `index.ts` 契约 vs 实现（注意：domain context 多无 barrel）

---

## Loop 与收敛

### 为什么是 loop，不是一次性 pipeline

这个 CR 有**三个循环动力源**，叠在一起才配叫 loop：

1. **角度内多轮**：每个角度的横扫不是「扫一遍交差」——第一轮浅扫标出可疑点，第二轮针对可疑点深挖，第三轮（可选）针对高价值模块做逐模块独立结论。
2. **交叉回派（辩论式）**：Phase 3 发现角度间矛盾后，不是「回派一次就定」，而是让冲突双方交换论据——A 给理由、B 给理由、主代理裁决；如果还能深挖，再交换一轮。
3. **fix-spec 收敛**：Phase 5 基于 D3-2 债务登记产出可执行修复说明书，按 `code-review-loop` skill 的 fix-spec-ready 门禁收敛——每条 must-fix 须有改法 + 文件 + 验收，缺一不可。

### 六个阶段总览

| Phase | 做什么 | 产物 | 循环动力 |
|-------|--------|------|----------|
| **1** | 角度横扫 × 模块矩阵 | 每角度一份 D1-xx，内含「角度 × 模块」矩阵小节 | 角度内多轮 |
| **2** | 模块切片深挖 | 6 份 D2-xx，每份含必查项 + lens 交叉 | — |
| **2.5** | 跨模块模式识别 | 11 份 D2a-Lxx，每角度跨模块对比自己的发现 | 角度内可补 |
| **3** | 冲突矩阵 + 辩论式回派 | D3-1 矛盾清单、D3-2 债务登记 | 辩论式回派 |
| **4** | 综合 + 路线图 | D4-1 执行摘要 | — |
| **5** | fix-spec 收敛 | D5-1 修复说明书、D5-2 Closure 表 | fix-spec-ready 门禁 |

### 终态：CR 完成度 ready

须同时满足：

1. **矩阵覆盖**：`matrix.coverage` 里每个 `角度 × 模块` 格子都有结论（done 或 N/A 并注明理由）
2. **角度横扫全部 done**：L1–L11 各产出一份 `D1-xx`，且每份内含「角度 × 模块」矩阵小节
3. **模块切片 Top N 全部 done**：每份 `D2-<module>` 含必查项 + 被横扫命中点的交叉结论
4. **跨模块模式识别完成**：11 份 `D2a-Lxx` 各自识别出至少 1 个跨模块重复模式或系统性反模式（或注明「该角度无跨模块模式」）
5. **冲突已识别**：`D3-1` 列出所有角度间矛盾，每条标「真冲突 / 伪冲突 / 待补查」
6. **债务已登记**：`D3-2` 把所有发现按 `角度 × 模块` 打分排序
7. **综合已产出**：`D4-1` 给出风险优先级 + 整改路线建议
8. **fix-spec-ready**（Phase 5 终点）：每条 must-fix 有改法 + 文件 + 验收/测试要点；无「只批评无改法」条目；Fix-Spec Closure 表已附

**不等于**「代码已修好」或「可合并」——本 loop 产出诊断文档 + 修复说明书，**不执行修复**（Phase 5 只写 spec，不改代码）。

### 收敛判定与轮次上限

| 环节 | 默认轮次 | 超限处理 |
|------|----------|----------|
| 单角度横扫（Phase 1） | **3 轮**（浅扫 → 深挖 → 逐模块细化） | 第三轮仍发现新问题 → 标 `blocked-需主代理判断` |
| 模块切片（Phase 2） | **2 轮** | 第二轮仍发现新问题 → `blocked` |
| 跨模块模式识别（Phase 2.5） | **1 轮**（基于 Phase 1+2 结论） | 发现的新线索回派 Phase 1 对应角度 |
| 交叉回派（Phase 3） | **2 轮辩论**（A→B→裁决，必要时再一轮） | 第三轮仍无收敛 → 主代理强制裁决 |
| fix-spec 收敛（Phase 5） | **5 轮**（按 code-review-loop skill 默认） | 仍 not-ready → 汇报未闭合项，请用户拍板 |

每个 `角度 × 模块` 格子**最多被碰 5 次**（横扫×3 + 切片 + 回派），超过转 `blocked`。同一 must-fix 在 Phase 5 震荡 ≥3 次 → `blocked`。

---

## DAG 编排与状态机

### 状态文件：`.cr-loop-state.yaml`

执行第一步就创建，**每次 wave 完成后必更新**。这是压缩后恢复的唯一依据，格式仿 `.iteration-state.yaml`：

```yaml
# 全局 CR Loop 编排状态
# 本文件记录矩阵覆盖、wave、node_status；上下文压缩后读这份接着干。

base_sha: <开跑时的 sha>
mode: global-cr
current_phase: phase0 | phase1 | phase2 | phase3 | phase4
dag_version: 1

# 角度 × 模块 覆盖矩阵（phase1 填充）
matrix:
  187    lenses: [L1..L11]  # 见 .cr-loop-state.yaml 实际清单
  modules: [<Phase 0 定稿的 Top N + 横扫-only 清单>]
  coverage:
    # key: "<lens>/<module>", value: done | na(理由) | pending | blocked
    L1/compaction: done
    L1/vfs: pending
    # ...

node_status:
  D0-1: { status: done }
  D0-2: { status: done }
  D1-L1: { status: done, doc: phase1-lens/D1-01-data-model.md }
  D2-compaction: { status: pending }
  D3-1: { status: pending }
  # ...

open_questions: []      # 未认定、待用户拍板的发现（不阻塞 ready，但记录在案）
blocked: []             # 震荡或调查未完成的格子
wave_plan:
  - phase1: [D1-L1, ..., D1-L11]         # 11 角度并行横扫
  - phase2: [D2-vfs, ..., D2-prompt]      # 6 切片并行
  - phase2.5: [D2a-L1, ..., D2a-L11]      # 11 角度跨模块模式识别
  - phase3: [D3-1, D3-2]                  # 主代理亲自（含回派）
  - phase4: [D4-1]                        # 主代理亲自
  - phase5: [D5-1]                        # spec-fix 子代理，分 wave
status: 待 Phase 0 侦察
```

**恢复纪律**：上下文压缩后，主代理第一件事是读 `.cr-loop-state.yaml` + `CR-LOOP-GUIDE.md`，根据 `current_phase` 和 `wave_plan` 决定下一个 wave，**不要从头重跑已 done 的节点**。

### 波次执行规则

| Phase | 派遣方式 | 并行度 | 备注 |
|-------|----------|--------|------|
| **phase0** | 主代理自己做 | — | 侦察不派子代理；产出 D0-1、D0-2 并定稿模块清单 |
| **phase1** | 并行派 readonly 子代理 | 11 个角度同时 | 每角度一个子代理，读全代码 + 相关 `docs/`，各写各的 `D1-xx`；每份内含「角度 × 模块」矩阵小节 |
| **phase2** | 并行派 readonly 子代理 | 6 个模块同时 | 每模块一个子代理，综合该模块所有角度的结论 + 必查项 |
| **phase2.5** | 并行派 readonly 子代理 | 11 个角度同时 | 每角度一个子代理，跨模块对比自己的发现，识别系统性反模式 |
| **phase3** | **主代理亲自做**（回派派子代理） | — | 读全部 D1+D2+D2a，找冲突、辩论式回派、打分 |
| **phase4** | **主代理亲自做** | — | 综合 + 路线图 |
| **phase5** | 派 spec-fix 子代理（**只写文档不改代码**） | 按严重度分 wave | 基于 D3-2 债务登记产出可执行 fix-spec，按 code-review-loop skill 收敛到 fix-spec-ready |

**phase1 / phase2 可部分重叠**：不必等 11 个角度全 done 才开 phase2——某个角度 done 了，对应模块切片就能排队进场。状态文件用 `matrix.coverage` 追踪，不靠波次顺序。

**phase2.5 依赖 phase1+phase2**：跨模块模式识别需要角度横扫和模块切片都产出后才有意义，不可提前。

**phase5 依赖 phase3+phase4**：fix-spec 基于 D3-2 债务登记 + D4-1 路线图，必须等综合完成。

### 动态 DAG 调整

not-ready 后改图，`dag_version++`：

| 动作 | 示例 |
|------|------|
| 回派补查 | phase3 发现 L4 和 L5 在 compaction 上矛盾 → 派 L4/L5 各补一轮 compaction 专项 |
| 辩论式回派 | phase3 发现 L2（算法）和 L5（并发）矛盾 → 第一轮 L2 给论据、L5 给论据 → 主代理裁决 → 如需深挖再交换一轮 |
| 拆分子节点 | 某模块太大 → 拆成 `D2-vfs-core` + `D2-vfs-revision` |
| 合并节点 | 两个小模块发现高度耦合 → 合并成一份切片 |
| 升级优先级 | 某格子被多个角度点名 → 提前进 phase2 |
| fix-spec 拆 wave | phase5 债务多 → 先写 P0 spec-fix wave，再写 P1，再写 P2 |

---

## 子代理派遣规范

| 节点类型 | 工具 | readonly | 谁来派 | 说明 |
|----------|------|----------|--------|------|
| lens-sweep（D1-xx） | Task 子代理 | **true** | 主代理 | 一个角度扫全模块 |
| module-slice（D2-xx） | Task 子代理 | **true** | 主代理 | 一个模块被全角度切 |
| cross-module-pattern（D2a-Lxx） | Task 子代理 | **true** | 主代理 | 一个角度跨模块对比自己的发现 |
| 交叉回派（phase3 回派） | Task 子代理 | **true** | 主代理派遣 | 针对具体矛盾点补查 |
| spec-fix（D5-xx） | Task 子代理 | **false** | 主代理 | **只改 fix-spec 文档**，不改实现代码 |
| 交叉、综合（D3/D4） | 不派 | — | 主代理亲自 | 上下文要求高，子代理做不了 |

**并行规则**：
- 同 wave 内只读子代理无冲突，可全并行
- **同步等待**当前 wave 全部返回后再汇总、更新状态文件
- 失败：重试一次 → 仍失败由主代理手工补该节点，标注「手工 review」

**主代理禁止**：
- 自审（review 必须派 readonly 子代理）
- 在本 loop 内改任何实现代码
- 跳过状态文件更新就开下一 wave
- 宣布 ready 却没产出 D3/D4
- 在 Phase 5 改实现代码（spec-fix 子代理**只改 fix-spec 文档**）

---

## 指导文档索引

每个子代理（包括主代理自己做 Phase 0 / Phase 3）都有**专属指导文档**，放在 `docs/review/guides/`。派遣子代理时，prompt 里只需写「读 `guides/<对应文件>`，按它的指示干」，不用每次重写完整 prompt——指导文档里已经写死了该读什么文件、用什么 grep、找什么问题、输出什么格式。

| 阶段 / 角色 | 指导文档 | 谁来读 |
|------------|----------|--------|
| Phase 0 侦察 | [`guides/phase0-recon.md`](guides/phase0-recon.md) | 主代理自己做 |
| L1 数据模型 & 持久化 | [`guides/lens-L1-data-model.md`](guides/lens-L1-data-model.md) | lens-sweep 子代理 |
| L2 算法 & 复杂度（含构建性能） | [`guides/lens-L2-algorithm.md`](guides/lens-L2-algorithm.md) | lens-sweep 子代理 |
| L3 架构 & 依赖（含 monorepo 依赖图） | [`guides/lens-L3-architecture.md`](guides/lens-L3-architecture.md) | lens-sweep 子代理 |
| L4 错误处理 & 事务 | [`guides/lens-L4-error-txn.md`](guides/lens-L4-error-txn.md) | lens-sweep 子代理 |
| L5 并发 & 异步 | [`guides/lens-L5-concurrency.md`](guides/lens-L5-concurrency.md) | lens-sweep 子代理 |
| L6 跨端一致性 | [`guides/lens-L6-cross-platform.md`](guides/lens-L6-cross-platform.md) | lens-sweep 子代理 |
| L7 测试 & 可测性 | [`guides/lens-L7-testing.md`](guides/lens-L7-testing.md) | lens-sweep 子代理 |
| L8 API 稳定性 & 安全（含包导出面 + 发版策略） | [`guides/lens-L8-api-security.md`](guides/lens-L8-api-security.md) | lens-sweep 子代理 |
| **L9 死代码 & 迭代残留** | [`guides/lens-L9-dead-code.md`](guides/lens-L9-dead-code.md) | lens-sweep 子代理 |
| **L10 工程化基建一致性** | [`guides/lens-L10-build-infra.md`](guides/lens-L10-build-infra.md) | lens-sweep 子代理 |
| **L11 文档与代码漂移** | [`guides/lens-L11-doc-drift.md`](guides/lens-L11-doc-drift.md) | lens-sweep 子代理 |
| 模块切片（通用） | [`guides/module-slice.md`](guides/module-slice.md) | module-slice 子代理 |
| **Phase 2.5 跨模块模式识别** | [`guides/phase2.5-cross-module.md`](guides/phase2.5-cross-module.md) | cross-module-pattern 子代理 |
| Phase 3 交叉 & 综合 | [`guides/phase3-cross.md`](guides/phase3-cross.md) | 主代理自己做 |
| **Phase 5 fix-spec 收敛** | [`guides/phase5-fix-spec.md`](guides/phase5-fix-spec.md) | spec-fix 子代理 |

每份 lens 指导文档都包含：角度职责边界、独有抓手、该读的文件目录 + 具体 grep 模式、相关 Iterations 清单（分高/中优先）、典型问题清单（带检查手法）、与其他角度的潜在冲突、输出格式、严重度参考。子代理读完它的指导文档就知道「干什么、怎么干、输出什么」，不用主代理在 prompt 里复述。

### 派遣模板（lens-sweep）

```text
【语言要求】全程中文

readonly 评审。任务：全局 CR / 角度横扫。
仓库：<REPO_PATH>
角度：<Lx 名称>

第一步：读你的指导文档 docs/review/guides/lens-L<x>-<slug>.md，
        按它的指示执行（读什么文件、用什么 grep、找什么问题、输出什么格式，全在里面）。
第二步：参考 docs/review/phase0/D0-1-code-map.md 和 D0-2-docs-index.md 了解全局上下文。
第三步：按指导文档的输出格式产出报告，写到 docs/review/phase1-lens/D1-<xx>-<slug>.md。

禁止：改任何代码；宣布 ready；输出与该角度无关的发现。
```

### 派遣模板（module-slice）

```text
【语言要求】全程中文

readonly 评审。任务：全局 CR / 模块切片。
仓库：<REPO_PATH>
模块：<bounded context 名称>

第一步：读你的指导文档 docs/review/guides/module-slice.md，
        按它的指示执行（必查项、交叉发现方法、输出格式全在里面）。
第二步：读 docs/review/phase0/D0-1-code-map.md 获取该模块的文件清单。
第三步：读该模块相关的所有 D1-xx 报告，提取该模块的 lens_findings。
第四步：读 docs/Iterations/<该模块相关迭代>/ 下的 prd.md / spec.md。
第五步：按指导文档的输出格式产出报告，写到 docs/review/phase2-slice/D2-<module>.md。

Context Bundle：
module: <名称>
module_files: <文件清单>
related_iterations: <迭代目录清单>
lens_findings:
  L1: <一句话或「未命中」>
  L2: ...
  ...

禁止：改代码；重复单角度已发现的点；宣布 ready。
```

### 回派模板（phase3 发现冲突后补查）

```text
【语言要求】全程中文

readonly 评审。任务：全局 CR / 交叉回派补查。
仓库：<REPO_PATH>
回派原因：docs/review/phase3-cross/D3-1-conflict-matrix.md 第 <N> 条冲突。
角度：<Lx> 在模块 <module> 上的补充查证。

背景：你的上一轮结论是 <X>，另一个角度 <Ly> 的结论是 <Y>，两条结论矛盾。
请针对这个矛盾点重新查证，只读相关代码 + spec，输出：
1) 你的原始结论是否需要修正
2) 矛盾的根本原因是什么（设计问题 / 某一方漏看 / spec 歧义）
3) 更新后的结论
```

### 派遣模板（cross-module-pattern / Phase 2.5）

```text
【语言要求】全程中文

readonly 评审。任务：全局 CR / 跨模块模式识别。
仓库：<REPO_PATH>
角度：<Lx 名称>

第一步：读你的指导文档 docs/review/guides/phase2.5-cross-module.md，
        按它的指示执行（怎么对比、找什么模式、输出什么格式全在里面）。
第二步：读你自己角度的横扫报告 docs/review/phase1-lens/D1-<xx>-<slug>.md。
第三步：读全部 6 份模块切片 docs/review/phase2-slice/D2-*.md，提取你角度相关的命中点。
第四步：跨模块对比你的发现，识别系统性反模式或重复模式，
        写到 docs/review/phase2.5-pattern/D2a-L<xx>-<slug>.md。

禁止：改代码；重复单模块已发现的点（那些已在 D2 里）；宣布 ready。
```

### 派遣模板（spec-fix / Phase 5）

```text
【语言要求】全程中文

节点：spec-fix-<id>。只改文档，不改实现代码。
仓库：<REPO_PATH>
fix-spec 路径：docs/review/phase5-fix-spec/D5-1-fix-spec.md（不存在则创建）
债务登记：docs/review/phase3-cross/D3-2-debt-register.md（只读参考）
本 wave 范围：<章节/严重度，如「全部 P0」>

第一步：读你的指导文档 docs/review/guides/phase5-fix-spec.md，
        按它的指示执行（fix-spec 结构、收敛逻辑、Closure 格式全在里面）。
第二步：读 D3-2 债务登记，提取本 wave 范围的 must-fix 条目。
第三步：把每条 must-fix 写成可执行步骤（文件、改法、验收/测试），写入 fix-spec。

约束：
- 只编辑 fix-spec（及用户明确允许的文档），**不改任何实现代码**
- 每条含：id、严重度、维度、文件、问题、改法、验收/测试、来源
- P0 必须写入；P1/P2 全部写入除非用户已豁免
- 同步元信息中的 round / sha；状态保持 draft 直至主代理宣布 ready

请用中文返回：
1）修改的文件与章节
2）各 must-fix：已写入 / 仍开放 / 需拍板
3）阻塞项（如有）
```

---

## 文档结构规范

每份 review 文档遵守以下骨架（可增不可减）：

```markdown
# <D 编号>：<标题>

## 元信息
- 角度/模块：<...>
- 范围：<文件或模块>
- 参考文档：<docs/Iterations/...>
- 轮次：<第几轮 / 是否回派>
- 产出日期：

## 结论（叙述式，2-4 段）
<不要一上来就列表；先把核心判断讲清楚>

## 发现清单
### <严重度> <标题>
- 位置：<文件:行 或 模块>
- 问题：<叙述>
- 依据：<对照 spec / 别的角度结论 / 代码>
- 建议：<不改代码，只描述「应该往什么方向整改」>
- 涉及角度：<L1/L4/...>

## 覆盖声明
<查了什么、没查什么、为什么>

## 待交叉的线索
<给 phase3 的提示：你觉得这条会跟别的角度打架吗>
```

`D3-1`、`D3-2`、`D4-1` 有各自的专用结构，在对应 phase 开始时由主代理定。

---

## 执行检查清单

- [ ] phase0：D0-1 代码地图、D0-2 docs 索引 + 模块清单定稿，已创建 `.cr-loop-state.yaml`
- [ ] phase1：11 个角度各产出一份 `D1-xx`（含「角度 × 模块」矩阵小节），状态文件 `matrix.coverage` 已填充
- [ ] phase2：6 个模块切片各产出一份 `D2-xx`，每份含交叉发现（非单角度重复）
- [ ] phase2.5：11 份 `D2a-Lxx` 各产出，每份识别出跨模块模式或注明「无」
- [ ] phase3：D3-1 冲突矩阵、D3-2 债务登记表，真冲突已辩论式回派或已判定伪冲突
- [ ] phase4：D4-1 执行摘要 + 风险优先级整改路线
- [ ] phase5：D5-1 fix-spec 产出，每条 must-fix 有改法+文件+验收；D5-2 Closure 表已附
- [ ] 全程未改实现代码；所有 review 子代理 readonly；spec-fix 子代理只改 fix-spec 文档
- [ ] 每个 wave 完成后状态文件已更新；`dag_version` 正确
- [ ] 上下文压缩后能靠 `.cr-loop-state.yaml` + 本文件恢复，未重跑 done 节点
- [ ] 未在本 loop 内跑 build/test/lint 或宣称代码可合并

---

## 开跑前的两个确认项

执行前需要用户拍板：

1. **模块清单 Top N 取几个？** 默认 6。Phase 0 已定稿 6 个切片
2. **角度要不要裁剪？** 默认全 11 个。若想压文档数，L7（测试）/ L8（安全）可后置，但建议都做——这俩常和别的角度打架
3. **Phase 5 fix-spec 做不做？** 如果只想要诊断报告，Phase 4 可作终点；如果想要可执行修复说明书，Phase 5 继续收敛到 fix-spec-ready。当前设计默认跑到 Phase 5
