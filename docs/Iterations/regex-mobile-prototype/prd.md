# 正则配置 — 移动原型 PRD

## 背景

[regex-system](../regex-system/prd.md) 已在 Core + CLI 交付两级正则配置（正则组 → 规则、当前生效组指针、llm/display 双通道、可见 floor 与角色过滤）。该迭代 **不含** `examples/mobile` UI，并在 PRD「后续：移动原型」中预留了配置界面需求。

本迭代在 **`examples/mobile` 静态原型** 中补全 **正则配置** 多级管理界面，使产品/设计可在浏览器内走通 CRUD、切换当前组与规则测试预览；**不接** Core SQLite / RN App，**不要求** 聊天页接入真实替换运行时。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 信息架构对齐 | 「我的 → 正则配置」四级页面栈，交互范式对齐 **服务商管理**（列表 / 详情 / 批量 / 添加） |
| 字段与校验一致 | 单条规则表单覆盖 [regex-system PRD §2](../regex-system/prd.md)；校验与 §5 一致（scope、双替换、非法正则、depth 区间等 **可判定失败**） |
| 当前组指针 mock | mock `workspaceCurrentRegexGroupId` 全应用单例；组列表可展示并切换；删除当前组后 **自动清空** |
| 双通道测试预览 | 规则详情页 **必含** 测试区：样例文本 + floor + role + **llm / display** 预览（语义对齐 `nm regex test`） |
| 持久化可恢复 | 组、规则、指针写入 localStorage；刷新后数据仍在 |
| 文档同步 | `examples/mobile/docs/feature-inventory.md`（及 README 信息架构）与 PRD 一致 |

## 用户与场景

| 用户 | 场景 |
|------|------|
| 产品 / UI 设计 | 评审正则配置入口、组/规则列表密度、详情表单与测试区布局 |
| 开发者（后续接 Core） | 按 mock 字段与页面栈对接 `RegexConfigService` / `currentRegexGroupId` |
| 运营 / 配置者（原型演示） | 维护多组方案、切换当前组、编辑规则并在详情页 **即时预览** 脱敏效果 |

## 范围

### 包含范围

#### 1. 载体与依赖

- **载体**：`examples/mobile`（`index.html` / `app.js` / `styles.css` 等）。
- **领域语义**：正则组、规则字段、floor/role/channel、当前组指针 — **以 [regex-system PRD](../regex-system/prd.md) 为准**（本 PRD 不重复定义 Core 行为）。
- **Mock**：localStorage；前端内联或与 Core 等价的 replace 逻辑用于 **测试预览**。

#### 2. 信息架构

```
我的 (#profilePage)
 └ 正则配置                    ← 一级入口（menu-item，同「服务商管理」）
     └ 正则组列表               ← 二级（对齐 #providersPage）
         ├ 展示/切换「当前生效正则组」（mock 工作区指针，单例）
         ├ 添加 / 批量管理 / 删除正则组
         └ 点击某一正则组 →
             └ 正则列表         ← 三级（对齐 #providerDetailPage）
                 ├ 组名、组内规则条数；添加规则
                 ├ 列表项：名称、启用状态、层数区间等 meta
                 └ 点击某一规则 →
                     └ 正则详情     ← 四级（对齐 Agent 编辑 / 模型采样页）
                         ├ 表单：regex-system §2 全部字段
                         └ 测试区（必做）：样例文本 + floor + role + llm/display 预览
```

#### 3. 单条规则表单字段（引用）

与 [regex-system PRD §2](../regex-system/prd.md) 一致：

| 字段 | 必填 |
|------|------|
| 名称 | 是 |
| 正则表达式 | 是 |
| 启用状态 | 是 |
| 提示词替换 / 显示替换 | 至少其一 |
| 最小层数 a、最大层数 b | 是 |
| 作用范围（用户 / 助手） | 至少选一 |

#### 4. 测试预览区（必做）

