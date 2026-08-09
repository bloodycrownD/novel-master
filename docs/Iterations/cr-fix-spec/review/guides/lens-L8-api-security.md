# L8：API 稳定性 & 安全

> 角度横扫指导。你是 lens-sweep 子代理，readonly，负责从**公共 API 契约稳定性、包导出面设计、发版策略一致性、安全性**这一个角度扫遍整个仓库。

## 你的一句话职责

查清这个仓库的**公共面对不对、稳不稳定、安不安全**。公共面有三层你要一起看：源码层是 `index.ts` 导出（导出了什么、该不该导出、有没有破坏性变更），包描述层是 `package.json` 的 `exports` 字段（24 个子路径、三种路径风格、封装性破坏），发版层是版本号和 release 流程（0.0.0 vs 1.4.16 的混乱、release.yml 只发部分包）。安全面你关注密钥处理、输入校验、注入面。这四块看似分散，但共同点是「都关注**边界**」——源码公共面是模块边界，包导出面是发布单元边界，发版策略是兼容性边界，安全是信任边界。

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

### 包导出面设计
- **package.json exports 路径风格混用**：`./chat` 指向 `dist/public/*`（正确，走 public 面），但 `./tdbc` 指向 `dist/infra/tdbc/`（暴露内部 infra 目录）、`./kkv` 指向 `dist/service/*`（暴露 service 层）——三种风格混用说明 exports 设计没有一致原则。
- **exports 暴露内部目录**：`./tdbc` 直接映射到 `dist/infra/tdbc/` 意味着消费者能 import core 的 infra 内部实现，绕过了 `src/index.ts` 这个源码公共面。源码层 facade 做得严（只有 183 行导出），但 package.json 层却开了 24 个口子，两层公共面不一致。
- **exports 与 src/index.ts 不同步**：src/index.ts 只导出 183 行的能力，但 package.json exports 有 24 个子路径——这俩是谁在定义真正的公共面？如果 exports 暴露的符号在 src/index.ts 里没有，说明它们是「绕过源码 facade 直接发布的内部模块」。

### 发版策略一致性
- **版本号 0.0.0 vs 1.4.16 混乱**：desktop 和 mobile 是 `1.4.16`（有真实版本管理），但 core 和所有 driver 包停在 `0.0.0`（语义上等于「随时破坏性变更」）。0.0.0 的包被 1.4.16 的包消费，版本语义自相矛盾。
- **release.yml 只发部分包**：`.github/workflows/release.yml` 只发布 mobile 和 desktop，core 和 driver 包没有发版流程——但它们的 package.json 有 name 字段，理论上可发布。这意味着 core 的「已发布版本」和「实际被消费的版本」（monorepo 内部 workspaces 链接）是两回事。
- **CHANGELOG / 发版产物校验缺失**：发版流程没有自动校验 CHANGELOG 是否更新、发版产物是否包含 exports 声明的所有入口。

## Phase 0 已确认的公共面现实

Phase 0 侦察已读完全部 `packages/core/src/index.ts`（183 行），**公共面实际很窄**：

### 顶层 index.ts 实际导出范围（已知）

导出了这些能力：
- **SQL Template**：SqlTemplateParser、parseTemplateToAst 等
- **TDBC**：open、registerDriver、connection 类型
- **Bootstrap**：bootstrapNovelMaster、NOVEL_MASTER_SCHEMA_STATEMENTS
- **DB Backup**：dumpProviderTableSnapshot、scrubProviderTables 等
- **Cloud Sync**：CloudSyncCoordinator、lease/lock 相关
- **KKV / Preferences**：createPersistentState、createPersistentPreferences、preference keys
- **Tool**：ToolRegistry、ToolRunner、vfs tools、builtin tools
- **Serialization**（文件末尾，183 行处）

**未导出的重要 context**（外部消费者怎么用它们？这是 L8 要查的重点）：
- chat、vfs、message、agent、prompt、provider、compaction、regex、workplace 等 domain context 的能力，**顶层 index.ts 几乎没直接导出**
- 这意味着要么外部 app 不直接用这些（通过别的机制），要么有未发现的入口

### 公共面审查重点（基于实测）

1. **未导出的 context 如何被消费**：读 apps/cli、apps/desktop、apps/mobile 的入口文件，看它们怎么获得 chat/vfs/message 能力——是通过 factory 函数？还是 core 另有未发现的公共面？
2. **导出范围是否合理**：183 行导出了 SQL template、TDBC、bootstrap 这些偏底层的能力，但没导出 chat/vfs 这些业务能力——分层是否倒置？
3. **安全面实际状汐**：sksp-schema 只有 1 行 CREATE，sksp 测试只有 1 个文件——密钥存储的防护实际有多少？

## 读什么文件

### 核心目标

