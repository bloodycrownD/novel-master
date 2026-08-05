# D4-1：CR 执行摘要 & 整改路线

## 一、总体评价

诶～扫了 11 个角度、6 个模块切片、11 份跨模块模式识别，把 1700+ commit 的账翻了一遍，结论是这样的：

**底盘是稳的，纪律在关键路径上是有的。** 分层違規三类全清零（domain→service、infra→service、apps 绕过 facade），SQLite 访问被 AsyncMutex 整体串行化挡掉了一大票经典数据库竞态，事务纪律在「同一连接的多表写」上执行得不错（rollback/truncate/vfs/fork/copy 全包了事务），mock 文化健康（28 文件集中 mock 协议适配器而非内部 repo），SKSP 三端密钥存储实现质量很高（macOS Keychain+AES-GCM、Win DPAPI、Android Keystore，无明文落盘），vfs 路径穿越防护完备（含 zip bomb 上限）。这些是仓库的优点，不能因为后面列了一堆债务就忽略。

**但系统级风险集中在五个地方，每一个都是「局部最优害全局」的典型。** 这五个系统性问题不是单个 bug，是设计层面的缺陷——每次提交都解决了一个局部问题，但没人把所有角度叠在一起看过。按优先级排：跨资源写编排缺失（导致 rollback 系列 5 次打补丁治标不治本）、文档/规范追踪断裂（9 处 PRD 被推翻无记录，含 1 处反向危险）、driver 独立性纸面化（8 个包从未被独立验证）、公共面退出不干净（6 个模块的死代码仍挂在导出）、mobile 是规则洼地（35766 行零静态检查演化）。这五条是整改的真正靶心。

**好消息是，这些问题整改的 ROI 很清晰。** D3-2 债务登记表里 Top 5 的总分都是 8-9 分，远高于其余条目——意味着集中修这 5 条就能消除大部分系统级风险。而 #1（跨资源事务）和 #11（构建增量失效）的整改路径都有明确的「第一步做什么」，不需要大重构就能开始。

## 二、风险优先级（D3-2 Top 10）

| # | 总分 | 标题 | 严重度 | 影响面 |
|---|------|------|--------|--------|
| 1 | 9 | 跨资源多步写无事务 + 无 failure path 回归测试 | S | 系统级（4 模块） |
| 2 | 9 | 文档/PRD/ARCHITECTURE 系统性漂移（含反向危险项） | S | 系统级（6 模块） |
| 3 | 9 | CI 完全缺失——所有 S/A 级发现无法被自动捕捉 | S | 系统级 |
| 4 | 8 | driver 包独立性是纸面上的 | S | 8 包 + 3 app |
| 5 | 8 | @deprecated / 死代码仍挂在公共面（6 模块） | S | 6 模块 |
| 6 | 8 | 异步副作用脱离调用方生命周期 | S | 全局基础设施 |
| 7 | 8 | 热路径无缓存 / 重复计算（4 条 parser 路径） | A→S 候选 | 4 路径 |
| 8 | 7 | 数据层轻约束 + 应用层补丁的「双轨制」 | S | 持久化全局 |
| 9 | 7 | SKSP env 空串语义反向漂移 | A→S 候选 | 三端安全 |
| 10 | 7 | user-vfs-save-mapping 最坏 O(n³) | A | 用户保存大文件 |

## 三、系统性问题（最重要）

这五条是「局部最优害全局」的根因，每条展开讲一下。

### 1. 跨资源写编排抽象缺失

仓库有事务纪律，但只覆盖同一 SQLite 连接内的多表写。一旦跨 secretStore、跨 kkv 域、跨 append+capture+append 链，就没有统一协调器了。四个核心模块（provider、chat-message、agent-runner、bootstrap-vfs）各自长出形态相近的兜底，互不复用，且各自只覆盖了自己的入口。rollback-* 系列 5 次打补丁都是在给上游 agent-runner 的孤儿打兜底，而不是把「每条消息必有 baseline checkpoint」这个不变式上提到源头。叠加这 5 条无事务路径全部没有 failure path 回归测试——修了的不知道修对了没，没修的不知道什么时候炸。

### 2. 文档/规范与实现之间的追踪断裂

Iterations 目录平铺、无 `supersedes:` / `superseded-by:` 元数据——PRD 定稿被推翻后无追踪链。跨 6 个模块 9 处文档漂移，表现形式各异：有的 PRD 定稿方案被推翻且无 supersede 注记（agent-tool 3 处）、有的 spec 描述的能力已被移除（compaction/prompt/vfs）、有的文档承诺的脚本/包根本不存在（monorepo.md）。最危险的是 SKSP env 空串语义的**反向漂移**——当前安全行为靠代码偏离 spec 撑着，按 spec 整改会让空 env 变量覆盖 DB。这不是个别作者疏忽，是迭代管理机制的系统性缺陷。

### 3. driver 独立性从未被验证

从包描述（7 个 driver 全部把 core 放 dependencies 而非 peer）、到基建（8 个子包完全无 lint 无配置）、到运行时装配（mobile 绕过 SKSP registry 直连 `createAndroidSecretStore`）、到测试（mobile 把 compaction evaluator stub 成 undefined）——driver 的「可插拔」是纸面设计，实际是硬编码 + 各自演化。core devDep 还挂了 2 个下游 driver 包，形成 2 条 devDep 环。独立性从未被独立安装或独立测试验证过。

### 4. 公共面退出不干净