- 输入：样例文本、`floor`（默认 1）、`role`（user / assistant）、`channel`（llm / display）。
- 输出：对 **当前编辑中的单条规则** 应用替换后的文本（须 respect floor、role、启用状态；未配置的 channel 侧保持原文）。
- 非法正则：预览或保存时 **可判定失败**（与 CLI 校验体验一致）。

#### 5. 文档

- 更新 `examples/mobile/docs/feature-inventory.md`（新增正则配置用户可见能力）。
- 按需更新 `examples/mobile/README.md` 信息架构说明。

### 不包含范围

| 项 | 说明 |
|----|------|
| `apps/mobile` RN | 不含 |
| 接 Core SQLite / `RegexConfigService` | 不含；纯 mock |
| 聊天页 `#chatPage` 气泡 display 替换 | 不含 |
| 对话 / Agent 真实 llm 通道 | 不含 |
| Core / CLI 变更 | 不含（除非 mock 预览需复用 `@novel-master/core` 纯函数，由 SPEC 定） |
| `--file` 批量导入 | 不含 |

## 核心需求

1. **四级页面栈**：我的 → 正则配置 → 组列表 → 规则列表 → 规则详情。
2. **当前生效正则组**：组列表展示并切换；mock 单例指针；删当前组自动 reset。
3. **组 / 规则 CRUD**：交互对齐服务商管理（含批量删除等既有范式）。
4. **表单 + 校验**：字段与 [regex-system](../regex-system/prd.md) 一致。
5. **双通道测试预览**：详情页必做 llm + display 预览。
6. **localStorage 持久化**：刷新可恢复。

## 验收标准

### 入口与导航

- **Given** 打开「我的」，**When** 查看菜单，**Then** 存在 **正则配置** 入口（与「服务商管理」同级）。
- **Given** 从正则配置进入，**When** 压栈与返回，**Then** 行为与同原型其他管理页一致（含未保存离开确认，若实现编辑脏标记）。

### 正则组列表

- **Given** 组列表页，**When** 查看，**Then** 可见 **当前生效正则组** 标识，且可切换至其他组（切换后 mock 指针仅指向一组）。
- **Given** 组列表，**When** 添加 / 批量删除，**Then** 交互与服务商列表同类操作一致。
- **Given** 当前生效组为 G，**When** 删除 G，**Then** mock 指针清空，列表不再标记当前组。

### 规则列表与详情

- **Given** 进入某组，**When** 查看规则列表，**Then** 展示组名、规则条数；每项含名称、启用状态、层数区间等 meta。
- **Given** 进入规则详情，**When** 查看表单，**Then** 含 regex-system §2 **全部字段**。
- **Given** scope 未选或双替换皆空或非法 pattern 或 `minDepth > maxDepth`，**When** 保存，**Then** 失败并有可感知提示。

### 测试预览

- **Given** 规则仅配 `displayReplace`，样例命中，floor/role 在范围内，**When** channel=display，**Then** 预览为替换后文本；channel=llm **Then** 原文。
- **Given** 规则仅配 `llmReplace`，**When** channel=llm，**Then** 预览为替换后；channel=display **Then** 原文。
- **Given** floor 或 role 不满足规则，**When** 预览，**Then** 不应用该规则（输出原文）。

### 持久化与边界

- **Given** 已配置组、规则与当前组，**When** 刷新页面，**Then** localStorage 恢复一致。
- **Given** 当前生效组含 display 规则，**When** 在聊天页看消息，**Then** **不要求** 气泡展示替换（本期范围外）。

---

**生成路径**：`.apm/kb/docs/Iterations/regex-mobile-prototype/prd.md`

**迭代文件夹名**：`regex-mobile-prototype`

**上游依赖**：[regex-system PRD](../regex-system/prd.md)（Core/CLI 已交付）。确认 PRD 后可编写 SPEC 并进入 `examples/mobile` 实现。
