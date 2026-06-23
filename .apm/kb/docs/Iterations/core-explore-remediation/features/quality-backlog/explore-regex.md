# 代码审查：`regex` 域（`packages/core`）

**审查日期：** 2026-06-21  
**范围：** `packages/core/src/domain/regex/**`、`packages/core/src/service/regex/**`、`packages/core/src/bootstrap/regex/**`、`packages/core/test/regex/**`、`packages/core/src/public/regex.ts`  
**重点：** 代码风格、可维护性、正确性  
**已运行测试：** `test/regex/*.test.ts` — 13/13 通过

---

## 执行摘要

regex 域**结构良好且符合项目约定**（类 provider 的 SQL 实体、纯 apply 流水线、薄服务层、专用 public 导出）。持久化、校验、编译与视图时应用之间的分离清晰、易跟踪。

总体质量**良好**。主要缺口是**正确性边界情况**（update schema 深度规范化、无效 identity 优化、非全局 replace 语义）、若干纯函数的**测试覆盖空洞**，以及 create/update Zod 路径间的** minor 风格不一致**。

| 领域 | 评级 | 说明 |
|------|------|------|
| 架构 | 强 | 分层清晰；域逻辑保持纯函数 |
| 代码风格 | 良好 | 与 provider/TDBC 模式一致 |
| 可维护性 | 良好 | 小模块；部分 schema 重复 |
| 正确性 | 良好但有 caveat | 3 个中等问题，若干低风险说明 |
| 测试覆盖 | 中等 | Apply + CRUD happy path；校验/解析有缺口 |

---

## 架构概览

```
bootstrap/regex/regex-schema.ts          DDL (regex_group, regex_rule + index)
        │
        ▼
domain/regex/
  model/           RegexGroup, RegexRule entities + Zod write schemas
  repositories/    Ports + Sqlite*Repository impls
  ports/           ActiveRegexRulesSource (narrow read port)
  logic/
    validate-*     Business validation before persist/compile
    compile-*      RegexRule → CompiledRegexRule (RegExp + metadata)
    apply-*        View-time replacement pipeline (pure)
    resolve-*      Active group → compiled rules (stale pointer → [])
        │
        ▼
service/regex/     RegexConfigService CRUD + listCompiledRulesForGroup
        │
        ▼
public/regex.ts    @novel-master/core/regex subpath export
```

**数据流（运行时）：**

1. 工作区指针 `currentRegexGroupId` 在 KKV（`PersistentState`）中，不在 regex 表内。
2. `resolveActiveCompiledRules(config, activeGroupId)` 校验 group 存在；指针缺失/空时返回 `[]`。
3. `applyRegexRules` / `applyRegexChannelToMessages` 在视图时变换消息文本——存储消息不会被修改。
4. 深度为尾部基准（`0` = 最新可见消息），与 `domain/depth` 共享。

**集成点（范围外，为正确性引用）：**

- `service/prompt/apply-regex-channel-for-llm.ts` — 共享 LLM channel 辅助
- `service/agent/impl/agent-runner.ts` — 在 prompt 组装前应用 LLM regex
- CLI / mobile `applyActiveRegexChannel` — llm vs display channel

---

## 优点

### 1. 清晰的域边界

- **纯 apply 流水线**（`apply-regex-rules.ts`）无 I/O、无服务导入——易单元测试与推理。
- **编译步骤**将 `RegExp` 构造与持久化形态隔离。
- **`ActiveRegexRulesSource`** 为最小 port；`RegexConfigService` 满足它而不将 apply 逻辑与 CRUD 耦合。

### 2. 一致的仓储模式

`SqliteRegexGroupRepository` 与 `SqliteRegexRuleRepository` 镜像 `SqliteSavedModelRepository`：

- TDBC + `SqlTemplateParser`
- 文件顶部 `rowTo*` mapper
- 参数化模板，SQL 边界处 boolean/int 强制

### 3. 校验分层恰当

| 层级 | 职责 |
|------|------|
| Zod schema | Wire 形态、strict 对象、kebab/camel 深度键（create） |
| `validateRegexRule` | 业务规则：replace/scope/depth/RegExp 语法 |
| `compileRegexRule` | 重新校验实体 + 编译（防御损坏 DB 行） |

### 4. Stale 指针处理

`resolveActiveCompiledRules` 捕获 code 为 `NOT_FOUND` 的 `RegexError` 并返回 `[]`——符合 spec（「指向已删 group 的指针 → 无 active rules」）且不向调用方抛错。

### 5. 公共 API 面

`public/regex.ts` 导出域类型、apply 函数、校验、schema、服务工厂与 `applyRegexChannelForLlm`——作为 feature subpath 合适，不泄漏仓储实现。

---

