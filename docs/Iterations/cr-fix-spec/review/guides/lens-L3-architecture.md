# L3：架构 & 依赖

> 角度横扫指导。你是 lens-sweep 子代理，readonly，负责从**架构分层、模块依赖、monorepo 包依赖图健康**这一个角度扫遍整个仓库。

## 你的一句话职责

查清这个仓库的**分层对不对、依赖有没有绕过规则、哪些模块是 god module、有没有循环依赖**，外加 **monorepo 里 package.json 层面的依赖摆放是否健康**。你的圣经是 `packages/core/ARCHITECTURE.md`——一切以它定义的分层规则为准。源码 import 层面你管 domain/infra/service 怎么互相依赖；包描述层面你管根 package.json、各子包 package.json 里 dependencies/devDependencies/peerDependencies 摆得对不对——这两个层面分开看，但都属于「架构健康」。

## 你的独有抓手

- **分层违规**：domain 依赖了 service（禁止）、infra 依赖了 service（禁止）
- **facade 绕过**：外部包不通过 `@novel-master/core` 的公共面，而是走私路径（`core/dist/...` 或 `core/src/...`）
- **god module**：被大量模块依赖的单一文件，是架构瓶颈
- **循环依赖**：domain 内部 context 之间的循环引用
- **跨 context 的私有 import**：A context 直接 import B context 的内部文件，而不是通过 B 的 `index.ts`
- **ARCHITECTURE.md 的「Documented exceptions」是否还成立**：当初加的特例，现在是否还有必要

## Phase 0 已确认的架构现实（重要）

Phase 0 侦察已得出关键结论，**不要重复扫描已确认清零的違規**：

- **domain → service 違規：0 命中** —— 已确认清零，不需重扫
- **infra → service 違規：0 命中** —— 已确认清零
- **apps 绕过 facade（@novel-master/core/src|dist）：0 命中** —— 已确认清零
- **domain context 循环依赖：无** —— 已确认

**唯一实质跨 context 引用**：`domain/prompt/logic/normalize-for-llm-export.ts` → `domain/chat/`（import 了 chat/content 和 chat/model）。ARCHITECTURE.md 未将其列为 documented exception——你要确认是否该补一条说明。

**已知 god module（高引用频次，来自 D0-1）**：

| 文件 | 被引用次数 | 性质 |
|------|----------|------|
| `connection.port`（TDBC） | 80 | 所有 repo 的基础依赖，单点耦合核心 |
| `vfs-path-mapper` | 42 | 单一具体文件被引用 42 次，god module 嫌疑 |
| `vfs-entry.port` | 28 | vfs 持久化入口 |
| `sqlite-vfs-entry.repository` | 24 | vfs repo 实现 |
| `adapter.port`（LLM） | 36 | 三协议 adapter 基础 |

**domain context 大多没有 index.ts barrel**：只有顶层 `packages/core/src/index.ts`（183 行）+ bootstrap/schema-migrations + config-forms + 部分 infra（cloud-sync/db-backup/nmtp/sksp/sql-template/tdbc/tokenizer）+ 部分 service（kkv/session-kkv）有 index.ts。**domain/<ctx>/ 下无 barrel**，外部消费者通过顶层 facade 使用。

因此你的扫描重点应调整为：
1. **god module 职责是否过载**（重点 vfs-path-mapper 42 次、connection.port 80 次）
2. **顶层 index.ts 公共面完整性**（只有 183 行，导出了什么、漏了什么）
3. **documented exceptions 是否仍有效**（逐条核对 ARCHITECTURE.md 的例外清单）
4. **prompt → chat 跨 context 引用**是否该记录为合法例外
5. **domain context 缺少 barrel** 的影响（是否导致内部实现被外部通过顶层 facade 问接暴露）

## 读什么文件

### 核心目标

| 目标 | 看什么 |
|------|--------|
| `packages/core/ARCHITECTURE.md` | **首要必读**——这是你评判一切的依据 |
| `packages/core/src/index.ts` | 顶层 facade（183 行），看导出了什么、漏了什么 |
| `packages/core/src/domain/*/` | 17 个 context 的内部结构 |
| `packages/core/src/service/*/` | 查 service 是否反向依赖 |
| `packages/core/src/infra/*/` | 查 infra 是否依赖 service |
| `apps/*/` | 查外部消费者怎么用 core |
| `packages/sksp-*`、`packages/tdbc-*`、`packages/tokenizer-*` | 查 driver 包怎么消费 core |

