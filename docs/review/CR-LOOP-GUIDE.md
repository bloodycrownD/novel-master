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

全部落在 `docs/review/`：

```text
docs/review/
├── CR-LOOP-GUIDE.md            # 本文件（剧本）
├── .cr-loop-state.yaml         # 状态文件（压缩恢复用，执行时创建）
├── phase0/
│   ├── D0-1-code-map.md        # 代码地图、依赖图、分层违规清单
│   └── D0-2-docs-index.md      # docs/ 主题索引、模块×迭代交叉表、模块候选打分
├── phase1-lens/                # 角度横扫（轴 A × 全模块）
│   ├── D1-01-data-model.md
│   ├── D1-02-algorithm.md
│   ├── D1-03-architecture.md
│   ├── D1-04-error-txn.md
│   ├── D1-05-concurrency.md
│   ├── D1-06-cross-platform.md
│   ├── D1-07-testing.md
│   └── D1-08-api-security.md
├── phase2-slice/               # 模块切片（轴 B × 全角度，仅 Top N）
│   └── D2-<module>.md          # 每个候选模块一份
├── phase3-cross/               # 交叉（核心）
│   ├── D3-1-conflict-matrix.md # 角度间结论矛盾清单
│   └── D3-2-debt-register.md   # 债务登记表（角度×模块打分排序）
└── phase4-synthesis/
    └── D4-1-executive-summary.md  # 执行摘要 + 风险优先级整改路线
```

**命名规则**：`D<阶段>-<序号>-<slug>.md`。阶段间禁止跨目录引用未产出文档；状态文件里的 `matrix.coverage` 才是真实进度。

---

## 角度清单（轴 A）

每个角度只负责它独有的一块，**刻意让视角互不重叠**，叠起来才有冲突可挖。功能正确性（代码 vs `docs/` spec）不单列成角度，而是**每个模块切片的必查项**——因为它必须读对应迭代文档，横扫反而会漏。

| id | 角度 | 只看什么 | 独有抓手 |
|----|------|----------|----------|
| L1 | 数据模型 & 持久化 | schema、migration、repo、归一化 | 一实体多张表、schema 与 domain 漂移、缺索引、N+1 |
| L2 | 算法 & 复杂度 | 时间/空间、边界、热路径 | 藏在「看起来对」里的 O(n²)、漏掉的边界 |
| L3 | 架构 & 依赖 | 分层、循环、facade 绕过 | 违反 `ARCHITECTURE.md` 的真实依赖、私路径 import |
| L4 | 错误处理 & 事务 | 原子性、回滚、部分失败 | 多步写中间崩了的脏数据、catch 吞错误 |
| L5 | 并发 & 异步 | 竞态、顺序、abort 语义 | abort 后 partial block 正确性、事件竞态 |
| L6 | 跨端一致性 | cli/desktop/mobile 分歧 | 共享 core 但各自绕路、抽象漏到端侧 |
| L7 | 测试 & 可测性 | 覆盖盲区、脆弱测试 | 核心路径零测试、测试耦合实现细节 |
| L8 | API 稳定性 & 安全 | `index.ts` 导出、破坏性变更、校验、密钥 | 内部路径被外部依赖、secret 落盘、注入面 |

> **注意**：不单列「可读性」「命名」这种软角度。命名、god module、死代码这些不是独立视角，而是每个角度路过时顺手记一笔，汇进综合报告。否则八个角度里有仨在重复「这个函数太长」，token 全浪费。

---

## 模块清单（轴 B）

**Phase 0 跑完才定稿**。下面是候选，按「代码量 + 引用密度 + `Iterations/` 里出现的摇摆次数」打分，**选 Top 6-8 做完整切片**，其余只进横扫不做切片。候选清单和最终选择都写进 `D0-2`。

候选（来自 `ARCHITECTURE.md` 的 bounded context 清单）：

```
compaction / llm-protocol / tokenizer+nmtp / vfs / tool-builtin
message+session / sksp / tdbc+持久化 / prompt-template+render
cloud-sync / serialization / worktree
```