六个模块的迭代重构都留下了「新实现已上线、旧符号仍挂在公共面」的残留——compaction 的 estimateTokens 死代码仍导出、chat 的 @deprecated 导出、agent 的 4 对 alias 残留、tokenizer 的 4 个 re-export 残留、chat_grep 工具 @deprecated 但 PRD 仍列必备。core 还在 0.0.0 没有兼容义务，dead alias 必须撤——但叠加 CI 不跑 lint/knip，这些残留永远不会被自动发现。

### 5. mobile 是规则洼地

mobile 35766 行（全仓库最大端）在 TS/ESLint/test runner/engines 四条线全脱离 base 配置。`noUnusedLocals/noUnusedParameters` 因不继承 base 完全失效——这是 L9 在 mobile 死代码误判率更高的结构性原因。desktop 手抄了一份 `sharedTsRules` 没用 `createTsEslintConfig` 导出，base 改规则 desktop 不会跟。`@typescript-eslint` peerDep `<6.1.0` 是延迟引爆地雷——当前 TS 6.0.3 擦边，升到 6.1 就炸。mobile 是各种「漏接」「绕路」「不一致」的结构性土壤。

## 四、建议的整改路线

不改代码，只建议「先修哪个、后修哪个、哪些可以一起修」。分三个波次。

### P0 先修（止血 + 建防护网）

| 序 | 对应债务 | 做什么 | 为什么先 |
|----|---------|--------|---------|
| P0-1 | #3 CI 缺失 | 补 PR/push 的 lint+typecheck+test CI；8 个无 lint 子包纳入 | 没有防护网，后面的修复都无法自动验证 |
| P0-2 | #9 SKSP env 反向漂移 | spec 和代码**同步**改成收紧语义 | 反向危险——先做别的可能有人按 spec 改回 |
| P0-3 | #13 删光会话文件 | baseline checkpoint 不变式上提到 agent-runner 源头 | 数据丢失级别，影响用户 |
| P0-4 | #16 prompt normalize 漏抄 | 补 customAttach 字段 + round-trip 测试 | 静默清空字段，影响 agent 行为 |

### P1 结构性（系统级根因）

| 序 | 对应债务 | 做什么 | 依赖 |
|----|---------|--------|------|
| P1-1 | #1 跨资源无事务 | 建跨资源写编排抽象 + 失败注入 fixture 共享 helper | P0-1（CI 要能跑测试） |
| P1-2 | #2 文档漂移 | 建 `iterations.yaml` 取代链 + 文档清扫迭代 | 无 |
| P1-3 | #4 driver 独立性 | driver → core 改 peer + 解 devDep 环 + mobile 改回 registry | 无 |
| P1-4 | #5 死代码公共面 | 建公共面退出契约 + 一次性清扫 6 模块 | P0-1（lint 要能跑） |
| P1-5 | #6 异步副作用 | sub-agent events 生命周期纳入父 run + microtask 确定性排序 | 无（但如果 agent-subagent PRD 进实现则升 P0） |
| P1-6 | #7 热路径无缓存 | sql-template AST 缓存 + memoize 公共 helper | 无 |

### P2 清理（改善 + 收尾）

| 序 | 对应债务 | 做什么 |
|----|---------|--------|
| P2-1 | #8 双轨制 | 统一完整性修复抽象（合并 repair/rename/backfill） |
| P2-2 | #10 O(n³) diff | 替换为 Myers diff + 性能基线测试 |
| P2-3 | #11 构建增量 | 去 `--force` → 建 references → 验证 tsbuildinfo |
| P2-4 | #12 tokenizer 不一致 | 统一三端计数公式 + parity 套件 |
| P2-5 | #14 tool policy | 加 allowedPaths + BuiltinToolContext path scope |
| P2-6 | #15 mobile 规则洼地 | 统一 TS/ESLint 基线 + mobile 继承 base |
| P2-7 | #17-#28 | 逐条按 D3-2 排序处理 |

## 五、本 loop 的覆盖说明

### 已查

| 阶段 | 产物数 | 覆盖 |
|------|--------|------|
| Phase 0 | 3 份 | 代码地图 + docs 索引 + knip 扫描 |
| Phase 1 | 11 份 | L1-L11 全角度横扫（含 Phase 0 纠偏：compaction 非算法热点） |
| Phase 2 | 6 份 | vfs / chat-message / provider-llm / agent-tool / compaction / prompt |
| Phase 2.5 | 11 份 | L1-L11 全角度跨模块模式识别 |
| Phase 3 | 2 份 | 9 条冲突 + 28 条债务登记 |

### 被切片纠正的横扫结论

- D1-06 B-4「rollbackToMessage 仅 mobile」→ 三端都有（D2-chat-message 证伪）
- D1-07「setMessageFloorAtMessage 完全无测试」→ 有 5+ it 块（D2-chat-message 证伪，收敛为「缺 failure path 回归测试」）
- D1-05 bootstrap repairRefCounts 降级 C → 升 S（D2-vfs 推翻降级前提）
- Phase 0「compaction-conditions 是算法热点」→ 架构热点非算法热点（L2 + D2-compaction 纠正）

### 未深入

- regex 是横扫-only（未进切片），regex 编译产物缓存是否在 RegexConfigService 内部实现仍未核实（D2a-L2 标了待回派）
- apps 端真实死代码分布需等 knip 配置修复后才能定论（D1-09 标注）
- 8 个无 lint 子包的代码质量未实证（D2a-L10 建议安排一次试跑）

### 下一步

Phase 5：基于 D3-2 债务登记产出可执行 fix-spec（`D5-1-fix-spec.md`），按 code-review-loop skill 的 fix-spec-ready 门禁收敛。
