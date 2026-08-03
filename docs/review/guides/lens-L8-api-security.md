# L8：API 稳定性 & 安全

> 角度横扫指导。你是 lens-sweep 子代理，readonly，负责从**公共 API 契约稳定性和安全性**这一个角度扫遍整个仓库。

## 你的一句话职责

查清这个仓库的**公共面（`index.ts` 导出）对不对、稳不稳定、安不安全**。你同时关注两件事：API 稳定性（导出了什么、该不该导出、有没有破坏性变更）和安全性（密钥处理、输入校验、注入面）。这两个看似不相关，但它们的共同点是「都关注**边界**」——公共面是模块边界，安全是信任边界。

## 你的独有抓手

### API 稳定性
- **该导出的没导出**：外部消费者需要的类型/函数没在 `index.ts` 里，导致走私路径（和 L3 互补）
- **不该导出的导出了**：内部实现细节暴露在公共面上，后续重构会变成破坏性变更
- **导出类型与运行时行为不符**：TypeScript 类型说的是一回事，实际跑起来是另一回事
- **版本化缺失**：公共 API 没有版本标记，消费者无法判断是否在兼容范围内

### 安全
- **密钥/API key 落盘**：API key、secret 以明文或可逆方式存到了磁盘/数据库
- **输入未校验**：外部输入（用户配置、LLM 返回、vfs 文件内容）直接使用，没有 zod schema 校验
- **注入面**：SQL 拼接、模板注入、路径穿越（vfs 路径）
- **密钥传输**：API key 在传输过程中是否安全（日志、错误消息里有没有泄漏）
- **权限边界**：tool / vfs 操作有没有越权风险（agent 能否读写不该访问的路径）

## 读什么文件

### 核心目标

| 目录 | 为什么看 |
|------|----------|
| `packages/core/src/index.ts` | 顶层 facade——最重要的公共面 |
| `packages/core/src/public/` | public 目录下的公开类型 |
| `packages/core/src/types/` | 类型定义 |
| `packages/core/src/domain/*/index.ts` | 各 context 的 barrel |
| `packages/core/src/service/*/index.ts` | 各 service 的 barrel |
| `packages/core/src/infra/sksp/` | 密钥存储——安全核心 |
| `packages/core/src/infra/llm-protocol/` | API key 传输——安全核心 |
| `packages/core/src/infra/tdbc/` | SQL 执行——注入面 |
| `packages/core/src/infra/sql-template/` | SQL 模板——注入面 |
| `packages/core/src/domain/vfs/` | 文件系统操作——路径穿越 |
| `packages/core/src/domain/tool/` | tool 系统——权限边界 |
| `packages/core/src/config-forms/` | 配置表单——输入校验 |

### grep 模式

```text
# 所有 index.ts 的导出
find_path: "packages/core/src/**/index.ts"
# 然后逐个读

# 密钥相关（安全）
include: "packages/core/src/**/*.ts"
regex: "apiKey|api_key|apikey|secret|password|token|credential|bearer"

# 密钥落盘嫌疑（写到 DB 或文件）
include: "packages/core/src/**/*.ts"
regex: "(apiKey|api_key|secret|password|token|credential).*\.(insert|save|write|set|put|update)"

# SQL 拼接（注入面）
include: "packages/core/src/**/*.ts"
regex: "(\`.*\$\{.*\}.*\`).*SELECT|(\`.*\$\{.*\}.*\`).*INSERT|(\`.*\$\{.*\}.*\`).*UPDATE|(\`.*\$\{.*\}.*\`).*DELETE"

# 路径穿越（vfs）
include: "packages/core/src/**/*.ts"
regex: "path\.(join|resolve|normalize)\s*\([^)]*\$\{"

# 输入校验（zod）——看哪些入口有/没有校验
include: "packages/core/src/**/*.ts"
regex: "\.parse\s*\(|\.safeParse\s*\(|\.parseAsync\s*\("

# eval / Function 构造（代码注入面）
include: "packages/core/src/**/*.ts"
regex: "eval\s*\(|new\s+Function\s*\("

# 正则注入（ReDoS / regex injection）
include: "packages/core/src/**/*.ts"
regex: "new\s+RegExp\s*\([^)]*\$\{"

# console.log 输出敏感信息
include: "packages/core/src/**/*.ts"
regex: "console\.(log|error|warn|debug).*\n.*(apiKey|secret|password|token)"
```

## 相关 Iterations

**高优先（必读）：**
- `core-package-structure` — 分层结构定义了公共面的边界
- `sksp` — SKSP 密钥存储设计
- `sksp-mac` — macOS 密钥链
- `provider-identity` — provider 身份认证
- `saved-model-identity` — model 身份存储
- `opencode-builtin-provider` — 内置 provider（密钥处理）
- `tool-system-v2` — tool 系统 v2（权限边界设计）
- `vfs-zip-io-agent-tool-policy` — vfs zip IO 的 tool 策略（权限边界）
- `stored-config-validity` — 存储配置校验（输入校验设计）

**中优先（扫读）：**
- `agent-config-shape` — agent 配置结构（可能涉及敏感字段）
- `global-config-system` — 全局配置（可能涉及密钥存储）
- `persistent-state-and-preferences` — 持久化偏好（可能存储敏感信息）
- `provider-model` — provider model 配置
- `chat-workspace-agent-sync` — 工作区同步（可能传输密钥）
- `vfs-tool-error-diagnostics` — vfs 工具错误诊断（可能泄漏路径信息）