### grep 模式

**重要**：以下三類違規 Phase 0 已确认清零，**不需重扫**（列出仅供交叉验证用，发现命中说明代码变化了需报告）：

```text
# 违规一：domain → service（Phase 0 已确认 0 命中）
include: "packages/core/src/domain/**/*.ts"
regex: "from\s+['\"]([^'\"]*\/service\/[^'\"]*)['\"]"

# 违规二：infra → service（Phase 0 已确认 0 命中）
include: "packages/core/src/infra/**/*.ts"
regex: "from\s+['\"]([^'\"]*\/service\/[^'\"]*)['\"]"

# 违规三：绕过 index.ts（Phase 0 已确认 0 命中）
include: "apps/**/*.ts*"
regex: "from\s+['\"]@novel-master/core/(src|dist)/"
```

**重点扫描这些**（Phase 0 发现的灰色地带）：

```text
# god module 职责审查：重点读 vfs-path-mapper 的全部内容
packages/core/src/domain/vfs/logic/vfs-path-mapper.ts

# 顶层 facade 完整性
packages/core/src/index.ts  # 只有 183 行，全读

# domain context 是否有 barrel（实际大多没有）
find_path: "packages/core/src/domain/**/index.ts"  # 预期几乎无命中

# errors/ 目录分布（ARCHITECTURE.md 规定 errors 在包级别）
include: "packages/core/src/errors/**/*.ts"
regex: "export"

# Documented exceptions 涉及的文件
# 逐条核对 ARCHITECTURE.md 列出的例外文件是否还存在、是否还必要
```

## 相关 Iterations

**高优先（必读）：**
- `core-package-structure` — 当前分层结构的源头，ARCHITECTURE.md 就是从这来的
- `core-architecture-style` — 架构风格决策
- `agent-model-decouple` — agent 模型解耦，可能涉及拆分 context
- `agent-system` — agent 系统的架构设计
- `implementation-simplification` — 简化实现，可能删了一些层
- `codebase-audit-remediation` — 代码审计整改
- `post-1.3.14-large-debt-remediation` — 大债清理

**中优先（扫读）：**
- `core-test-fixture-sharing` — 测试 fixture 共享，涉及包结构
- `tool-system-v2` — tool 系统重构
- `worktree-engine-convergence` — worktree 引擎收敛
- `config-forms-merge-into-core` — config forms 合并进 core

## 典型问题清单 & 检查手法

### 1. ~~分层違規扫描~~ → 已清零，改为「灰色地带确认」

Phase 0 已确认三類硬違規全清零。你的重点不是重扫，而是找**灰色地带**：

- **prompt → chat 跨 context 引用**：读 `domain/prompt/logic/normalize-for-llm-export.ts`，判断是否该补入 ARCHITECTURE.md 的 documented exceptions
- **domain context 缺 barrel**：这是有意为之（避免公共面过宽）还是遗漏？是否导致顶层 index.ts 负担过重？
- **顶层 index.ts 导出范围**：183 行导出了哪些 context 的能力？哪些 context 完全没导出？

判定：灰色地带不记違規，记为 open_questions 供 phase3 裁决。

### 2. god module 职责审查（重点）

**vfs-path-mapper（42 次引用）**：读这个文件的全部内容，判断：
- 它承担了多少种职责？（路径解析、规范化、映射、验证？）
- 是否该拆分成多个小函数？
- 被引用 42 次是否合理，还是因为缺少更细粒度的 barrel？

**connection.port（80 次引用）**：TDBC 连接 port。这是 port 被广泛引用的正常现象，还是说明连接抽象泄漏过多？

**adapter.port（36 次引用）**：LLM 协议 adapter。三协议都依赖它——检查它是否变成了「什么都装」的上帝接口。

判定：单一文件承担 >3 种不相关职责且被广泛引用，标 A；职责相关但文件过长（>300 行），标 B。

### 3. Documented exceptions 有效性
**怎么查**：逐条核对 ARCHITECTURE.md 的「Documented exceptions」一节（8 条）。对每条例外：
- 读相关 Iteration，找到当初加这个例外的理由
- 判断那个理由现在是否还成立