## 代码风格

### 符合项目约定的部分

- 每个文件有 JSDoc `@module` 标签
- `readonly` 实体接口
- 带判别 `code` 的错误类型（`RegexError`）
- 工厂函数 `createRegexConfigService(conn, state?)` 可选横切依赖
- 测试布局：纯测试无 DB fixture；集成测试用 `novelMasterTestFixture`

###  minor 风格问题

| 问题 | 位置 | 严重程度 |
|------|------|----------|
| 未使用 import `testIsolationSuffix` | `regex-config.service.test.ts`、`sqlite-regex-repository.test.ts` | 低 |
| Create vs update 深度解析不对称 | `regex-rule.schema.ts` | 中（正确性） |
| `parseDepthFromInput` 在 create 时抛 plain `Error` | `regex-rule.schema.ts` L33–35 | 低 |
| Spec 仍引用 `minDepth`/`maxDepth`；代码用 `startDepth`/`endDepth` | `.apm/kb/docs/Iterations/regex-system/spec.md` | 低（文档漂移） |

**Create 路径**经 `parseDepthFromInput` + transform 规范化深度。**Update 路径**展开 `depthInputSchema.shape` 但无 transform——kebab-case 键（`start-depth`、`end-depth`）被 Zod 接受但不会映射到解析输出的 `startDepth`/`endDepth`。服务 merge 仅读 camelCase 字段。

---

## 可维护性

### 积极方面

- 文件较短（最大：`regex-config.service.ts` ~237 行，仍可管理）。
- 逻辑函数单一职责、可组合。
- DDL 隔离在 `bootstrap/regex/regex-schema.ts` 并合并进 `novel-master-bootstrap.ts`。
- 深度语义委托共享 `domain/depth/logic/depth-slice.ts`——避免重复区间逻辑。

### 关注点

1. **无 rule 重排 API** —— `sortOrder` 在 create 时经 `nextSortOrder` 分配，之后无法变更。原 spec 列出可选 `reorder`；没有则需 delete/recreate 或直接改 DB。

2. **重复 RegExp 构造** —— `validateRegexRule` 与 `compileRegexRule` 都调用 `new RegExp(...)`。为安全可接受；可在注释说明 compile 在 DB 读取后复检。

3. **Schema 重复** —— `replaceFields`、`scopeFields`、`depthInputSchema` 组合进 create/update schema；update 缺少 create 的 transform 辅助。提取共享 `normalizeDepthInput(raw)` 供两者使用可减少漂移（并修复 kebab-case update bug）。

4. **`listCompiledRulesForGroup` 文档 vs 行为** —— Port 注释写「group 缺失则空」；实现查 rules 而不 `getGroup`。可行（空结果）但与抛 `NOT_FOUND` 的 `listRules` 不同。调用方须知适用哪种语义。

5. **`applyRegexChannelToMessages` identity 优化无效** —— 见正确性 §1。

---

## 正确性

### 问题 1 — `applyRegexChannelToMessages` 中无效的 identity 检查（中）

```119:122:packages/core/src/domain/regex/logic/apply-regex-rules.ts
    if (content === m.content) {
      return m;
    }
    return { ...m, content };
```

`applyRegexToMessageContent` → `mapTextBlocks` **总是**返回新的 `{ blocks }` 对象及文本块的新 block 对象（即使文本未变）。与 `m.content` 的引用相等永远不会成立。每条消息都会被不必要地浅拷贝。

**影响：** 热路径（CLI list、agent prompt、mobile display）额外分配。无功能错误。

**修复：** 在分配前比较变换后的 text/block 引用，或移除该检查。

---

### 问题 2 — Update schema 忽略 kebab-case 深度字段（中）

Create schema：

```59:74:packages/core/src/domain/regex/model/regex-rule.schema.ts
export const createRegexRuleSchema = createRuleBaseSchema.transform((raw) => {
  const depth = parseDepthFromInput(raw as Record<string, unknown>);
  return { ... raw fields ..., startDepth: depth.startDepth, endDepth: depth.endDepth };
});
```

Update schema 有 deprecated `minDepth`/`maxDepth` 的 `superRefine`，但**无等价 transform**。Patch `{ "start-depth": 2 }` 通过 Zod 但 `parsed.startDepth` 仍为 `undefined`；服务保留现有深度。

**影响：** update 上使用 kebab-case 深度的 CLI/API 客户端静默 no-op。

**修复：** create 与 update 共享深度规范化（transform 或 preprocess）。

---

### 问题 3 — `String.replace` 每次应用仅替换首个匹配（中 — 行为）

```45:45:packages/core/src/domain/regex/logic/apply-regex-rules.ts
  return text.replace(rule.pattern, replacement);
```