模块切片的**必查项**（不论被哪些角度横扫过，切片都得查）：

- 功能正确性：代码 vs 该模块对应 `Iterations/<x>/` 的 spec/prd
- 数据流：从入口到落盘的完整路径画一遍
- 公共面：该模块对外的 `index.ts` 契约 vs 实现

---

## Loop 与收敛

### 为什么是 loop，不是一次性 pipeline

每个角度/模块的 review 不是「扫一遍交差」，而是可能多轮收敛：第一轮浅扫标出可疑点，第二轮针对可疑点深挖。更关键的是，**交叉阶段（phase3）发现的新线索，会回派给对应角度/模块做补充查证**——这就是 loop 而非 pipeline 的原因：交叉暴露的矛盾，往往是「某个角度漏看了」，需要回到那个角度补一刀。

### 终态：CR 完成度 ready

须同时满足：

1. **矩阵覆盖**：`matrix.coverage` 里每个 `角度 × 模块` 格子都有结论（done 或 N/A 并注明理由）
2. **角度横扫全部 done**：L1–L8 各产出一份 `D1-xx`
3. **模块切片 Top N 全部 done**：每份 `D2-<module>` 含必查项 + 被横扫命中点的交叉结论
4. **冲突已识别**：`D3-1` 列出所有角度间矛盾，每条标「真冲突 / 伪冲突 / 待补查」
5. **债务已登记**：`D3-2` 把所有发现按 `角度 × 模块` 打分排序
6. **综合已产出**：`D4-1` 给出风险优先级 + 整改路线建议

**不等于**「代码已修好」或「可合并」——本 loop 只产出诊断文档，整改另开任务。

### 收敛判定与轮次上限