## 典型问题清单 & 检查手法

### 1. 密钥存储安全
**怎么查**：读 `infra/sksp/` 的全部实现。追踪 API key 从用户输入到存储到读取的完整路径：
- 存储时是明文还是加密？加密的话密钥从哪来？
- 存到哪了？Keychain（macOS）/ Keystore（Android）/ env / 明文文件？
- 读取时有没有缓存？缓存安全吗？
- 错误消息里会不会泄漏密钥？

**对照 `sksp` 和 `sksp-mac` 的 spec**：设计意图是什么？实现和 spec 是否一致？

**判定标准**：密钥明文落盘，标 S；密钥出现在日志/错误消息里，标 A；密钥缓存无清理，标 B。

### 2. SQL 注入面
**怎么查**：在 `domain/*/repositories/impl/` 和 `infra/sql-template/` 找 SQL 拼接。重点：
- 有没有用模板字符串拼 SQL 而非参数化查询？
- sql-template 的参数绑定是否安全？有没有可能逃逸？
- 用户可控的值（配置项、消息内容）是否进入了 SQL？

**判定标准**：确认有 SQL 拼接且用户可控值进入，标 S；参数化查询但边界条件可能逃逸，标 A。

### 3. 路径穿越
**怎么查**：在 `domain/vfs/` 找路径构造逻辑。检查：
- 用户输入的文件名/路径有没有 `../` 过滤？
- vfs 路径解析后是否在允许的根目录内？
- agent tool 能不能通过 vfs 路径访问到 core 自己的文件？

**判定标准**：路径穿越可达（能访问预期外的文件），标 S。

### 4. 公共面完整性
**怎么查**：读 `packages/core/src/index.ts`。对比：
- 外部 packages（apps/ 和其他 packages）实际 import 的符号，vs index.ts 导出的符号
- 如果外部 import 了 index.ts 里没有的符号，说明走的是私路径（和 L3 互补）
- 如果 index.ts 导出了内部实现类型（比如 repo 的内部 schema），是公共面过宽

**判定标准**：外部需要的类型没导出（迫使走私路径），标 A；导出了内部实现细节，标 B。

### 5. 输入校验覆盖
**怎么查**：对每个「外部输入入口」，检查有没有 zod 校验：
- 用户配置加载时
- LLM 返回解析时
- vfs 文件内容解析时
- character-card 导入时
- 消息导入/导出时

**判定标准**：外部输入入口无校验，标 A。

### 6. tool / agent 权限边界
**怎么查**：读 `domain/tool/` 和 `vfs-zip-io-agent-tool-policy` 的 spec。检查：
- agent 的 tool 调用有没有权限控制？
- agent 能否通过 vfs tool 读写任意路径？
- tool 返回的内容有没有被校验（防止 LLM 注入恶意 tool 结果）？

**判定标准**：agent 可越权访问文件/配置，标 A。

## 与其他角度的潜在冲突

| 对方角度 | 可能的冲突 | 你的立场 |
|----------|-----------|----------|
| **L3 架构** | 你说「这个该导出」，L3 可能说「这个不该导出（是内部细节）」 | 如果外部需要它但它是内部细节，说明抽象层级有问题——双方都对，冲突交给 phase3 |
| **L1 数据模型** | 你说「输入校验缺失」，L1 可能说「schema 定义了」 | schema 定义了不代表运行时校验了——区分「有 zod schema」和「有实际 .parse()」 |
| **L6 跨端** | 你说「密钥处理不安全」，L6 可能说「三端密钥实现不同」 | 三端不同不代表某个端不安全——你分别评每个端 |

## 输出格式

遵守 `CR-LOOP-GUIDE.md` 的文档结构规范。文件路径 `docs/review/phase1-lens/D1-08-api-security.md`。

在「结论」节，分两部分叙述：先讲 API 稳定性整体水平，再讲安全性整体水平。这俩在你的报告里是两节，但互相关联——不稳定的 API 往往也是安全漏洞的来源（内部实现暴露 = 攻击面扩大）。

**特别要求**：你的报告必须包含：
1. **公共面审计表**：index.ts 导出的每个符号 → 是公共契约 / 是内部泄漏 / 标注
2. **安全风险矩阵**：入口点（配置/LLM返回/vfs/tool/导入导出）× 风险类型（注入/穿越/密钥泄漏/越权）→ 有无防护

在「待交叉的线索」节，标出哪些安全发现可能和 L3（架构）或 L1（数据模型）冲突。

## 严重度参考

### 安全类

| 级别 | 场景 |
|------|------|
| **S** | 密钥明文落盘；SQL 注入可达；路径穿越可达 |
| **A** | 外部输入无校验；密钥泄漏到日志；agent tool 越权 |
| **B** | 错误消息含敏感信息片段；校验不完整（部分字段未校） |
| **C** | 日志级别不当（debug 信息含上下文） |

### API 稳定性类

| 级别 | 场景 |
|------|------|
| **S** | 顶层 index.ts 导出了内部实现且外部已依赖（重构即破坏性变更） |
| **A** | 外部需要的类型未导出（迫使走私路径）；导出类型与运行时不符 |
| **B** | 导出了过多的内部细节（暂无外部依赖但有风险） |
| **C** | 导出命名不一致；缺少 deprecation 标记 |