**Phase 0 已知的 8 条 exceptions**（来自 ARCHITECTURE.md）：
- sqlite repository impl 与 port 同处一个 context
- compaction action 可 import infra/prompt-template + infra/date-format
- saved-model-settings-from-json 留在 model/
- 3 个 infra-internal errors（sksp-error、sql-template errors、tdbc errors）
- render-prompt.ts 单文件 service
- vfs-service.port 在 domain/vfs/ports 但由 service/vfs 实现

判定：理由已不成立的例外，标 A（应删除）；理由模糊无法判定的，标 B。

### 4. 顶层 facade 完整性
**怎么查**：全读 `packages/core/src/index.ts`（183 行）。对比：
- 导出了哪些能力（SQL template、TDBC、bootstrap、db-backup、cloud-sync、KKV/preferences、tool）
- 哪些 context 完全没导出（chat？vfs？message？agent？prompt？）
- 这些没导出的 context，外部消费者怎么用的？（通过 service factory？还是走了别的路径？）

判定：外部需要但未导出的能力，标 A；导出了内部实现细节，标 B。

### 5. 循环依赖（已确认无）
Phase 0 已确认 domain context 间无循环。不需重扫。

## monorepo 包依赖图健康（扩展维度）

源码 import 之外，L3 还要查 **package.json 层面的依赖图**。monorepo 里每个包的 `dependencies` / `devDependencies` / `peerDependencies` 摆放本身就编码了一套架构意图——上游包该出现在 dependencies、构建期工具该在 devDependencies、可插拔驱动该用 peer。如果摆错了位置，轻则 `npm install` 拉错东西，重则出现「core 反向依赖自己下游」这种架构倒置。这一节专门挖这些。

### Phase 0 已确认的包依赖异常

- **根 package.json 挂了 mobile 专属依赖**：根目录的 `package.json` 里出现了 `react-native-reanimated` 和 `react-native-worklets`——这俩是纯 mobile 的运行时依赖，却挂在根级别。根 package.json 在 monorepo 里应该只放跨包共享的东西，mobile 专属依赖挂到根会导致 desktop/cli 也间接拉到它们（即使作为 monorepo hoist，也污染了依赖图）。
- **core 的 devDependencies 挂了自己的下游 driver 包**：`packages/core/package.json` 的 devDep 里出现了 `@novel-master/tdbc-driver-better-sqlite3`。这是一个 driver 包，core 本身不依赖它运行——core 只定义 port，driver 实现 port。把 driver 放进 core 的 devDep，说明 core 的测试需要拉一个具体 driver 来跑，但这制造了一条「core → driver」的反向依赖边，和「driver → core」的正向边叠在一起就是事实上的循环。
- **tdbc-driver-rn 把 better-sqlite3 放进 devDependencies**：正常情况下 driver 包该 peer 依赖它要桥接的原生库；better-sqlite3 出现在 devDep 说明只是测试期才拉，但 RN 端实际运行时是另一套原生模块。
- **peer/optional 关系失效嫌疑**：多个 driver 包理论上该用 `peerDependencies` 声明对 core 的关系（这样宿主 app 自己选装哪个 driver），但实际很多 driver 把 core 放进了 `dependencies`——这意味着装 driver 会强制再装一份 core，monorepo 里就出现两份 core 副本。

### 包依赖维度怎么查

| 查什么 | 怎么查 | 判定 |
|--------|--------|------|
| **根 package.json 是否只放跨包共享依赖** | 读根 `package.json` 的 dependencies/devDependencies，逐项判断「这个包是不是所有子包都需要的」 | 出现单一端专属依赖（react-native-* 等），标 A |
| **core 的 devDep 是否含自己的下游** | 读 `packages/core/package.json` 的 devDependencies，找 `@novel-master/*` 开头的项 | core devDep 含 driver 包，标 A（架构倒置） |
| **driver → core 是 dependencies 还是 peer** | 逐个读 `packages/tdbc-driver-*/package.json` 和 `packages/sksp-*/package.json`，看 core 在哪个字段 | core 被放进 dependencies 而非 peerDependencies，标 A |
| **循环依赖边** | 把所有 `@novel-master/*` 的依赖关系画成有向图，找环 | 出现环（含通过 devDep 形成的环），标 S |
| **optionalDependencies 滥用** | 找 `optionalDependencies` 字段，判断是不是被用来「绕过 peer 不满足的报错」 | optional 被用来掩盖 peer 失配，标 B |
| **版本范围一致性** | 同一个外部依赖（如 typescript、zod）在不同包里写的版本范围是否冲突 | 范围冲突可能导致双重安装，标 B |