无 `g` 标志时，每条 rule 每个文本块仅替换**一处**。同块多匹配需在 `flags` 中加 `g`。Spec 描述 rule 链（rules 间 OR、顺序 apply）但未文档化块内单次 vs 全局 replace。

**影响：** 用户模式如不带 `g` 的 `secret` 仅脱敏第一处。可能是预期 JS 语义，但是常见 footgun。

**建议：** 在 CLI help / rule 校验提示中说明，或当 pattern 无 flags 时默认全局 replace（产品决策）。

---

### 问题 4 — `listAllSessionMessages` 缺失时 agent runner 深度回退（低–中）

```416:425:packages/core/src/service/agent/impl/agent-runner.ts
  const visibleSorted = listVisibleForDepth(visible);
  const depthMap = depthByMessageId(visibleSorted);
  return applyRegexChannelToMessages(visible, rules, "llm", depthMap);
```

完整 session 消息不可用时，深度仅从**可见子集**计算，而非完整 session floor。若 `visible` 为截断窗口，深度范围与 CLI 行为（用 `allSessionMessages`）不一致。

**影响：** 无 `listAllSessionMessages` 的 runner 路径上，深度 scoped rules 可能作用于错误消息。若 runner 始终传完整可见列表则 likely OK。

---

### 问题 5 — `createRegexRuleSchema` 深度错误表现为 generic `Error`（低）

`parseDepthFromInput` 抛 `Error`（缺失深度、deprecated 键）。Zod `.transform` 传播非 `ZodError` 抛出——期望统一 Zod 校验错误的调用方可能得到非结构化失败。

---

### 问题 6 — 损坏 DB 行导致整个 compile 列表失败（低）

`listCompiledRulesForGroup` 顺序编译每条 enabled rule；首个无效行抛错并中止。Fail-fast 合理；替代为 skip+log 以增强韧性。

---

### 问题 7 — Role scope 排除非 user/非 assistant role（信息性）

`roleMatchesScope` 对 `system`、`tool` 等返回 `false`。可能有意；若这些 role 携带用户可见文本 worth 文档化。

---

### 已验证正确行为

| 行为 | 证据 |
|------|------|
| 按 `sort_order` 应用 rules | SQL `ORDER BY sort_order ASC, rule_id ASC` + 顺序循环 |
| 编译时跳过 disabled rules | `listCompiledRulesForGroup` 过滤 `enabled` |
| Group 删除 FK CASCADE | 测试 `R-SQL1`；schema `ON DELETE CASCADE` |
| 删除 group 清除工作区指针 | 测试 `R8` 注入 `PersistentState` |
| Stale group 指针 → 无 rules | `resolveActiveCompiledRules` 捕获 `NOT_FOUND` |
| LLM vs display channel 独立 | 测试 + 分离 nullable replace 字段 |
| 深度区间匹配 | 使用共享 `matchDepth`（含端点，开边界 → infinity） |
| 仅视图时（无 DB 变更） | Apply 函数返回新结构 |
| Replacement 捕获组 | 测试 `$1`、`$2` 占位符 |

---

## 测试覆盖

### 已覆盖（13 个测试）

| 文件 | 用例 |
|------|------|
| `apply-regex-rules.test.ts` | Rule 链、深度过滤、role scope、channel 分离、捕获组、仅 text-block 变换 |
| `regex-config.service.test.ts` | Create group/rule、校验拒绝、删除时指针重置、disabled rule 过滤 |
| `sqlite-regex-repository.test.ts` | Sort order、CASCADE delete、`nextSortOrder` |

### 缺口（建议补充）

| 目标 | 建议用例 |
|------|----------|
| `validateRegexRule` | 空 replace 字符串、双 scope false、无效 flags、start > end |
| `compileRegexRule` | 有效实体字段后无效 pattern；`RegexError` codes |
| `resolveActiveCompiledRules` | 空/undefined 指针、stale group id、happy path |
| `applyRegexChannelToMessages` | map 中缺失 depth（skip）、混合变更/未变更消息 |
| `updateRegexRuleSchema` | Update 上 kebab 深度键（可捕获问题 2） |
| 全局 vs 非全局 replace | 同 pattern、多匹配、有/无 `g` |
| `createRegexRuleSchema` | 缺失深度边界、拒绝 deprecated `minDepth` |

纯函数测试（`validate`、`compile`、`resolve`、`apply`）无需 DB fixture，添加较快。

---

## Bootstrap / Schema 审查

```8:36:packages/core/src/bootstrap/regex/regex-schema.ts
export const REGEX_SCHEMA_STATEMENTS: readonly string[] = [
  // regex_group + regex_rule + idx_regex_rule_group_sort
];
```