| 目标 | 为什么看 |
|------|----------|
| **`packages/core/src/index.ts`** | 183 行，全读——这是唯一的顶层 facade |
| **`packages/core/package.json` exports 字段** | 第 8–104 行，24 个子路径——这是包导出面，和 src/index.ts 对照看是否一致 |
| **所有 `packages/*/package.json` + `apps/*/package.json` 的 version 字段** | 发版策略一致性检查 |
| **`.github/workflows/release.yml`** | 发版流程覆盖范围 |
| `packages/core/src/public/` | 13 文件，999 行——看 public 目录里有什么 |
| `packages/core/src/types/` | 1 文件，17 行 |
| `packages/core/src/errors/` | 17 文件，894 行——错误类型体系 |
| `packages/core/src/domain/*/` | 查哪些类型该被导出但没导出 |
| `packages/core/src/infra/sksp/` | 密钥存储——安全核心 |
| `packages/core/src/infra/llm-protocol/` | API key 传输——安全核心 |
| `packages/core/src/infra/tdbc/` + `infra/sql-template/` | SQL 执行——注入面 |
| `packages/core/src/domain/vfs/` | 文件系统操作——路径穿越 |
| `packages/core/src/domain/tool/` | tool 系统——权限边界 |
| `packages/core/src/config-forms/` | 配置表单——输入校验 |
| **apps/cli/src、apps/desktop/src** | 查它们如何获得未导出的 context 能力 |

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

# package.json exports 字段（包导出面）
include: "packages/core/package.json"
regex: "\"exports\"|\"\./"

# 找所有包的 version 字段（发版策略）
include: "**/package.json"
regex: "\"version\"\s*:\s*\"0\.0\.0\""

# 找外部消费 core 子路径的方式（验证 exports 是否被实际使用）
include: "apps/**/*.ts*"
regex: "from\s+['\"]@novel-master/core/"
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

### 7. 包导出面设计（扩展维度）
**怎么查**：读 `packages/core/package.json` 的 `exports` 字段（第 8–104 行，24 个子路径）。对每个子路径：
- 它映射到 `dist/` 下的哪个目录？是 `dist/public/`（走源码 facade）、`dist/infra/`（暴露 infra 内部）、还是 `dist/service/`（暴露 service 层）？
- 这个导出在 `src/index.ts` 里有对应吗？如果没有，说明 package.json 在发布一个源码层没声明的公共面。
- 外部包（apps/、其他 packages/）实际通过哪种子路径 import core？grep `from ['"]@novel-master/core/` 看真实消费模式。

**判定标准**：exports 映射到 `dist/infra/` 或 `dist/service/`（暴露内部层），标 A；exports 子路径在 src/index.ts 无对应且被外部消费，标 A；exports 与实际 import 路径不符（声明了但没人用，或有人用但没声明），标 B。

### 8. 发版策略一致性（扩展维度）
**怎么查**：
- 读所有 `packages/*/package.json` 和 `apps/*/package.json` 的 `version` 字段，列一张「版本号对照表」。找出哪些是 0.0.0、哪些是真实版本号。
- 读 `.github/workflows/release.yml`，看它发哪些包、不发哪些包。
- 读 `CHANGELOG.md`（如果存在），看它是否覆盖所有发布了的包。
- 判断 0.0.0 的包被其他包消费时，semver 语义是否还成立（0.0.0 意味着任何变更都是 breaking）。

**判定标准**：被消费的包停在 0.0.0 且消费者是有真实版本的包，标 A（版本语义矛盾）；release 流程漏发有 name 的包，标 B；CHANGELOG 与实际发版产物不符，标 B。

## 与其他角度的潜在冲突

| 对方角度 | 可能的冲突 | 你的立场 |
|----------|-----------|----------|
| **L3 架构** | 你说「这个该导出」，L3 可能说「这个不该导出（是内部细节）」 | 如果外部需要它但它是内部细节，说明抽象层级有问题——双方都对，冲突交给 phase3 |
| **L1 数据模型** | 你说「输入校验缺失」，L1 可能说「schema 定义了」 | schema 定义了不代表运行时校验了——区分「有 zod schema」和「有实际 .parse()」 |
| **L6 跨端** | 你说「密钥处理不安全」，L6 可能说「三端密钥实现不同」 | 三端不同不代表某个端不安全——你分别评每个端 |
| **L3 架构（包依赖）** | 你发现 exports 暴露了内部目录，L3 可能发现 package.json 的 dependencies 也暴露了内部 | L3 看 dependencies（包依赖图），L8 看 exports（包导出面）——两者互补，不冲突 |
| **L10 工程化基建** | 你发现 release.yml 只发部分包，L10 也会发现 CI 缺失 | 发版产物范围归 L8（API 稳定性），CI 是否覆盖 PR/push 归 L10 |

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
| **A** | 外部需要的类型未导出（迫使走私路径）；导出类型与运行时不符；exports 映射到 dist/infra/ 或 dist/service/（暴露内部层）；exports 子路径被消费但 src/index.ts 无对应；被消费的包停在 0.0.0 且消费者是真实版本 |
| **B** | 导出了过多的内部细节（暂无外部依赖但有风险）；exports 与实际 import 路径不符；release 流程漏发有 name 的包；CHANGELOG 与实际发版产物不符 |
| **C** | 导出命名不一致；缺少 deprecation 标记；版本号局部不一致但无 semver 风险 |