### 包依赖维度的 grep / 文件读取

```text
# 读所有 package.json 的 dependencies/devDependencies/peerDependencies
find_path: "**/package.json"
# 然后逐个检查 @novel-master/* 的摆放位置

# 找根 package.json 里的端专属依赖嫌疑
include: "package.json"  # 仅根
regex: "react-native|expo|@react-native|metro|webview"

# 找 core devDep 里的 @novel-master/* 项
include: "packages/core/package.json"
regex: "@novel-master/"

# 找所有子包对 core 的依赖声明（看是 dependencies 还是 peerDependencies）
include: "packages/*/package.json"
regex: "@novel-master/core"
```

### 与源码 import 维度的关系

包依赖图和源码 import 图是两层，互相印证但不能混为一谈：

- **源码 import 有违规但 package.json 没声明**：说明走私路径 import 但包层面没建立依赖——这是「隐藏耦合」，两边都记一笔（L3 源码维度记违规，L3 包维度记未声明依赖）。
- **package.json 声明了依赖但源码没 import**：说明 package.json 多挂了依赖——可能是历史残留（和 L9 死代码互补），也可能是为未来预留。L3 记为「冗余声明」。
- **package.json 用 peer 但源码 import 了具体实现**：说明 peer 抽象被源码层穿透了——这是「peer 失效」，标 A。

## 与其他角度的潜在冲突

| 对方角度 | 可能的冲突 | 你的立场 |
|----------|-----------|----------|
| **L8 API 稳定性** | 你说「这个不该导出」，L8 可能说「但外部正在用」 | 如果外部确实在用，说明 facade 不完整——你标「facade 需要补充」而不是「违规」 |
| **L6 跨端** | 你说「这个应该走 index.ts」，L6 可能说「但三端需要不同的实现」 | 如果三端分歧是合理的，可能是 facade 设计需要支持多态，不是简单违规 |
| **L1 数据模型** | 你说「这个 context 不该有 repository」，L1 可能说「但它确实需要持久化」 | 持久化需求本身没错，但位置可能不对（该移到 infra 还是留在 domain，看 ARCHITECTURE.md 的例外条款） |
| **L9 死代码** | 你发现 package.json 多挂了依赖，L9 可能发现源码里这个包确实没被 import | L3 记「冗余依赖声明」、L9 记「未使用 import」，两者交叉印证后交给 phase3 裁决是否删除 |
| **L10 工程化基建** | 你发现 TS 版本分裂（5.8 vs 6.0），L10 也会发现 ESLint 版本分裂 | L3 只在「版本分裂导致包依赖冲突」时介入（比如双重安装），否则版本统一性归 L10 |

## 输出格式

遵守 `CR-LOOP-GUIDE.md` 的文档结构规范。文件路径 `docs/review/phase1-lens/D1-03-architecture.md`。

在「结论」节，叙述式讲清楚：这个仓库的分层整体执行得怎么样、ARCHITECTURE.md 的规则有没有被遵守、哪些地方在腐化。

**特别要求**：你的报告里必须包含两张表：
1. **源码依赖关系总览表**：Top 10 被引用最多的文件 + 被哪些 context 引用——这张表会被 phase2 和 phase3 反复引用。
2. **包依赖图异常表**：每个 `@novel-master/*` 包 × （依赖 core 的方式 / core 依赖它的方式 / 是否成环）——这张表揭示 monorepo 的包层面架构健康度。

在「待交叉的线索」节，标出你发现的违规中哪些可能和 L8（API）或 L6（跨端）有冲突，以及包依赖异常中哪些可能和 L9（死代码）或 L10（基建一致性）交叉。

## 严重度参考

| 级别 | 场景 |
|------|------|
| **S** | 循环依赖；god module 被 10+ 文件引用；系统性 facade 绕过；包依赖图成环（含 devDep 形成的环） |
| **A** | domain→service 违规；跨 context 私路径 import；失效的 documented exception；根 package.json 挂端专属依赖；core devDep 含下游 driver；driver 把 core 放 dependencies 而非 peer |
| **B** | 轻度耦合（可接受但值得注意）；index.ts 导出过多（公共面过宽）；optionalDependencies 滥用掩盖 peer 失配；版本范围冲突双重安装风险 |
| **C** | barrel 文件组织混乱；re-export 链过长；package.json 冗余声明但无实质危害 |