| 方面 | 评估 |
|------|------|
| PK / FK | `(group_id, rule_id)` 复合 PK；FK 到 group 带 CASCADE |
| Nullable replace 列 | 每侧允许 NULL；服务强制「至少一个」 |
| Nullable depth 列 | 经 `matchDepth` 语义支持开区间 slice |
| Index | `(group_id, sort_order)` 支持有序列表查询 |
| Defaults | `enabled=1`、空 `flags`、scope 默认 0（写入时服务校验 ≥1 scope） |

**说明：** 原 iteration spec 要求 `NOT NULL min_depth/max_depth`。实现迁移为 nullable `start_depth`/`end_depth`，与共享 depth-slice 模块对齐——有意改进，但 iteration spec 已 stale。

---

## 服务层审查

`DefaultRegexConfigService` 遵循标准 CRUD 模式：

- 边界 Zod parse
- `getGroup` / `getRule` 抛 `NOT_FOUND`
- Create 重复 id 抛 `CONFLICT`
- `updateRule` merge patch 后重新校验完整字段集（良好——部分 update 不能破坏不变量）
- `deleteGroup` 校验存在、删除（CASCADE rules）、可选重置指针

**观察：** `setRuleEnabled` 绕过 `validateRegexRule`——安全因仅切换 boolean；DB 中 disabled 且 pattern 无效的 rules 可能存在，编译时跳过。

---

## 公共导出审查

`public/regex.ts` 导出：

- 类型：`RegexGroup`、`RegexRule`、`CompiledRegexRule`、schema input 类型、`RegexChannel`
- 逻辑：apply、validate、compile、resolve
- 服务：`createRegexConfigService`、`RegexConfigService`
- 跨服务：`applyRegexChannelForLlm`

**不**导出仓储或 SQLite 实现——封装正确。主包入口有意不含 regex（在 `package-exports-t0.test.ts` 验证）。

---

## 建议（按优先级）

### P1 — 修复 update 深度规范化

向 `updateRegexRuleSchema` 添加共享深度规范化（transform 或输出 `.transform`），使 kebab-case 键与 create 一致。

### P2 — 修复或移除无效 identity 检查

在 `mapTextBlocks` / `applyRegexChannelToMessages` 中，无 text block 变更时避免分配（例如在 map 中跟踪 `changed` 标志）。

### P3 — 文档化全局 replace 语义

在用户文档 / CLI 中说明 pattern 需 `g` 标志才能在每块多次替换。

### P4 — 扩展单元测试

为 `validateRegexRule`、`compileRegexRule`、`resolveActiveCompiledRules` 与 update-schema 深度解析添加聚焦测试。

### P5 — 清理测试 import

移除未使用的 `testIsolationSuffix` import。

### P6 — 考虑 rule 重排 API

若 UX 需要拖拽排序，向服务 + 仓储添加 `reorderRule(groupId, ruleId, newSortOrder)`。

### P7 — iteration spec 与实现对齐

更新 `.apm/kb/docs/Iterations/regex-system/spec.md` 字段名（`startDepth`/`endDepth`）与 nullable depth 列。

---

## 逐文件说明

| 文件 | 行数 | 评估 |
|------|------|------|
| `logic/apply-regex-rules.ts` | 125 | 纯流水线清晰；identity 检查 bug |
| `logic/compile-regex-rule.ts` | 48 | 最小、正确 |
| `logic/validate-regex-rule.ts` | 72 | 校验清晰；错误映射良好 |
| `logic/resolve-active-regex-rules.ts` | 33 | 小、stale 指针处理正确 |
| `model/regex-group.ts` | 14 | 简单实体 |
| `model/regex-rule.ts` | 25 | 简单实体 |
| `model/regex-rule.schema.ts` | 120 | Create/update 不对称 |
| `ports/active-regex-rules.port.ts` | 14 | 窄 port 良好 |
| `repositories/*.port.ts` | ~17 each | 标准 CRUD port |
| `repositories/impl/sqlite-*.ts` | ~100–165 | 扎实 TDBC 实现 |
| `bootstrap/regex/regex-schema.ts` | 37 | DDL 正确 |
| `service/regex/*` | ~30–237 | 标准服务层 |
| `public/regex.ts` | 30 | 导出合适 |
| `test/regex/*` | 3 files | 良好起点；已注明缺口 |

---

## 结论

regex 域**对其预期用途已可生产**（视图时文本变换、分组有序 rules）。架构与风格强且与 `packages/core` 其余部分一致。主流程未发现阻塞性正确性 bug；上述问题为边界情况、性能微优化与 schema 一致性修复，可提升健壮性与开发者体验。

**建议下一步：** 在小 follow-up PR 中处理问题 P1（update 深度规范化）与 P4（纯函数测试）。
