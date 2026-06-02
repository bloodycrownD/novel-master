# 事件配置 DAG（dependency）PRD

## 背景

当前事件配置仅支持 `parallel` / `sequential` 两种执行方式。对于「部分动作必须等待另一些动作成功后再执行」的场景不够灵活，且会导致用户为了表达依赖关系而被迫选择全局串行或自行拆分事件。

## 目标（含成功指标）

- **目标**：将事件动作链从“全局并行/串行”改为可表达依赖关系的 **DAG（有向无环图）**。
- **成功指标**：
  - 用户可在单个事件内表达“先跑 Agent，再隐藏消息，再刷新宏”等依赖关系，不需要额外拆分事件。
  - 依赖失败时行为可预测：依赖未成功满足时，下游不会误执行。

## 用户与场景

- **目标用户**：配置事件与压缩链的用户（Mobile / CLI）。
- **典型场景**：
  - `session.compaction.requested`：先 `run-agent` 做工具交互或预处理，再 `hide-message`，最后 `refresh-macros`。

## 范围

### 包含范围

- 新增 `dependency` 字段，以 DAG 方式表达 action 间依赖。
- `dependency` 的语义为：
  - **下游 action 仅在其依赖的上游 action 全部成功完成后才执行**。
  - 若任一依赖 action **失败**：**整个事件执行失败并终止**（不再执行任何后续可执行 action）。
- DAG **允许多个顶点（多个无依赖 action）**：所有无依赖 action 可作为起点并发执行。
- `dependency` 引用方式：
  - **按 action type 引用**（例如 `dependency: ["run-agent"]`）。
  - **同一事件内 action type 必须唯一**（保持现有保存期校验，避免歧义）。
- 输出配置的示例形式（示意）：

```yaml
events:
  session.compaction.requested:
    - run-agent:
        agent-id: xxx-agent
    - hide-message:
        dependency: ["run-agent"]
        start-depth: 6
    - refresh-macros
```

### 不包含范围

- 不在本 PRD 内展开技术方案（解析/调度算法、存储结构、迁移策略、接口设计等）。
- 不引入“按 name/id 引用依赖”的能力（除非未来需求变化）。
- 不支持同一事件内同 type 多次出现（若未来需要，将引入新的唯一标识策略）。

## 核心需求（3-7 条）

1. **DAG 表达**：每个 action 可选声明 `dependency: string[]`，表示依赖的上游 action type。
2. **执行语义**：调度器按依赖关系执行 action；满足依赖后即可并发执行多个 ready action。
3. **失败策略**：任一 action 失败，事件执行立即失败并终止，未开始的 action 不再执行。
4. **保存期校验**：
   - 同一事件内 action type 必须唯一；
   - `dependency` 引用的 action type 必须存在；
   - 禁止形成环（必须为 DAG）；
   - 仍保留 `hide-message` 深度切片参数的合法性校验。
5. **兼容与提示**：旧配置（仅 `parallel`/`sequential`）在用户侧需有明确提示与升级路径（具体方式不在本 PRD 展开）。

## 验收标准

- **配置表达**
  - Given 一个事件内包含多个 action
  - When 为某个 action 设置 `dependency: ["run-agent"]`
  - Then UI/CLI 能正确保存并展示该依赖关系

- **执行顺序与并发**
  - Given `hide-message` 依赖 `run-agent`
  - When 触发该事件
  - Then `run-agent` 完成成功之前不会执行 `hide-message`
  - And 若存在多个无依赖 action，它们可并发执行

- **失败终止**
  - Given `run-agent` 失败
  - When 下游 `hide-message` 依赖 `run-agent`
  - Then 整个事件执行失败并终止
  - And `hide-message` 与任何后续 action 都不会执行

- **保存期校验**
  - Given `dependency` 引用一个不存在的 action type
  - When 保存配置
  - Then 保存失败，并给出可理解的错误提示
  - Given 配置形成依赖环
  - When 保存配置
  - Then 保存失败，并提示存在循环依赖

