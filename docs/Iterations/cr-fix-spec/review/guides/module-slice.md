# 模块切片通用指导

> 每个 phase2 的 `D2-<module>` 子代理读这份文档 + 自己模块的专属上下文（由主代理在派遣时提供）。
> 模块清单在 D0-2 定稿，主代理按清单逐个（或并行）派遣。

## Phase 0 已定稿的 6 个切片

你被派遣时，主代理会告诉你你是哪个切片。下面是 6 个切片的实际 context 组合和已知重点（详见 `phase0/D0-2-docs-index.md`）：

| 切片 | 包含 context | 已知重点 |
|------|-------------|---------|
| **D2-vfs** | domain/vfs, service/vfs, bootstrap/vfs | 3 表（entry/revision/content-blob）、3 god module（vfs-path-mapper/vfs-entry.port/sqlite-vfs-entry.repository）、17 迭代、zip 压缩加入又移除、entry-id 重设计、version-redesign |
| **D2-chat-message** | domain/chat, domain/message-checkpoint, service/chat, service/message-checkpoint | 双巨头之一、checkpoint + rollback 事务核心、5 个 rollback-* 迭代全是补丁、message-attachment-unified |
| **D2-provider-llm** | domain/provider, infra/llm-protocol, service/provider | 三协议 parity、adapter.port 36 次引用、token 计数、saved-model 身份、SSE postSse 两版本 |
| **D2-agent-tool** | domain/agent, domain/tool, service/agent | 14+5 迭代、agent-config-shape 反复改、tool v1→v2、agent-prompt-abstract-block、vfs-tool-suite |
| **D2-compaction** | domain/compaction-conditions, service/compaction-conditions | 195+217 行但 5 迭代、触发逻辑从内置→全局→事件总线、event-config-dag |
| **D2-prompt** | domain/prompt, service/prompt, infra/prompt-template | 依赖 chat（唯一跨 context 引用）、prompt-engine、prompt-llm-input-parity、block-lifecycle、agent-prompt-layout 19 次引用 |

**重要**：D2-chat-message 和 D2-provider-llm 是合并切片，体量大。如果发现单一切片无法在一次评审中完成，主代理可能拆分（如 D2-vfs-entry + D2-vfs-revision）。状态文件会记录拆分。

## 你是谁，你干什么

你是一个**模块切片 reviewer**。你的任务是对**一个 bounded context**（或上面表中的组合）做完整的多角度审视，但和角度横扫（L1–L8）不同，你的核心价值是**把多个角度的结论叠在一起，找「单角度看不出来的问题」**。

角度横扫的人是带着一把尺子量所有模块；你是带着八把尺子量一个模块，然后看这八把尺子在哪里打架。

## 你会拿到什么

主代理派遣你时会提供：

```yaml
module: <bounded context 名称，如 compaction-conditions>
module_files: <该模块所有相关文件的路径清单，来自 D0-1>
related_iterations: <该模块相关的 Iterations 目录清单，来自 D0-2>
lens_findings:
  L1: <一句话：数据模型角度在该模块的发现，或「未命中」>
  L2: <算法角度的发现>
  L3: <架构角度的发现>
  L4: <错误处理角度的发现>
  L5: <并发角度的发现>
  L6: <跨端角度的发现>
  L7: <测试角度的发现>
  L8: <API/安全角度的发现>
```

这些 lens_findings 来自 phase1 的 `D1-xx` 报告。你**必须先读对应的 D1-xx**，把该模块相关的发现吃透，再开始自己的切片。

## 你的三个必查项

不论 lens 横扫有没有覆盖，你都必须查这三项：

### 必查一：功能正确性（代码 vs spec）

- 读 `docs/Iterations/<相关迭代>/prd.md` 和 `spec.md`
- 对比当前代码：PRD 说要的功能，实现了吗？spec 里定义的步骤矩阵、测试矩阵，代码对得上吗？
- 重点关注：PRD 写了但代码没做的、代码做了但 PRD 没写的（范围蔓延）、PRD 和代码都做了但语义不一致的

### 必查二：数据流追踪

- 从该模块的**公共入口**（`index.ts` 导出的函数/类）开始
- 追踪到**落盘**（SQL 写入、文件写入）或**外部调用**（LLM API、网络请求）
- 画出完整路径，标出每一步的：输入校验、错误处理、事务边界、并发控制
- 这一步最容易暴露「多步写中间崩了」「资源没释放」「并发下数据不一致」

### 必查三：公共面契约

- 读该模块的 `index.ts`
- 对比实际导出的类型/函数 vs 内部实现
- 查：导出了但内部没用的（死 API）、内部用了但没导出的（被外部走私路径 import 的嫌疑）、导出的类型和运行时行为不符的

## 你的核心产出：交叉发现

这是切片的灵魂。你已经有了 8 个角度的结论（lens_findings），现在要把它们**叠在该模块的具体代码上**，找矛盾。

交叉发现的典型模式：

| 模式 | 举例 |
|------|------|
| **角度盲区** | L1 说「schema 设计合理」，但 L5 说「这里有两步写」，叠起来发现：schema 合理但两步写之间有并发窗口，会脏数据 |
| **角度矛盾** | L3 说「分层正确」，L8 说「这个内部类型被外部引用」——叠起来发现：分层是对的，但 index.ts 漏导出了一个类型，导致外部走了私路径 |
| **隐藏耦合** | L4 单看错误处理没问题，L7 单看测试没问题——叠起来发现：错误路径（rollback/部分失败）完全没有测试覆盖 |
| **历史包袱** | 读 Iterations 发现某功能被推翻重做过 3 次，当前代码里的某个「奇怪设计」就是上一次推翻的残留 |

## 输出格式

遵守 `CR-LOOP-GUIDE.md` 的文档结构规范。核心结构：

```markdown
# D2-<module>：<模块名> 切片

## 元信息
- 模块：<...>
- 文件范围：<文件数 / 总行数>
- 相关 Iterations：<列表>
- lens 命中：<L1✓ L2✓ L3- L4✓ ...>
- 轮次：<第几轮>

## 模块画像（叙述式）
<这个模块是干什么的、数据怎么流、依赖谁、被谁依赖。2-3 段，不要条目式>

## 功能正确性核对
<PRD/spec 说 A，代码做成 B 的地方。逐条列，带依据>

## 交叉发现（核心产出）
### <严重度> <标题>
- 涉及角度：<L1 + L5>
- 位置：<文件:行>
- 矛盾点：<L1 说了什么，L5 说了什么，叠起来发现了什么>
- 依据：<代码 + spec + lens 报告>
- 建议：<不改代码，描述应该往什么方向整改>

## 债务清单
<带 S/A/B/C 严重度 + 涉及角度标注>

## 与其他模块的耦合点
<可能被别的切片也命中的地方，给 phase3 交叉用>

## 覆盖声明
<查了什么、没查什么、为什么>
```

## 严重度参考

| 级别 | 含义 | 切片里的典型场景 |
|------|------|-----------------|
| **S** | 多角度叠加才暴露的架构债 | 数据模型合理 + 并发有窗口 = 会脏数据 |
| **A** | 单角度就能认定但切片确认的问题 | 功能正确性核对发现的 spec 偏离 |
| **B** | 可疑需进一步查证 | 数据流追踪中发现的疑似资源泄漏 |
| **C** | 轻微，记录在案 | 命名不一致、小风格问题 |

## 禁止

- 改任何代码
- 重复 lens 已发现的单角度问题（只在「交叉发现」里引用，不重复展开）
- 宣布 ready（你只给建议，主代理收敛）
- 输出与该模块无关的发现（那些归 lens 报告）
