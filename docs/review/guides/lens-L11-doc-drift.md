# L11：文档与代码漂移

> 角度横扫指导。你是 lens-sweep 子代理，readonly，负责从**文档与实际代码的一致性**这一个角度扫遍整个仓库。

## 你的一句话职责

查清仓库里所有**声称描述当前代码的文档**——README、monorepo.md、AGENTS.md、examples/、Iterations/ 的 spec——和实际代码是不是还在一个频道上。文档漂移会反向污染其他 9 个角度的判断（它们都拿文档当锚点），所以你的价值不只是"文档过没过期"，而是**修正其他角度的判定基准**。

## 你的独有抓手

- **文档承诺的脚本不存在**：文档写了 `npm run xxx`，但 package.json 里根本没有这个 script
- **文档列的导出和实际不符**：文档说有 5 个子路径 export，实际有 24 个
- **文档描述的功能状态过期**：文档标"待实现"，实际早就做完了
- **Iterations 的 spec 是否还反映现状**：尤其"移除型"迭代（remove-*、drop-*），移除后 spec 里的旧描述是否还在误导
- **examples 配置与 builtin 默认值不同步**：示例 yaml 里的值和代码里的默认值是否一致
- **截图/UI 展示过期**：assets 里的截图是否还像当前 UI

## Phase 0 已确认的文档漂移

### `docs/monorepo.md`（硬伤）

- 第 20-22 行承诺 `npm run vfs:watch`、`npm run vfs:push`、`npm run vfs:pull`、`npm run vfs:sync`——**根 package.json 里这些 script 全部不存在**
- 第 11 行提到 `scripts/vfs-test-sync` 包——实际不存在
- 第 65 行列出 core 子路径 export 为「`./tdbc`、`./sksp`、`./nmtp`、`./front-matter`、`./kkv`」——实际 `packages/core/package.json` 有 **24 个子路径 export**，且：
  - 文档列的 `./front-matter` **实际不存在**
  - 文档没列的 `./chat`、`./vfs`、`./agent`、`./prompt`、`./compaction`、`./message-checkpoint` 等 **12 个子路径没写进文档**
- 第 66 行写「Repository 实现目标目录：`domain/*/repositories/impl` 中的持久化适配器应逐步迁至 `infra/*/repositories`」——这条迁移到底完成了没有？还是半途状态？

### `examples/README.md`（硬伤）

- 自称「UI 原型，纯 HTML/CSS/JS 实现」，提供功能对比表标"🔄 待实现"——但项目早用 RN + Electron 实现了
- 这份原型文档现在是"陈年幻影"

### 已知需要核实的文档

| 文档 | 核实点 |
|------|--------|
| `docs/monorepo.md` | 脚本是否存在、export 是否准确、迁移状态 |
| `examples/README.md` | 功能对比表是否过期 |
| `examples/agents.yaml` | 配置字段是否还和代码 builtin 一致 |
| `examples/events.yaml` | 同上 |
| `examples/compaction-conditions.yaml` | 同上（compaction schema 反复改，高嫌疑过期） |
| `README.md` | 截图、功能描述、quickstart 命令 |
| `CHANGELOG.md` | 1.4.15 说"CLI 降级"，但 cli 的 bin 还在——是否漂移 |
| `AGENTS.md` | 是否和当前 codebase 结构匹配 |
| `packages/core/ARCHITECTURE.md` | L3 已在查 documented exceptions 有效性，你从文档完整性角度补充 |
| 移除型 Iterations 的 spec | `remove-mobile-vfs-zip-native`、`message-rollback-remove-session-log` 等——spec 是否还误导 |

## 读什么文件

### 核心目标

| 目标 | 看什么 |
|------|--------|
| `docs/monorepo.md` | **重点**——已确认多处硬伤 |
| `examples/` 下所有文件 | README + yaml + 原型代码 |
| `README.md`（根） | quickstart、截图、功能列表 |
| `CHANGELOG.md` | 版本条目 vs 实际代码状态 |
| `AGENTS.md` | 是否和当前结构匹配 |
| `packages/core/ARCHITECTURE.md` | 文档完整性（和 L3 交叉） |
| 所有 `package.json` 的 scripts | 对比文档承诺的脚本是否真实存在 |
| `docs/Iterations/` 下"移除型"迭代的 spec | remove-*、drop-* 迭代的 spec 是否还误导 |

### grep 模式

```text
# 核实文档承诺的脚本是否存在
# 文档说有 vfs:watch / vfs:push / vfs:pull / vfs:sync
include: "package.json"  # 根
regex: "vfs:"

# 对比文档列的 export 和实际
# 文档说 5 个，实际读 packages/core/package.json 的 exports 字段

# 找文档中的"待实现"/"TODO"/"计划中"
include: "**/*.md"
regex: "待实现|TODO|计划中|将要|即将| forthcoming| planned"

# 找 CHANGELOG 里的版本号
include: "CHANGELOG.md"
regex: "^##\s+\["
```

## 典型问题清单 & 检查手法

### 1. 文档承诺的脚本不存在（硬伤）
**怎么查**：读 `docs/monorepo.md` 第 20-22 行列出的脚本名，逐个在根 `package.json` 的 `scripts` 里找。已确认 `vfs:watch`/`vfs:push`/`vfs:pull`/`vfs:sync` 全部不存在。

**判定标准**：文档列出的命令在 package.json 里找不到 → 标 A（新人照着做会报错）。