- 单个角度/模块的 review 子节点：**默认 2 轮**。第二轮仍发现新问题 → 标 `blocked-需主代理判断`，不无限深挖
- 交叉回派的补充查证：**默认 1 轮**，查完即收
- 整个 loop **无硬性轮次上限**，但每个 `角度 × 模块` 格子最多被碰 3 次（横扫 + 切片 + 回派），超过转 `blocked`

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
  lenses: [L1, L2, L3, L4, L5, L6, L7, L8]
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
wave_plan: [[D1-L1, D1-L2, D1-L3, ...], [D2-compaction, D2-vfs, ...], [D3-1, D3-2], [D4-1]]
status: 待 Phase 0 侦察
```

**恢复纪律**：上下文压缩后，主代理第一件事是读 `.cr-loop-state.yaml` + `CR-LOOP-GUIDE.md`，根据 `current_phase` 和 `wave_plan` 决定下一个 wave，**不要从头重跑已 done 的节点**。

### 波次执行规则

| Phase | 派遣方式 | 并行度 | 备注 |
|-------|----------|--------|------|
| **phase0** | 主代理自己做 | — | 侦察不派子代理；产出 D0-1、D0-2 并定稿模块清单 |
| **phase1** | 并行派 readonly 子代理 | 8 个角度同时 | 每角度一个子代理，读全代码 + 相关 `docs/`，各写各的 `D1-xx` |
| **phase2** | 并行派 readonly 子代理 | Top N 个模块同时 | 每模块一个子代理，综合该模块所有角度的结论 + 必查项 |
| **phase3** | **主代理亲自做** | — | 读全部 D1+D2，找冲突、打分；这是最费脑但 token 最省的环节 |
| **phase4** | **主代理亲自做** | — | 综合 + 路线图 |

**phase1 / phase2 可部分重叠**：不必等 8 个角度全 done 才开 phase2——某个角度 done 了，对应模块切片就能排队进场。状态文件用 `matrix.coverage` 追踪，不靠波次顺序。

### 动态 DAG 调整

not-ready 后改图，`dag_version++`：

| 动作 | 示例 |
|------|------|
| 回派补查 | phase3 发现 L4 和 L5 在 compaction 上矛盾 → 派 L4/L5 各补一轮 compaction 专项 |
| 拆分子节点 | 某模块太大 → 拆成 `D2-vfs-core` + `D2-vfs-revision` |
| 合并节点 | 两个小模块发现高度耦合 → 合并成一份切片 |
| 升级优先级 | 某格子被多个角度点名 → 提前进 phase2 |

---

## 子代理派遣规范

| 节点类型 | 工具 | readonly | 谁来派 | 说明 |
|----------|------|----------|--------|------|
| lens-sweep（D1-xx） | Task 子代理 | **true** | 主代理 | 一个角度扫全模块 |
| module-slice（D2-xx） | Task 子代理 | **true** | 主代理 | 一个模块被全角度切 |
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

---

## 指导文档索引

每个子代理（包括主代理自己做 Phase 0 / Phase 3）都有**专属指导文档**，放在 `docs/review/guides/`。派遣子代理时，prompt 里只需写「读 `guides/<对应文件>`，按它的指示干」，不用每次重写完整 prompt——指导文档里已经写死了该读什么文件、用什么 grep、找什么问题、输出什么格式。

| 阶段 / 角色 | 指导文档 | 谁来读 |
|------------|----------|--------|
| Phase 0 侦察 | [`guides/phase0-recon.md`](guides/phase0-recon.md) | 主代理自己做 |
| L1 数据模型 & 持久化 | [`guides/lens-L1-data-model.md`](guides/lens-L1-data-model.md) | lens-sweep 子代理 |
| L2 算法 & 复杂度 | [`guides/lens-L2-algorithm.md`](guides/lens-L2-algorithm.md) | lens-sweep 子代理 |
| L3 架构 & 依赖 | [`guides/lens-L3-architecture.md`](guides/lens-L3-architecture.md) | lens-sweep 子代理 |
| L4 错误处理 & 事务 | [`guides/lens-L4-error-txn.md`](guides/lens-L4-error-txn.md) | lens-sweep 子代理 |
| L5 并发 & 异步 | [`guides/lens-L5-concurrency.md`](guides/lens-L5-concurrency.md) | lens-sweep 子代理 |
| L6 跨端一致性 | [`guides/lens-L6-cross-platform.md`](guides/lens-L6-cross-platform.md) | lens-sweep 子代理 |
| L7 测试 & 可测性 | [`guides/lens-L7-testing.md`](guides/lens-L7-testing.md) | lens-sweep 子代理 |
| L8 API 稳定性 & 安全 | [`guides/lens-L8-api-security.md`](guides/lens-L8-api-security.md) | lens-sweep 子代理 |
| 模块切片（通用） | [`guides/module-slice.md`](guides/module-slice.md) | module-slice 子代理 |
| Phase 3 交叉 & 综合 | [`guides/phase3-cross.md`](guides/phase3-cross.md) | 主代理自己做 |

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
- [ ] phase1：8 个角度各产出一份 `D1-xx`，状态文件 `matrix.coverage` 已填充
- [ ] phase2：Top N 模块各产出一份 `D2-xx`，每份含交叉发现（非单角度重复）
- [ ] phase3：D3-1 冲突矩阵、D3-2 债务登记表，真冲突已回派或已判定伪冲突
- [ ] phase4：D4-1 执行摘要 + 风险优先级整改路线
- [ ] 全程未改实现代码；所有 review 子代理 readonly
- [ ] 每个 wave 完成后状态文件已更新；`dag_version` 正确
- [ ] 上下文压缩后能靠 `.cr-loop-state.yaml` + 本文件恢复，未重跑 done 节点
- [ ] 未在本 loop 内跑 build/test/lint 或宣称代码可合并

---

## 开跑前的两个确认项

执行前需要用户拍板：

1. **模块清单 Top N 取几个？** 默认 6-8。候选已在上面，Phase 0 打分后定稿
2. **角度要不要裁剪？** 默认全 8 个。若想压文档数，L7（测试）/ L8（安全）可后置，但建议都做——这俩常和别的角度打架