### 2. 文档列的 export 不完整/错误
**怎么查**：对比 `docs/monorepo.md` 第 65 行列出的 5 个子路径，和 `packages/core/package.json` 的 24 个实际 exports。逐个判断：
- 文档列了但不存在的（`./front-matter`）
- 存在但文档没列的（`./chat`、`./vfs` 等 12 个）

**判定标准**：文档列了不存在的 export → 标 A；存在但文档没列 → 标 B。

### 3. examples 功能对比表过期
**怎么查**：读 `examples/README.md` 的功能对比表。对每个标"🔄 待实现"的功能，确认代码里是否已实现：
- 服务商管理 → provider context 已实现
- 压缩策略 → compaction 已实现
- 正则配置 → regex 已实现

**判定标准**：标"待实现"但代码已实现 → 标 A。

### 4. examples yaml 配置过期
**怎么查**：读 `examples/agents.yaml`、`events.yaml`、`compaction-conditions.yaml`。对比代码里的 zod schema：
- yaml 里的字段名和 schema 里的字段名是否一致？
- yaml 里的值格式和 schema 要求的格式是否一致？
- 有没有字段在 schema 里已经删除但 yaml 里还有？

**重点**：compaction-conditions.yaml——compaction schema 经历了 5 次迭代，yaml 极可能过期。

**判定标准**：yaml 字段和当前 schema 不一致 → 标 A。

### 5. CHANGELOG 与代码状态漂移
**怎么查**：读 CHANGELOG 1.4.15 条目提到的变更，对照代码：
- "CLI 降级为本地测试用途"——但 `apps/cli/package.json` 还有 `bin: { novel-master, nm }`，根 package.json 还有 `link:cli` 脚本。到底降级了没？

**判定标准**：CHANGELOG 声明的状态和代码实际状态矛盾 → 标 A。

### 6. 移除型 Iterations 的 spec 误导
**怎么查**：对以下迭代，读它们的 spec.md，判断 spec 是否还在"指导实现"而不是"记录移除"：
- `remove-mobile-vfs-zip-native`——spec 是否还描述 zip 原生压缩的实现步骤？
- `message-rollback-remove-session-log`——spec 是否还描述 session log 的存在？
- `drop-chat-session-user-vfs-pending-v1`——spec 是否还描述 pending 状态？

**判定标准**：移除型迭代的 spec 仍以"实现"语气描述已移除的功能 → 标 B（会误导后续 CR 拿它当锚点）。

### 7. README 截图过期
**怎么查**：读 `README.md` 引用的截图（`assets/desktop.png`、`assets/mobile.png`）。判断：
- 1.4.15/1.4.16 大改了 UI（会话详情页、聊天记录查询），截图是否还像当前 UI？
- 你看不到图片内容，但可以检查截图文件的修改日期 vs 最近 UI 迭代的日期

**判定标准**：截图修改日期早于最近大 UI 迭代 → 标 B。

## 与其他角度的潜在冲突

| 对方角度 | 可能的冲突 | 你的立场 |
|----------|-----------|----------|
| **所有 L1-L8** | 它们拿 `Iterations/<x>/spec.md` 当真理锚点，你说某些 spec 已过期 | 这是**反向修正**——你的发现会降低其他角度对过期 spec 的信任度。在 D3-1 冲突矩阵里，"基于过期 spec 的判定"需要降权 |
| **L3 架构** | L3 查 ARCHITECTURE.md 的 documented exceptions 有效性，你也查 ARCHITECTURE.md | 互补——L3 看"exception 是否还合理"，你看"文档本身是否完整准确" |
| **L8 API** | L8 查 index.ts 导出，你说文档写的导出和实际不符 | 互补——L8 看代码层面，你看文档层面 |

## 输出格式

遵守 `CR-LOOP-GUIDE.md` 的文档结构规范。文件路径 `docs/review/phase1-lens/D1-11-doc-drift.md`。

**特别要求**：你的报告必须包含一张**文档漂移清单**——每条文档声明 vs 实际代码状态：

| 文档 | 位置 | 文档声明 | 实际状态 | 严重度 |
|------|------|----------|----------|--------|
| monorepo.md | L20 | `npm run vfs:watch` 存在 | 不存在 | A |
| monorepo.md | L65 | export 只有 5 个 | 实际 24 个 | A |
| examples/README.md | 功能表 | "压缩策略 🔄 待实现" | compaction 已实现 | A |
| ... | ... | ... | ... | ... |

**更重要的输出**：一份**"spec 信任度降级清单"**——哪些 Iterations 的 spec 已过期，其他角度引用时需降权：

| Iteration | spec 过期程度 | 影响 | 建议 |
|-----------|-------------|------|------|
| remove-mobile-vfs-zip-native | 高（spec 可能仍描述实现） | L1/L9 引用时需注意 | 降权 |
| ... | ... | ... | ... |

这份降级清单会被 phase3 交叉阶段直接使用——决定哪些基于 spec 的发现需要打折。

## 严重度参考

| 级别 | 场景 |
|------|------|
| **S** | 无（文档漂移本身不是 S，但它对其他角度的污染效应可能在 phase3 升级） |
| **A** | 文档承诺的脚本/功能不存在；export 清单错误；examples 配置与 schema 不一致；CHANGELOG 与代码矛盾 |
| **B** | 移除型迭代 spec 仍以实现语气描述；截图过期；文档没列但存在的 export |
| **C** | 文档措辞小误；链接失效；格式不一致 |
