# packages/core 中文字面量 i18n 化方案（SPEC）

> 目标树：`D:/Dev/Js/novel-master-tokfix`（分支 `main`）
> 范围：`packages/core` 用户可见中文文案的 i18n 化改造方案。本文只定契约与任务，不改业务代码。
> 已存在的运行时：`packages/core/src/common/i18n.ts` 的 `createTranslator` + `MessageDescriptor`（`common/i18n.ts:36-71`）。
> 修订：R3（2026-11-07）。catalog 载体按拍板换轨为 **YAML @ `packages/core/src/i18n/catalog/<locale>.yaml`**（core 已依赖 `yaml@^2.8.2`，零新增依赖；加载一律 `yaml` 包 `parse`，各端启动一次）。继承 R2 的统计基线、六分类、错误契约与任务分组；R2 的 JSON 探针、`locales/core.*.json` 布局与「import attribute 注入」路线随拍板作废。R2/R3 两次修订中的可复验数字（census 581、应用侧五组、测试侧 449/377/12588、X 桶死链）均已在 R3 会话复跑核对，见 §1 与附录 A。

---

## 0. 结论速查

| 规则 | 决定 |
| --- | --- |
| catalogPath | `packages/core/src/i18n/catalog/zh-CN.yaml`（唯一真源，必须全量）+ `en-US.yaml`（允许部分）；代码模块在 `packages/core/src/i18n/`（keys / 错误映射 / `parseCoreCatalog`），经新子入口 `@novel-master/core/i18n` 暴露；数据文件经 `"./i18n/catalog/*"` exports 子路径直指 src（先例：`"./locales/*"`） |
| keyRule | `error.<domain>.<name>[.<reason>]` / `label.<domain>.<name>[.<object>]`；全小写 snake_case、段间 `.`、参数 `{snake}`；**YAML 层级即 key 结构**（`error.vfs.not_found` = 三层嵌套节点）；格式与域词表有可执行校验 |
| localeRule | 默认 `zh-CN`；回退链 = 精确 locale → 同语言前缀 → `zh-CN` → key 原文（由 `common/i18n.ts:46-53` 现有实现承担，不改代码）；zh-CN 必须 100% 覆盖，en-US 允许部分；本轮不做运行时切换 |
| injectionRule | YAML 是唯一真源；core 出 `parseCoreCatalog(text)`（`yaml.parse` + 展平 + 叶子必须 string 的硬校验）+ key/类型/descriptor，**core 不建 translator、不读盘、不持全局 locale**；各端启动加载一次：desktop main 用 node fs；desktop renderer 经 IPC 拿 main 已 parse 的对象（不读文件）；mobile 经构建期拷贝进 android assets + `react-native-blob-util` `fs.asset()` 读文本；cli / core 测试用 node fs；webview 由 `build-webview.mjs` 构建期 parse 生成内嵌模块。**core 自带默认 zh-CN catalog 数据文件，但运行时不自动加载** |
| scopeRule | 只迁「用户可见错误 + 展示标签」= **255 处 / 50 文件**（A 187 + B 68）；排除 C 172 + D 58 + E 86 + X 10 = 326 处（LLM 工具描述 / SQL DDL·正则·种入数据 / 日志诊断 / 死代码），逐桶理由见 §2.5 |

---

## 1. 现状盘点

### 1.1 统计口径与命令

统计脚本用 TypeScript 编译器 AST 遍历 `packages/core/src/**/*.ts(x)`，计 `StringLiteral` + `NoSubstitutionTemplateLiteral` + `TemplateExpression`（每个节点计 1，静态片段不拆开）+ `JsxText` 中含 CJK 的节点。注释不是 AST 节点，天然排除；正则字面量是 `RegularExpressionLiteral`，也天然排除。

实际运行的命令（`node -e` 一行版，R3 会话复跑，输出与 R2 逐字一致）：

```bat
cd /d D:/Dev/Js/novel-master-tokfix && node -e "const fs=require('fs'),path=require('path'),ts=require('typescript');const CJK=/[\u3400-\u4dbf\u4e00-\u9fff\u3000-\u303f\uff01-\uff60]/;const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):/.tsx?$/.test(e.name)?[path.join(d,e.name)]:[]);const g={};let t=0;for(const f of walk('packages/core/src')){const sf=ts.createSourceFile(f,fs.readFileSync(f,'utf8'),ts.ScriptTarget.Latest,true,f.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);let n=0;(function v(x){if((ts.isStringLiteral(x)||ts.isNoSubstitutionTemplateLiteral(x)||ts.isTemplateExpression(x)||ts.isJsxText(x))&&CJK.test(x.getText(sf)))n++;ts.forEachChild(x,v)})(sf);if(n){t+=n;const d=path.relative('packages/core/src',f).split(path.sep)[0];g[d]=(g[d]||0)+n}}console.log('TOTAL',t);console.log(Object.entries(g).sort((a,b)=>b[1]-a[1]).map(x=>x[0]+':'+x[1]).join(' '))"
```

输出：

```text
TOTAL 581
domain:358 service:76 infra:60 bootstrap:31 errors:25 presentation:21 common:10
```

节点类型拆分（R2 按同一套 AST 逻辑跑的脚本文件，正文见附录 A）：`{"string":328,"templateNoSub":18,"templateExpr":235,"jsxText":0}`，命中文件 108 个。

任务基线约 567，实测 **581**（+14，+2.5%）。差异来自口径：本统计把带插值的模板串按 AST 节点计 1 次，也计入纯全角标点串（如 `chunk-splitter.ts` 的断句标点集）。另用「只认汉字、行级正则、剥注释」的粗口径独立复算得 530，与 581 的差值即全角标点串与 AST 计法——两套口径指向同一分布。

**分类如何复现**（硬要求）：分类 = 文件级/行级人工基线 + 两条自动覆盖，三者都在 §4 的 108 行基线表里可核对：

1. 跑上面的 census，得到每个文件的原始处数；
2. 按 §4 表把每个文件（以及混合文件的具体行）划到 A/B/C/D/E/X；
3. 自动覆盖规则（`check-i18n.mjs` 同款）：
   - CJK 字面量位于 `log.debug|log.info|log.warn|log.error` / `logger.*` / `console.*` 的调用实参内 → **E**；
   - CJK 字面量位于含 `INVARIANT` 的 `throw new AppError(...)` 内 → **E**。
4. 断言：A 187、B 68、C 172、D 58、E 86、X 10，合计 581，未分类 0。

R2 相对 R1 的行级修正（R3 抽查样本全部吻合，未翻案）：

| 位置 | R1 | R2/R3 | 依据 |
| --- | --- | --- | --- |
| `infra/cloud-sync/impl/cloud-sync-coordinator.ts:355` | A | E | `log.warn` |
| `service/chat/impl/usage-stats.service.ts:538/567` | A | E | `log.warn` |
| `infra/cloud-sync/logic/push-agent-mutex.ts:105` | A | E | 只作 `CloudSyncError("PUSH_MUTEX_TIMEOUT", …)` 的 cause（coordinator:255-263），UI 只显示外层文案 |
| `domain/tool/builtin/vfs-tools.ts:433/473` | C | E | `log.debug` |
| `domain/tool/builtin/curl-tool.ts:385` | C | E | `log.debug` |
| `domain/tool/builtin/search/search-tool.ts:207` | C | E | `log.debug` |
| `domain/prompt/logic/normalize-agent-prompt-layout.ts:96` | C | E | `AppError("PROMPT_INVARIANT_VIOLATION", "[invariant] …")`，内部不变量 |
| `presentation/chat/user-vfs-turn-preview.ts` | C | X | 预览展示文本而非模型上下文；生产零引用（R3 复验：全仓只剩 `apps/mobile/test-utils/core-shim.ts` 一处测试引用），应先判死链 |
| `errors/session-fs-errors.ts:138/228/231/232/233` | A | X | `sessionFsRollbackNoCheckpoint` 自述「Rollback no longer throws this」；`formatRollbackRevisionBackfillAlertMessage` 文案与 `chat.rollback.confirm.backfill*` 重复（R3 复验：生产消费者仅 public 再导出、allowlist 快照与测试，无调用方） |

### 1.2 六分类结果

| 分类 | 含义 | 处理 | 处数 | 文件数 |
| --- | --- | --- | --- | --- |
| **A** | 用户可见错误（UI/IPC/启动错误/表单校验） | 迁 | **187** | 40 |
| **B** | 展示标签（状态、选项、chip、预览、统计） | 迁 | **68** | 10 |
| C | LLM / 提示词 / 工具描述 | 不迁 | 172 | 18 |
| D | SQL DDL / 正则 / 种入数据 / 落库文本 / 发布文案 | 不迁 | 58 | 12 |
| E | 日志 / 不变量 / 诊断 | 不迁 | 86 | 38 |
| X | 死代码 / 与既有 chat key 重复 | 删除或复用，不新建 key | 10 | 2 |
| 合计 | | | **581** | 108 |

A 桶去重 160 条不同文本，B 桶 56 条；按模板归并（部分文本用参数泛化）预计落成 **`error.*` ≈ 145 条 + `label.*` ≈ 54 条（约 200 条）**。

### 1.3 应用侧对照（说明为什么本轮只做 core）

同一 AST census 跑各端（R3 会话复跑，与 R2 一致）：

| 端 | 处数 | 文件数 |
| --- | --- | --- |
| `packages/core/src` | 581 | 108 |
| `apps/desktop/src`（main） | 105 | 24 |
| `apps/desktop/renderer` | 1102 | 80 |
| `apps/desktop/shared` | 65 | 3 |
| `apps/mobile/src` | 1483 | 164 |
| `apps/cli/src` | 8 | 5 |

应用自有文案（约 2700 处）不在本轮范围：它们不跨端复用、没有第二消费者，且默认 locale 就是中文。先迁 core 才能让三端共享同一份 key 与 catalog。

### 1.4 既有 i18n 基建与先例

- 运行时：`createTranslator(catalogs, defaultLocale)`（`common/i18n.ts:36-71`）；字符串直传、descriptor、函数模板三态并存；`{param}` 插值（`:57-69`）；descriptor 数组按行拼接（`:62-64`）；locale 回退（`:46-50`）；缺 key 返回 key 本身（`:51-53`）。
- 对外导出：`common/index.ts:32-33` 已导出 `createTranslator` / `MessageCatalog`（`MessageDescriptor` / `MessageLike` 同段；`MessageParams` 未导出，见 §1.5-1）。
- 第一条完整通道（chat 域，**保持 JSON 原样，本轮不合并**）：key 契约 `domain/chat/i18n/keys.ts:12-25`，catalog `packages/core/locales/chat.zh-CN.json` / `chat.en-US.json`，descriptor 生产者 `presentation/chat/rollback-confirm.ts:47-65`，两端注入 `apps/desktop/renderer/i18n/chat.ts:10-16`、`apps/mobile/src/i18n/chat.ts:1-12`。
- 本方案沿用这条通道的形状（key 契约 + descriptor 生产者 + 各端 translator），把载体换成 YAML、范围扩到「错误 + 标签」并补上 core 侧 key 类型与错误映射。
- 包导出先例：`packages/core/package.json` 的 `"./locales/*": "./locales/*"`——**数据文件可以不经 dist 直接由 exports 子路径对外**，这是 `"./i18n/catalog/*"` 直指 `src/i18n/catalog/` 的先例；构建脚本 `tsc --build tsconfig.json && tsc-alias -p tsconfig.json` 只处理 TS，YAML 数据文件不需要进 dist。

### 1.5 影响方案的硬事实（R3 实测）

1. **`MessageParams` 没导出**（`common/i18n.ts:23` 是模块内 `type`）。错误类与 IPC payload 要携带参数，必须先导出。
2. **`yaml@^2.8.2` 已是 core 依赖**（`packages/core/package.json` dependencies，R3 读取确认），YAML 化零新增依赖。
3. **`yaml` 包的解析行为（R3 探针实测，node 22 + 仓内 `node_modules/yaml`）**：

   | 写法 | parse 结果 | 结论 |
   | --- | --- | --- |
   | `k: 文件: 不存在`（值含半角 `": "`，裸值） | **YAMLParseError**（`BLOCK_AS_IMPLICIT_KEY`） | 含半角 `": "` 的值**必须加引号**，否则整个文件解析失败 |
   | `k: 文件：存在`（全角冒号） | string `"文件：存在"` | 全角冒号安全，可不加引号 |
   | `k: 123` / `k: 1.5` | **number** `123` / `1.5` | 形似数字被强转；catalog 值必须是 string → 书写规范 + parse 硬校验双保险 |
   | `k: true` | **boolean** `true` | 同上 |
   | `k: on` | string `"on"` | yaml@2 实现 YAML 1.2 core schema，`on` 不转布尔；但规范仍一律禁止陷阱词裸值（防 schema 差异 + `true/false/数字` 是实打实强转） |
   | `k: "文件: 不存在"` / `k: "123"` / `k: "true"` | string | 引号是通用解 |
   | 三层嵌套 → 递归展平 | `error.vfs.not_found` 等 dotted key | 层级即 key 结构成立 |
   | 双引号值内 `\n` | 真换行 | 多行文案用双引号 + `\n`，不用 YAML 折行语法 |

4. **mobile 具备读内置 asset 文本的能力链**（R3 实测确认）：`react-native-blob-util` 的 `fs.asset(path)` 存在（`node_modules/react-native-blob-util/index.d.ts:453`），配合 `fs.readFile(asset('x.yaml'), 'utf8')` 可读 android assets 内文本；`apps/mobile/android/app/src/main/assets/` 目录已存在且 `webview/` 子目录就是打包内置产物的先例；RN 默认 assetExts 本就含 `yaml`/`yml`（`@react-native/metro-config` `getDefaultConfig` 实测），metro `unstable_enablePackageExports: true`。仓内 mobile 的 YAML 现有用法全是文档选择器导入（`services/yaml-shared.ts`），**没有读内置 asset 的先例**，所以 mobile 侧需要一个拷贝脚本 + 启动读取接线（见 G4.4）。
5. **同一 AppError key 对应多条用户可见文案**：`AGENT_INVALID_SCHEMA` 在 `validate-agent-definition.ts:49-71` 就有 4 条不同原因；`PROMPT_INVALID_LAYOUT` 在 `validate-agent-prompt-layout.ts` 有 20+ 条。key **不能**从错误码一路机械推导，必须有「原因级」key，由抛错点携带 descriptor。
6. **错误跨 IPC 丢上下文**：`format-ipc-error.ts:84-124` 只产出 `{code, message}`，`IpcErrorPayload` 定义在 `apps/desktop/shared/ipc-types.ts:206-211`；`details` 到不了渲染层。
7. **core 已有英文 `desc` 兜底**：`AppError` 的 `message` 缺省取 `ErrorCodes[key].desc`（`app-error.ts:30`），`error-codes.ts:26-139` 的 82 条 desc 全是英文。删掉中文 message 不会让日志失去可读性。`provider-errors.ts` 已有英文 copy 工厂，是先例。
8. **core 测试中文很多**（R3 复跑：行含汉字口径）：`packages/core/test` 共 **449** 个 `.ts/.tsx`，**377** 个含 CJK，含汉字行 **12588**（R2 用「汉字 + 全角标点」口径得 12694，本轮未复跑该变体，引用注明）。
9. **webview 门 B 归属只认 `packages/core/dist/`**（`apps/mobile/scripts/build-webview.mjs:404/:421`，`assertCoreAllowlist` 在 `:397-408`，报错输出 `:436-449`）：catalog YAML 放在 `src/i18n/catalog/` 且不在 dist 时，**门 B 看不到它**——webview 侧不能依赖「运行时读 core 的 YAML 文件」，必须构建期内嵌（G4.5）；`createTranslator`（`dist/common/i18n.js`）进入 webview bundle 仍需 allowlist（先跑一次门 B 拿实际 inputs 清单）。

---

## 2. 五条规则

### 2.1 catalogPath

```text
packages/core/src/i18n/catalog/zh-CN.yaml   ← 唯一真源（必须全量）
packages/core/src/i18n/catalog/en-US.yaml   ← 允许部分（本轮可先只有骨架）
packages/core/src/i18n/keys.ts              ← CORE_MESSAGE_KEYS / CoreMessageKey / CoreMessageDescriptor
packages/core/src/i18n/catalog.ts           ← parseCoreCatalog(text)：yaml.parse + 展平 + 硬校验
packages/core/src/i18n/error-message.ts     ← userMessageOf(error) 与 code → key 映射表
packages/core/src/i18n/localized-message.ts ← string | descriptor 的统一解包
packages/core/src/i18n/index.ts             ← barrel
packages/core/src/public/i18n.ts            ← 子入口 allowlist（新增 ./i18n）
```

`packages/core/package.json` exports 追加两条（与 `"./locales/*"` 同型）：

```jsonc
"./i18n": { "types": "./dist/i18n/index.d.ts", "import": "./dist/i18n/index.js" },
"./i18n/catalog/*": "./src/i18n/catalog/*"    // 数据文件直指 src，不经 dist、不经 tsc
```

- 为什么数据文件放 src 而不是 dist：tsc build 只 emit TS（`tsc --build` + `tsc-alias`），YAML 要进 dist 得另加拷贝步骤；exports 子路径直指 src 后，node 宿主（desktop main / cli / 测试）与发布包（无 `files` 字段，默认随包带 src；G0 落地时复核 `.npmignore`）都能解析到同一份文件，构建链零改动。
- 不拆 `error.<locale>.yaml` / `label.<locale>.yaml`：单文件便于做 key 对齐与占位符对齐的强校验，当前预计 ~200 条，远没到需要拆分的规模；将来超过 ~500 条再按 area 拆，key 前缀不变。
- `packages/core/locales/chat.*.json` 保持原样，**本轮不合并**。chat 的 key 前缀天然是 `chat.`，与 `error.` / `label.` 不冲突；把 chat 通道也搬到 YAML 属下一轮清理（G6）。

### 2.2 keyRule

格式（正则可执行校验）：

```text
^(error|label)\.[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,3}$
```

- `area`：`error` | `label`，与 scope 的两个 IN 分类一一对应。
- `error` 域词表（固定，不按 code 前缀自由发挥）：`agent` `vfs` `chat` `skill` `provider` `session_fs` `compaction` `smart_sort_rule` `preferences` `infra` `format` `kkv` `depth` `prompt` `workplace` `cloud_sync` `db_backup` `usage` `tool`。
  - `VFS_ZIP_*`、`VFS_CONTENT_*`、`VFS_CHARACTER_CARD_*` 一律归 `vfs`，子域写进 name 段（`error.vfs.character_card_too_large`），**不单独设 `vfs_zip` / `character_card` 域**。
  - `SESSION_FS_*` 归 `session_fs`；`COMPACTION_CONDITIONS_*` 归 `compaction`；`SMART_SORT_RULE_*` 归 `smart_sort_rule`。
- `label` 域词表：`agent` `attachment` `chat` `provider` `workplace` `token_source` `stream_metrics` `prompt_preview` `smart_sort`（用不到的域不要预留）。
- 段名全小写 `snake_case`；有 code 的错误按 code 机械派生；同一 code 有多条用户可见原因时追加 `.reason`。
- 参数占位符 `{snake_case}`；可选片段拆成两个 key，不用空串拼句子。
- 禁止：数字序号（`error.vfs.error1`）、代码标识符原样（`VFS_NOT_FOUND`）、复数/时态、在 key 里写具体值。
- **YAML 映射：层级即 key 结构**。`error.vfs.not_found` 写成三层嵌套节点；`error.agent.invalid_schema.name_required` 是四层。段名即节点名，展平由 `parseCoreCatalog` 做（§2.4）。中间节点必须是 mapping（不能是数组、不能带值），叶子必须是字符串——违反即启动失败。

派生示例：

| 来源 | key |
| --- | --- |
| `AppError("VFS_NOT_FOUND")` / `VfsError("NOT_FOUND")` | `error.vfs.not_found` |
| `ErrorCodes.VFS_CHARACTER_CARD_TOO_LARGE`（`error-codes.ts:33`） | `error.vfs.character_card_too_large` |
| `SessionFsError("ROLLBACK_MESSAGE_NOT_FOUND")`（`session-fs-errors.ts`） | `error.session_fs.rollback_message_not_found` |
| `AppError("AGENT_INVALID_SCHEMA", "definition.name 必填…")`（`validate-agent-definition.ts:49`） | `error.agent.invalid_schema.name_required` |
| `CloudSyncError("PUSH_MUTEX_TIMEOUT")` 推送/拉取两个方向（coordinator:257-263） | `error.cloud_sync.push_mutex_timeout.push` / `.pull` |
| `STORED_CONFIG_LABELS.invalidTitle`（`labels.ts:23`） | `label.agent.invalid_title` |
| `workplace-labels.ts:10` `规则·开` | `label.workplace.rule_on` |
| `attachment-chip.ts:13` `删除` | `label.attachment.action.delete` |
| `attachment-chip.ts` `${zh}:${path}` | `label.attachment.chip` = `{action}:{path}` |
| `format-token-count.ts:59` `远程` | `label.token_source.api` |
| `format-stream-metrics-line.ts:41` `生成中` / `上次生成` | `label.stream_metrics.running` / `label.stream_metrics.last` |

两条硬约束：

1. **`error.*` 的值必须是完整人话**，不允许只写 `{reason}` 转手；`{reason}`/`{detail}` 的值本身应是另一个 `error.*` descriptor（`createTranslator` 支持嵌套 descriptor，`common/i18n.ts:68`）。只有来源本身是英文日志文本时才允许透传字符串。
2. **一个 key 一种语义**。`zh-CN` 与 `en-US` 的同一个 key 不能表达不同意思；语序差异用整句模板吸收，不做逐词拼接。

### 2.3 localeRule

- 默认 locale：`zh-CN`。证据：全仓没有面向用户的 locale 偏好键（`service/persistent-preferences/impl/preference-keys.ts` 只有 `chat.llmStream` 等业务键，无 `locale`/`language`），`domain/format/format-char-count.ts:3` 直接写死 `toLocaleString("zh-CN")`，现有 UI 文案全是中文。
- catalog 集合：`zh-CN`（必填、必须全量）、`en-US`（可选、允许部分）。
- 回退链（由 `common/i18n.ts:46-53` 实现，不需要改代码）：
  1. 精确 locale，如 `en-US`；
  2. 同语言前缀匹配：`Object.keys(catalogs).find(...)`，**依赖对象键顺序**；
  3. `defaultLocale`；
  4. 该 key 原文（缺失时返回 key，不返回空串）。
- 调用方必须按 `{ "zh-CN": ..., "en-US": ... }` 的顺序构造 catalogs。若将来加 `zh-TW`，要么放在 `zh-CN` 之前，要么把前缀匹配换成显式别名表。
- 校验（G0 落地）：zh-CN 展平后的 key 集合 === `CORE_MESSAGE_KEYS`；en-US 不得出现多余 key；两 locale 同一 key 的 `{param}` 集合必须一致。
- 本轮**不做运行时切换**：`createTranslator` 是创建时绑定 `defaultLocale` 的纯函数（`common/i18n.ts:36-37`），切换需要重建 translator 或重启进程。locale 来源（`app.getLocale()` / `I18nManager.localeIdentifier` / `process.env.LANG`）放到下一轮。

### 2.4 injectionRule

**总则**：YAML 是唯一真源；**谁有文件读取能力，谁 load YAML**；所有宿主统一用 core 的 `parseCoreCatalog`（内部 `yaml.parse`）解析，**启动一次**、模块级单例 translator（与 `apps/desktop/renderer/i18n/chat.ts` 的 chat 通道同构）。core 不创建 translator、不持有全局 locale、不在运行时读盘——core 只出 key/类型/descriptor 生产者/`parseCoreCatalog`/数据文件。理由：core 跑在 Electron main、渲染进程、RN、webview、CLI、Node 测试六套宿主里，「core 自己读文件」会把宿主 IO 能力焊进 core，也把「locale 由谁决定」塞回 core。

**`parseCoreCatalog` 契约**（`src/i18n/catalog.ts`）：

```ts
export function parseCoreCatalog(text: string): MessageCatalog<CoreMessageKey>;
// 1) yaml.parse(text)；
// 2) 根与所有中间节点必须是 plain object（数组/null/标量 → throw，报 dotted 路径）；
// 3) 叶子必须 typeof === "string"（number/boolean → throw：这是 §1.5-3 表里「形似数字/布尔」错误的运行时硬闸，写错启动即炸，不静默渲染数字）；
// 4) 递归展平为 dotted key 的 Record<string, string>；
// 5) 每个 key 必须匹配 §2.2 正则（不匹配 → throw）。
```

**各端注入矩阵**：

| 端 | 谁读 YAML | 怎么读 | 何时 createTranslator |
| --- | --- | --- | --- |
| desktop main | main 自己（node） | `fs.readFileSync`（路径解析到 `@novel-master/core/i18n/catalog/<locale>.yaml`，exports 子路径映射到 src），`parseCoreCatalog` | main 启动一次，`apps/desktop/src/main/i18n/core.ts` 建 `coreTranslator`；同时作为 renderer 的 catalog 供应方 |
| desktop renderer | **不读文件** | 启动时一次性 IPC（如 `i18n:getCatalogs`）拿 main 已 parse 的 catalogs 对象；类型与 `createTranslator` 经 `apps/desktop/shared/logic/core-i18n.ts` 具名再导出（X1 护栏：renderer 不得直连 core，禁 `export *`） | 拿到对象后 `apps/desktop/renderer/i18n/core.ts` 建一次 |
| mobile | mobile 自己（RN） | 构建期脚本把 catalog YAML 拷进 `apps/mobile/android/app/src/main/assets/i18n/`（与 `assets/webview/` 同路）；启动一次 `blobFs().readFile(blobFs().asset('i18n/<locale>.yaml'), 'utf8')` + `parseCoreCatalog` | App 初始化 `apps/mobile/src/i18n/core.ts`，启动一次；assets 缺文件 → readFile 直接抛错，漏跑拷贝脚本立刻可见 |
| webview（mobile 内嵌） | 构建脚本 | `apps/mobile/scripts/build-webview.mjs` 构建期读 core YAML → `yaml.parse` → 生成 `runtime/i18n/catalog.generated.js` 内嵌对象（生成物在 apps/mobile 侧，不是 core 输入，不经门 B） | `runtime/i18n.ts` 建一次；`createTranslator` 仍从 core dist 引入，需按门 B 实际 inputs 补 allowlist（G4.5） |
| cli | cli 自己（node） | `fs.readFileSync` + `parseCoreCatalog`，同 desktop main | 启动一次，`apps/cli/src/i18n.ts` |
| core 测试 | 测试 helper | `packages/core/test/helpers/core-i18n.ts`：node `fs.readFileSync` + `parseCoreCatalog`，不依赖任何 bundler 特性 | 每个测试文件按需 import `tCore` |

**core 内是否有默认 zh-CN catalog？** 有数据文件（`src/i18n/catalog/zh-CN.yaml`，必须全量），**没有代码内默认值、不自动加载**：core 运行时不读盘、不建全局 translator，任何需要渲染的地方必须由宿主显式注入。不注入就看得见问题，core 也不会偷偷读盘。

**为什么 renderer 经 IPC 而不是自己 parse**：renderer 无 node fs；vite 的 `?raw` 等方案受 X1 护栏与 main 构建形态牵制；main 反正要 translator（翻译必须物化成 string DTO 的聚合文案，见 G4.3），由 main 统一 parse、renderer 复用同一对象，天然保证两端看到同一份 catalog。代价是 renderer 启动多一次 IPC 往返——只在初始化时发生一次。

**mobile 为什么经 android assets 而不是 metro asset require**：metro 对 `@novel-master/core/i18n/catalog/*.yaml` 的 asset 解析要穿过 package exports 且路径会带 hash，仓内无先例；`assets/` 目录 + `fs.asset()` 是 tokenizer 资源与 webview 产物已验证的路（§1.5-4）。iOS 的 bundle 文件读取路径不同，本轮只保 Android（与仓内移动端现状一致），iOS 归 G6。

### 2.5 scopeRule

**本轮迁（IN）**：A 桶 187 处 + B 桶 68 处 = **255 处 / 50 文件**，见第 4 节逐文件表。

**本轮不迁（OUT）**，共 326 处：

| 类别 | 处数 | 代表文件 | 理由 |
| --- | --- | --- | --- |
| C LLM / 提示词 / 工具描述 | 172 | `domain/tool/builtin/*`（`vfs-tools` 33、`subagent-tool` 25、`agent-tool` 24、`curl-tool` 24、`skill-tool` 23、`search-tool` 11）、`prompt/model/agent-prompt-layout` 3、`render-prompt` 2、`format-tool-output` 8、`build-tool-result-block` 5、`attachment-xml-codec` 2、`attach-budget` 2、`attachment-hydrator` 1、`front-matter` 2、`workplace-labels` 3（`filetreeMacroLoadStateLabel`，进 `{{$filetree}}` 宏）、`default-subagent-definition` 2 | 这些文本进模型上下文，不是 UI。翻译会改 wire、改模型行为；模型侧只需要一种语言 |
| D SQL DDL / 正则 / 种入数据 / 落库文本 / 发布文案 | 58 | `bootstrap/*schema` 3、`builtin-smart-sort-rules` 22、`chunk-splitter` 12（中文断句标点集）、`build-new-skill-doc` 5、`character-card-to-md-tree` 4（生成的文件名）、`user-vfs-turn-constants` 1（`收到通知` 落库）、`agent-runner` 2（占位/失败消息落库）、`release.ts` 7（发版 markdown） | 归宿是 DB、构建产物或文件名。locale 切换后历史数据不能变。正则是数据不是文案。发版文案不跟运行时 locale 走 |
| E 日志 / 不变量 / 诊断 | 86 | `domain/vfs/content-store/*` 23（5 文件）、`coordinated-write` 5、`provider-identity-repair` 6、`normalize-agent-prompt-layout` 4、`integrity-repair` 4、`db-maintenance` 4、tokenizer 缓存 9、`usage-stats` 2、`cloud-sync-coordinator` 1、`push-agent-mutex` 1、`sqlite-*` 仓储诊断 | 只进日志与崩溃报告，开发者可见；翻译只增加噪声，且这些字符串常带内部字段名，中英混排反而更难 grep |
| X 死代码 / 重复 key | 10 | `errors/session-fs-errors.ts` 5、`presentation/chat/user-vfs-turn-preview.ts` 5 | 不新建 catalog。前者与 `packages/core/locales/chat.zh-CN.json` 的 `chat.rollback.confirm.backfill*` 逐字重复，删并复用 chat key；后者生产零引用（R3 复验仅 `apps/mobile/test-utils/core-shim.ts:79`），按 nm-code-style 判死链后删 |

明确边界补充：

- **持久化文本一律不迁**：`USER_VFS_TURN_ACK_TEXT = "收到通知"`（`domain/chat/logic/vfs-turn/user-vfs-turn-constants.ts:8`）、`agent-runner.ts:782` 的「（本次生成无内容输出）」、`agent-runner.ts:956` 的「[生成失败]」。它们在 append 时就固定进 DB，渲染时已无法区分语言。
- **seed 数据不迁**：`builtin-smart-sort-rules.ts` 的 name/description 是种进 `smart_sort_rule` 表的数据，改语言需要数据迁移策略，单开一轮。
- **内置 markdown 模板不迁**：`build-new-skill-doc.ts`（新建技能的 SKILL.md 模板）与 `release.ts` 的更新说明 markdown，消费者分别是模型与发版产物，不跟运行时 locale 走。
- **生成的文件名不迁**：`character-card-to-md-tree.ts:67/71/86/94` 的 `角色描述.md`、`开场001.md`、`条目N`、`世界书/…` 会写进用户 VFS，属数据。
- **push-agent-mutex 的 `等待 push/agent 互斥锁超时` 不迁**：它只作为 `CloudSyncError("PUSH_MUTEX_TIMEOUT", …)` 的 cause 存在（`cloud-sync-coordinator.ts:255-263`），UI 看到的是外层两条推送/拉取文案。

### 2.6 YAML 书写规范（catalog 的验收标准）

所有规则同时有静态测试（G0.6）与运行时硬校验（`parseCoreCatalog`）兜底；写错会在启动或测试当轮失败，不会静默渲染错值。

1. **引号规则**：
   - 值含半角 `": "`（冒号+空格）→ **必须加引号**（双引号优先）。不加不是风格问题，是解析错误：实测裸值 `文件: 不存在` 直接 `YAMLParseError`（§1.5-3）。
   - 值形似数字（`123`、`1.5`、科学计数）或布尔（`true`/`false`）→ **必须加引号**。不加会被强转成 number/boolean，`parseCoreCatalog` 的叶子 string 校验会拒绝整个文件。
   - 中文全角冒号 `：` 不受影响，裸值安全。
   - 陷阱词 `on` / `off` / `yes` / `no` / `true` / `false` / `null` / `~`（含大小写变体）**永不可作裸值**，一律引号。`on` 在 yaml@2 下实测不转布尔，仍禁止——防 schema/版本差异，且规则越简单越不会被误踩。
2. **缩进统一 2 空格**，禁 Tab；层级即 key 结构，`error.vfs.invalid_path` 是三层嵌套节点，段名即节点名。
3. **一 key 一行，不用 YAML 折行语法**（`>-` / `|` 等）：需要换行的文案（如 `ROLLBACK_REVISION_BACKFILL_REQUIRED` 的多行 Alert）用双引号 + `\n` 转义（实测双引号内 `\n` 是真换行）。折行块会让 diff 与 grep 变差，且块尾空白不可见。
4. **注释允许且鼓励**（`#` 开头）：给需要上下文的文案写维护说明——参数来源、消费它的 UI 位置、为什么不直译。示例见附录 B。注释是给人看的，`parseCoreCatalog` 天然忽略。
5. 值内出现字面 `{`/`}` 只允许作为 `{param}` 占位符；不要在文案里写裸花括号（`createTranslator` 按 `\{(\w+)\}` 替换，`common/i18n.ts:57`）。

---

## 3. 错误消息的端到端契约

### 3.1 现状链路

```text
core 抛错（AppError / VfsError / SessionFsError / CloudSyncError / ProviderError / ProviderTableSnapshotError …）
  ├─ desktop main: formatIpcError(err) → {code, message}          ← details 丢失（format-ipc-error.ts:84-124）
  │     └─ renderer: 直接显示 message，或 formatVfsErrorForUser(err)
  ├─ mobile: 进程内 formatError(err) → formatVfsErrorForUser / message（apps/mobile/src/errors/format-error.ts）
  └─ cli: 直接打印 message
```

问题：用户可见的中文有两套来源——错误类的 `message`（散落在抛错点）和 `formatVfsErrorForUser` 的硬编码表（`format-vfs-error-for-user.ts:65-83`）。前者跨 IPC 只能传字符串，后者是 core 里写死的中文。

### 3.2 descriptor 契约

统一让「用户可见文案」以 `MessageDescriptor` 形式随错误流动，`message` 退回日志用途。

**AppError**（`app-error.ts:23-41`）：

```ts
// 第二参从 string 放宽为 string | CoreMessageDescriptor；旧调用点零改动。
constructor(key: K, message?: string | CoreMessageDescriptor, details?: Record<string, unknown>, options?: ErrorOptions)

readonly messageKey?: CoreMessageKey;      // descriptor 时写入
readonly messageParams?: MessageParams;    // descriptor 时写入
```

- 传 descriptor 时：`super(ErrorCodes[key].desc)`（英文日志文案），`messageKey/messageParams` 记录 descriptor；`message` 不再承载中文。
- 传 string 时：行为与现在完全一致（迁移期兼容）。
- `toJSON()`（`app-error.ts:38-40`）追加 `messageKey`、`messageParams`，`AppErrorWire`（`:14-20`）同步。

**其余错误类**（可选字段，全部向后兼容）：`VfsError`、`SessionFsError`、`ProviderError`、`CloudSyncError`、`ProviderTableSnapshotError`、`ToolError`。构造参数放宽为 `string | CoreMessageDescriptor`，并加 `messageKey?` / `messageParams?`。统一解包：

```ts
// packages/core/src/i18n/localized-message.ts
export function resolveLocalizedMessage(input: string | CoreMessageDescriptor): {
  text: string;                        // 日志用：string 原样；descriptor 用 descriptor.key
  messageKey?: CoreMessageKey;
  messageParams?: MessageParams;
};
```

- **descriptor 形态下 `Error.message` 放 key 原文**（如 `error.vfs.not_found`）——稳定、可 grep、绝不是 `[object Object]`；`AppError` 例外，用英文 `desc`。
- **插值参数只取 `messageParams`，不再回落到 `details`**。`details` 是诊断字段，值可能是对象；`createTranslator` 对非 MessageLike 对象会 `String(value)`（`common/i18n.ts:41-44`、`:68`），直接塞进去会渲染成 `[object Object]`。迁移时把要插值的字段显式写进 descriptor 的 `params`。
- 不建基类、不搞 mixin：六个类各两行，解包函数有六个消费者，符合 nm-code-style 的「有稳定重复才抽象」。

**不需要字段的类**：`VfsZipError`、`PromptError`、`ConfigDecodeError`、`Either` 的错误（这些类当前没有用户可见中文文案，或由调用方以 AppError 承载）。

### 3.3 `userMessageOf`

```ts
// packages/core/src/i18n/error-message.ts
export function userMessageOf(error: unknown): CoreMessageDescriptor | null;
```

分派优先级（**先原因、后 code、最后放弃**）：

1. 错误自带 `messageKey` → 直接用（reason 级、方向级、调用方拼装的场景都走它）；
2. `ToolError` 且 `cause` 是 VfsError（或带 `messageKey` 的错误）→ **先解包 cause**，保持 `format-ipc-error.ts:99-107` 的现有行为（否则工具内 VFS 失败会从「文件不存在或已被删除」退化成工具码文案）；
3. 按类查 code 表（`VfsError` / `SessionFsError` / `ProviderError` / `CloudSyncError` / `ProviderTableSnapshotError` / `AppError`）；
4. 其它 → `null`，调用方回退到 `message`。

**code 表只覆盖用户可见子集，不做全量穷举**。全量 `satisfies` 是过度约束：`ErrorCodes` 有 82 个 key，其中 `INFRA_INVARIANT_VIOLATION` 与 `PROMPT_INVARIANT_VIOLATION` 属 E 桶；`ToolErrorCode` 主要进 LLM 通道；`VfsZipErrorCode` 无中文。全量 satisfies 会强迫为这些码写用户文案，把 255 的边界撑破。正确写法：

```ts
const USER_VISIBLE_PROVIDER_CODES = ["API_KEY_NOT_SET", "MODEL_NOT_SAVED", "SAVED_MODEL_IN_USE"] as const satisfies readonly ProviderErrorCode[];

const PROVIDER_CODE_TO_MESSAGE = {
  API_KEY_NOT_SET: "error.provider.api_key_not_set",
  MODEL_NOT_SAVED: "error.provider.model_not_saved",
  SAVED_MODEL_IN_USE: "error.provider.saved_model_in_use",
} as const satisfies Record<(typeof USER_VISIBLE_PROVIDER_CODES)[number], CoreMessageKey>;
```

- 子集数组由 G1/G2 逐个代码评审确认（每个 code 必须能追到用户可见的抛错点）。
- 不在子集里的 code → `userMessageOf` 返回 `null` → 回退 `message`（AppError 即英文 desc）。
- 需要方向/多入口区分的 code（`PUSH_MUTEX_TIMEOUT` 推/拉、`ROLLBACK_UNDO_SEND_EMPTY_TARGET` rewind/undo_send、`ROLLBACK_VFS_RESTORE_FAILED` 的 detail、`ProviderTableSnapshotError` 的 14 条原因）**一律在抛错点带 `messageKey`**，不靠 code 表猜。

### 3.4 wire / IPC 扩展

```ts
// apps/desktop/shared/ipc-types.ts:206-211
// CoreMessageKey / MessageParams 都从 shared/logic/core-i18n.ts 的 type 转发取（不直连 core，保持 X1）。
import type { CoreMessageKey, MessageParams } from "./logic/core-i18n.js";

export type IpcErrorPayload = {
  readonly code: string;
  readonly message: string;
  readonly messageKey?: CoreMessageKey;   // 跨包时可用 string，渲染层再收窄
  readonly params?: MessageParams;        // 必须与 MessageDescriptor.params 同型，不能是 Record<string, unknown>
  readonly missingLogicalPaths?: readonly string[];
};
```

`format-ipc-error.ts:84-124` 每个分支补：

```ts
const msg = userMessageOf(err);
return { code, message: err.message, ...(msg ? { messageKey: msg.key, params: msg.params } : {}) };
```

渲染层：

```ts
const text = payload.messageKey != null
  ? coreTranslator({ key: payload.messageKey as CoreMessageKey, params: payload.params })
  : payload.message;
```

`BootstrapStatusFailed`（`ipc-types.ts`）复用同一个 payload，启动错误自动获得本地化能力。

### 3.5 presentation 签名变更（破坏性，需与 G4 同批落地）

| 现状 | 改为 | 消费方（**全量**） |
| --- | --- | --- |
| `formatVfsErrorForUser(error, scope?): string`（`format-vfs-error-for-user.ts:40`） | `vfsUserMessage(error): CoreMessageDescriptor`（名字随返回值一起改，不留 wrapper） | `renderer/features/workspace/workspace-actions.ts`、`renderer/layout/PreviewPane.tsx`、`apps/mobile/src/errors/format-error.ts:50-67` |
| `validateVfsEntryName(name): {ok:false, reason: string}`（`validate-entry-name.ts:19,35-49`） | `reason: CoreMessageDescriptor` | `renderer/App.tsx`、`workspace-actions.ts`、`apps/mobile/src/components/vfs/vfs-file-manager/VfsPromptModal.tsx` |
| `formatStatusChipLabel` / `formatStatusChipLabelFromAttachment(...): string`（`presentation/chat/attachment-chip.ts`） | 返回 `CoreMessageDescriptor \| ""`（`label.attachment.chip` = `{action}:{path}`，action 为嵌套 descriptor）；**`userAttach` / `skillAttach` 的「返回空串」哨兵分支必须显式保留**，类型上写成 `\| ""`，不能用 `null` 也不能删分支 | desktop `features/chat/AttachmentDraftChips.tsx`、`MessageAttachmentGroupCard.tsx`；mobile `components/chat/AttachmentDraftChips.tsx`、`screens/tabs/chat-tab/ChatConversationPanel.tsx`；webview `runtime/render/row-logic.ts`；`public/chat.ts` |
| `STORED_CONFIG_LABELS`（9 条 string）与 `AGENT_LIST_LABELS`（3 条，其中 `maxSteps` 是函数 `(n)=>string`）（`stored-config-validity/labels.ts:22-39`） | 值改 descriptor；`maxSteps` 返回带 `{n}` 参数的 descriptor | desktop `AgentEditorView.tsx`、`SettingsViews.tsx`；mobile `AgentEditorInvalidCard.tsx`、`AgentEditorForm.tsx`、`AgentList.tsx` |
| `ruleStateLabel` / `inclusionModeLabel` / `displayStateLabel`（`workplace-labels.ts:9-35`） | 返回 descriptor；`filetreeMacroLoadStateLabel`（`:38-48`）**保持 string**（进提示词） | `renderer/features/workspace/vfs-tree-utils.ts`、`public/workplace.ts` |
| `buildStreamMetricsLine(metrics): string`（`format-stream-metrics-line.ts:38-50`） | 返回 descriptor，**4 个 key**：`label.stream_metrics.running`、`label.stream_metrics.last`、`label.stream_metrics.line`、`label.stream_metrics.line_with_rate` | 双端 `ChatStreamMetricsBar` |
| `formatTokenSourceBadge(...).mark`（`format-token-count.ts:24-27,57-66`） | `TokenSourceBadge.mark` 改为 `string \| CoreMessageDescriptor`（家族名保持 string，`远程` 变 descriptor）；main/mobile 各自翻译后再拼 `label`，wire 仍传 `label: string` | desktop main `chat-prompt-tokens.service.ts:176-177`；mobile `services/chat-prompt-tokens.service.ts` |
| `formatContextUsageLabel`（`format-token-count.ts:75`） | 保持接收已翻译的 `mark: string`（不引入 descriptor，避免纯数字格式被 i18n 传染） | 同上 |
| `TOKEN_COUNTER_MODE_SELECT_OPTIONS` / `THINKING_LEVEL_SELECT_OPTIONS`（`*-options.ts`） | 选项的 label 改 descriptor | desktop `ModelSamplingView.tsx`；mobile `ModelSamplingScreen.tsx` |

---

## 4. 分类基线表（108 文件，逐文件可核对）

列含义：A/B/C/D/E/X 为各桶处数，空白为 0。合计 581；A 187 / B 68 / C 172 / D 58 / E 86 / X 10。R3 复跑 census 总数与分组一致；行级分桶继承 R2 人工基线并经样本抽查吻合（本会话逐文件看过 §2.5 与 §5 涉及的全部代表文件的原始字面量）。

| 文件 | A | B | C | D | E | X |
| --- | --- | --- | --- | --- | --- | --- |
| `bootstrap/chat/chat-schema.ts` |  |  |  | 1 |  |  |
| `bootstrap/novel-master-bootstrap.ts` | 1 |  |  |  | 3 |  |
| `bootstrap/schema-migrations/index.ts` |  |  |  |  | 1 |  |
| `bootstrap/skills/seed-builtin-skills.ts` |  |  |  | 1 |  |  |
| `bootstrap/skills/skills-schema.ts` |  |  |  | 1 |  |  |
| `bootstrap/smart-sort-rule/builtin-smart-sort-rules.ts` |  |  |  | 22 |  |  |
| `bootstrap/usage/usage-record-schema.ts` |  |  |  | 1 |  |  |
| `common/error.ts` | 2 |  |  |  |  |  |
| `common/format-token-count.ts` |  | 1 |  |  |  |  |
| `common/release.ts` |  |  |  | 7 |  |  |
| `domain/agent/logic/validate-agent-definition.ts` | 4 |  |  |  |  |  |
| `domain/agent/model/agent-definition.schema.ts` | 3 |  |  |  |  |  |
| `domain/agent/stored-config-validity/labels.ts` |  | 12 |  |  |  |  |
| `domain/character-card/logic/character-card-to-md-tree.ts` | 10 |  |  | 4 |  |  |
| `domain/chat/logic/attachment/attach-budget.ts` |  |  | 2 |  |  |  |
| `domain/chat/logic/attachment/attachment-scanner.ts` | 1 |  |  |  |  |  |
| `domain/chat/logic/attachment/attachment-xml-codec.ts` |  |  | 2 |  |  |  |
| `domain/chat/logic/fork-copy-seeder.ts` |  |  |  |  | 1 |  |
| `domain/chat/logic/prompt/attachment-hydrator.ts` |  |  | 1 |  |  |  |
| `domain/chat/logic/resolve-chat-link-target.ts` |  | 1 |  |  |  |  |
| `domain/chat/logic/vfs-turn/user-vfs-turn-constants.ts` |  |  |  | 1 |  |  |
| `domain/chat/model/annotate-draft.schema.ts` | 4 |  |  |  |  |  |
| `domain/chat/model/composer-draft.schema.ts` | 1 |  |  |  |  |  |
| `domain/chat/model/message-attachment.schema.ts` | 3 |  |  |  |  |  |
| `domain/chat/model/project-agent-config.schema.ts` | 1 |  |  |  |  |  |
| `domain/chat/repositories/impl/sqlite-message.repository.ts` |  |  |  |  | 1 |  |
| `domain/format/format-stream-metrics-line.ts` |  | 3 |  |  |  |  |
| `domain/message-checkpoint/logic/backfill-baseline-checkpoints.ts` |  |  |  |  | 1 |  |
| `domain/message-checkpoint/logic/restore-path.ts` | 4 |  |  |  |  |  |
| `domain/message-checkpoint/logic/revive-deleted-entry.ts` | 3 |  |  |  |  |  |
| `domain/prompt/logic/expand-dynamic-macros.ts` | 1 |  |  |  |  |  |
| `domain/prompt/logic/normalize-agent-prompt-layout.ts` |  |  |  |  | 4 |  |
| `domain/prompt/logic/validate-agent-prompt-layout.ts` | 28 |  |  |  |  |  |
| `domain/prompt/logic/validate-dynamic-macros.ts` | 7 |  |  |  |  |  |
| `domain/prompt/model/agent-prompt-layout.ts` |  |  | 3 |  |  |  |
| `domain/provider/logic/provider-identity-repair.ts` |  |  |  |  | 6 |  |
| `domain/provider/model/thinking-level-options.ts` |  | 4 |  |  |  |  |
| `domain/provider/model/token-counter-mode-options.ts` |  | 6 |  |  |  |  |
| `domain/provider/repositories/impl/sqlite-provider.repository.ts` |  |  |  |  | 1 |  |
| `domain/skills/logic/build-new-skill-doc.ts` |  |  |  | 5 |  |  |
| `domain/skills/logic/parse-skill-front-matter.ts` | 4 |  |  |  |  |  |
| `domain/skills/model/skill-name.ts` | 6 |  |  |  |  |  |
| `domain/tool/builtin/agent-tool.ts` |  |  | 24 |  |  |  |
| `domain/tool/builtin/curl-tool.ts` |  |  | 24 |  | 1 |  |
| `domain/tool/builtin/overflow-sink.ts` |  |  | 1 |  | 1 |  |
| `domain/tool/builtin/search/engines/dispatch.ts` | 1 |  |  |  |  |  |
| `domain/tool/builtin/search/search-config.ts` | 4 |  |  |  |  |  |
| `domain/tool/builtin/search/search-tool.ts` |  |  | 11 |  | 1 |  |
| `domain/tool/builtin/skill-tool.ts` |  |  | 23 |  |  |  |
| `domain/tool/builtin/subagent-tool.ts` |  |  | 25 |  |  |  |
| `domain/tool/builtin/vfs-tools.ts` |  |  | 33 |  | 2 |  |
| `domain/tool/logic/build-tool-result-block.ts` |  |  | 5 |  |  |  |
| `domain/tool/logic/format-tool-output.ts` |  |  | 8 |  |  |  |
| `domain/vfs/content-store/impl/sqlite-vfs-content-store.ts` |  |  |  |  | 3 |  |
| `domain/vfs/content-store/logic/pack-codec.ts` |  |  |  |  | 12 |  |
| `domain/vfs/content-store/logic/resolve-stored-content.ts` |  |  |  |  | 1 |  |
| `domain/vfs/content-store/logic/zlib-accelerator.ts` |  |  |  |  | 2 |  |
| `domain/vfs/content-store/logic/zlib-codec.ts` |  |  |  |  | 5 |  |
| `domain/vfs/logic/entry-sequence-repair.ts` |  |  |  |  | 1 |  |
| `domain/vfs/logic/format-vfs-error-for-user.ts` | 5 |  |  |  |  |  |
| `domain/vfs/logic/revision-ref-count.ts` |  |  |  |  | 1 |  |
| `domain/vfs/logic/validate-entry-name.ts` | 4 |  |  |  |  |  |
| `domain/vfs/logic/vfs-path-mapper.ts` | 1 |  |  |  |  |  |
| `domain/vfs/logic/vfs-zip-path.ts` | 1 |  |  |  |  |  |
| `domain/vfs/repositories/impl/sqlite-vfs-entry.repository.ts` |  |  |  |  | 2 |  |
| `domain/vfs/repositories/impl/sqlite-vfs-revision.repository.ts` |  |  |  |  | 1 |  |
| `domain/workplace/logic/front-matter.ts` |  |  | 2 |  |  |  |
| `domain/workplace/logic/load-or-fill-file-cache.ts` |  |  | 1 |  |  |  |
| `domain/workplace/logic/smart-sort.ts` |  | 2 |  |  |  |  |
| `domain/workplace/logic/workplace-labels.ts` |  | 9 | 3 |  |  |  |
| `errors/either.ts` |  |  |  |  | 1 |  |
| `errors/session-fs-errors.ts` | 8 |  |  |  |  | 5 |
| `errors/skill-errors.ts` | 11 |  |  |  |  |  |
| `infra/cloud-sync/impl/cloud-sync-coordinator.ts` | 17 |  |  |  | 1 |  |
| `infra/cloud-sync/logic/push-agent-mutex.ts` |  |  |  |  | 1 |  |
| `infra/cloud-sync/model/cloud-sync-status.ts` | 1 |  |  |  |  |  |
| `infra/db-backup/provider-table-snapshot-validate.ts` | 14 |  |  |  |  |  |
| `infra/db-maintenance/impl/db-maintenance.service.ts` |  |  |  |  | 4 |  |
| `infra/sksp/logic/platform.ts` |  |  |  |  | 1 |  |
| `infra/tokenizer/logic/chunk-splitter.ts` |  |  |  | 12 |  |  |
| `infra/tokenizer/logic/incremental-token-counter.ts` |  |  |  |  | 2 |  |
| `infra/tokenizer/logic/prompt-whole-cache.ts` |  |  |  |  | 2 |  |
| `infra/tokenizer/logic/session-api-prompt-token-store.ts` |  |  |  |  | 3 |  |
| `infra/tokenizer/logic/token-chunk-cache.ts` |  |  |  |  | 2 |  |
| `presentation/chat/attachment-chip.ts` |  | 16 |  |  |  |  |
| `presentation/chat/user-vfs-turn-preview.ts` |  |  |  |  |  | 5 |
| `service/agent/default-subagent-definition.ts` |  |  | 2 |  |  |  |
| `service/agent/impl/agent-registry.service.ts` | 3 |  |  |  |  |  |
| `service/agent/impl/agent-runner.ts` |  |  |  | 2 |  |  |
| `service/agent/logic/agent-run-shared.ts` | 3 |  |  |  |  |  |
| `service/agent/logic/resolve-agent-for-project.ts` | 1 |  |  |  |  |  |
| `service/agent/logic/run-agent-turn.ts` | 5 |  |  |  |  |  |
| `service/chat/impl/message.service.ts` |  |  |  |  | 2 |  |
| `service/chat/impl/session.service.ts` | 1 |  |  |  |  |  |
| `service/chat/impl/usage-stats.service.ts` | 7 |  |  | 1 | 2 |  |
| `service/compaction-conditions/run-compaction.ts` |  |  |  |  | 1 |  |
| `service/coordinated-write.ts` |  |  |  |  | 5 |  |
| `service/integrity-repair.ts` |  |  |  |  | 4 |  |
| `service/message-checkpoint/impl/message-rollback.service.ts` | 2 |  |  |  | 1 |  |
| `service/prompt/prompt-preview-turns.ts` |  | 14 |  |  |  |  |
| `service/prompt/render-prompt.ts` |  |  | 2 |  |  |  |
| `service/provider/impl/provider.service.ts` | 3 |  |  |  |  |  |
| `service/skills/impl/skills.service.ts` | 5 |  |  |  |  |  |
| `service/vfs/impl/character-card-import.service.ts` | 5 |  |  |  |  |  |
| `service/vfs/impl/vfs-batch-io.service.ts` | 1 |  |  |  |  |  |
| `service/vfs/impl/vfs-zip-io.service.ts` | 1 |  |  |  |  |  |
| `service/vfs/logic/clear-session-prompt-caches.ts` |  |  |  |  | 1 |  |
| `service/vfs/logic/ensure-import-dir-rules.ts` |  |  |  |  | 2 |  |

混合文件的行级说明（复现时必须按此切分）：

- `domain/character-card/logic/character-card-to-md-tree.ts`：`:67/:71/:86/:94` 是生成文件名（D），其余 10 条是错误（A）。
- `domain/workplace/logic/workplace-labels.ts`：`:41/:43/:46` 是 `{{$filetree}}` 宏标签（C），其余 9 条是 UI 标签（B）。
- `errors/session-fs-errors.ts`：`:138/:228/:231/:232/:233` 是 X（删除），其余 8 条是 A。
- `infra/cloud-sync/impl/cloud-sync-coordinator.ts`：`:355` 是 `log.warn`（E），其余 17 条是 A。
- `service/chat/impl/usage-stats.service.ts`：`:291` 是 SQL（D）、`:538/:567` 是 `log.warn`（E），其余 7 条是 A。
- `service/message-checkpoint/impl/message-rollback.service.ts`：`:276` 是 `log.warn`（E），其余 2 条是 A。
- `domain/tool/builtin/{vfs-tools,curl-tool,search-tool}.ts`：`vfs-tools:433/473`、`curl-tool:385`、`search-tool:207` 是 `log.debug`（E）。
- `domain/tool/builtin/overflow-sink.ts`：`:82` 是 `log.warn`（E），`:88` 是工具结果提示（C）。
- `bootstrap/novel-master-bootstrap.ts`：`:249` 是启动错误（A），`:490/:504/:510` 是日志（E）。

---

## 5. 逐组任务

组间依赖：G0 → G1 → G2/G3 → G4 → G5。G2 与 G3 文件不重叠，可并行；G3 的签名变更必须与 G4 同批合并。

### G0 基础设施（无文案迁移）

| # | 动作 | 文件 | 验收 |
| --- | --- | --- | --- |
| 0.1 | 导出 `MessageParams` | `common/i18n.ts:23`、`common/index.ts` | typecheck 通过 |
| 0.2 | 建 key 模块：`ERROR_MESSAGE_KEYS` / `LABEL_MESSAGE_KEYS` / `CORE_MESSAGE_KEYS` / `CoreMessageKey` / `CoreMessageDescriptor` | `src/i18n/keys.ts`（新建） | 可被 `satisfies Record<…, CoreMessageKey>` 使用 |
| 0.3 | 建 `parseCoreCatalog`（yaml.parse + 展平 + 叶子 string + key 正则，全 throw 型校验）与单测（含 §1.5-3 探针行为的回归用例：半角冒号裸值、`true`/`123` 裸值、`on`、嵌套、`\n` 转义） | `src/i18n/catalog.ts`（新建） | 单测全绿；import 用 `import { parse } from "yaml"`（core 已有依赖，零新增） |
| 0.4 | 建 `userMessageOf`、`resolveLocalizedMessage` 与 code 子集表 | `src/i18n/error-message.ts`、`src/i18n/localized-message.ts`（新建） | 子集表用 `as const satisfies readonly Code[]`；映射表 `satisfies Record<子集元素, CoreMessageKey>` |
| 0.5 | 新子入口 + 测试路径链：`src/i18n/index.ts`、`src/public/i18n.ts`、`packages/core/package.json`（`"./i18n"` + `"./i18n/catalog/*"`，见 §2.1）、`packages/core/tsconfig.test.json` 的 `paths`、`test/package-exports/public-subpath-allowlist.test.ts:5` 的 `SUBPATHS`、`snapshots/public-i18n-allowlist.json`、`apps/mobile/jest.config.js` 的 `moduleNameMapper`（`^@novel-master/core/i18n$`）；复核 `.npmignore`/发布配置确保 `src/i18n/catalog/*.yaml` 随包 | 上述各处 | 缺任一处都会让 package-exports 测试退化成解析 dist（未 build 时 MODULE_NOT_FOUND）；以上位置全部补齐后 `npm test` 全绿 |
| 0.6 | 统计/防回归脚本 | `packages/core/scripts/check-i18n.mjs`、`packages/core/scripts/i18n-allowlist.json`（108 文件 × bucket × reason × 基线处数，含行级例外）、`package.json` 加 `"check-i18n"` | 脚本按 §1.1 的 census + 两条自动覆盖（log-call / invariant）复算；非 allowlist 文件出现 CJK 或 allowlist 处数超基线 → 退出码 1；`--report` 输出 A/B/C/D/E/X 汇总，必须等于 187/68/172/58/86/10 |
| 0.7 | catalog 骨架 + 校验测试 | `src/i18n/catalog/zh-CN.yaml`、`src/i18n/catalog/en-US.yaml`、`test/i18n/catalog.test.ts` | ① `parseCoreCatalog(读 zh-CN.yaml)` 展平后 key 集合 === `CORE_MESSAGE_KEYS`；② en-US 无多余 key；③ 同 key `{param}` 集合一致；④ 每个 key 匹配 §2.2 正则且域在词表内；⑤ **叶子全 string**（parse 层强校验，覆盖陷阱词/裸数字/裸布尔）；⑥ §2.6 静态扫描：源文本里不出现裸陷阱词/裸数字/裸布尔值（`#` 注释行除外）、缩进不含 Tab |
| 0.8 | 测试 helper | `test/helpers/core-i18n.ts` | node `fs.readFileSync` + `parseCoreCatalog`（不依赖任何 bundler 特性），导出 `tCore` |

### G1 错误底座 + 死代码清理（A 39 处 + X 10 处）

**前置（每个 A 文件都要过）**：先用 `node .agents/skills/nm-code-style/scripts/find-fake-exports.mjs packages/core/src/<dir>` + 生产调用点搜索确认「工厂/格式化函数有实际抛错点或 UI 消费」。零生产调用者的一律判死链删除（进 X 桶），**不要为死代码新建 `error.*` key**——这正是 `sessionFsRollbackNoCheckpoint` 和 `formatRollbackRevisionBackfillAlertMessage` 的教训。

| # | 文件 | 处数 | 动作 |
| --- | --- | --- | --- |
| 1.1 | `errors/app-error.ts` | — | 第二参放宽、`messageKey/messageParams`、`toJSON`；descriptor 时 `message = ErrorCodes[key].desc` |
| 1.2 | `errors/vfs-errors.ts`、`errors/session-fs-errors.ts`、`errors/provider-errors.ts`、`infra/cloud-sync/errors/cloud-sync-errors.ts`、`infra/db-backup/provider-table-snapshot-error.ts`、`errors/tool-errors.ts` | — | 加可选字段，用 `resolveLocalizedMessage`；descriptor 时 `message = key` |
| 1.3 | `errors/session-fs-errors.ts` | A 8 / X 5 | A：`ROLLBACK_MESSAGE_NOT_FOUND`、`ROLLBACK_MESSAGE_SESSION_MISMATCH`、`RESTORE_REVISION_MISSING`、`ROLLBACK_UNDO_SEND_EMPTY_TARGET`（按 mode 在工厂里带 key）、`ROLLBACK_VFS_RESTORE_FAILED`（调用方传 descriptor）、`ROLLBACK_REVISION_BACKFILL_REQUIRED`、`ROLLBACK_CONFLICT`、`ROLLBACK_TAIL_DRIFT`。X：删除 `sessionFsRollbackNoCheckpoint`（:134-142）与 `formatRollbackRevisionBackfillAlertMessage`（:218-234），同步删 `public/session-fs.ts` 的导出、public allowlist 快照、`core/test/message-checkpoint/rollback-revision-backfill.test.ts` 与 `apps/desktop/test/format-ipc-error.test.ts` 的用例（R3 复验：这些就是全部引用点）；Alert 文案复用 `packages/core/locales/chat.zh-CN.json` 的 `chat.rollback.confirm.backfill*` |
| 1.4 | `errors/skill-errors.ts` | 11 | 中文 message → descriptor；`reason` 参数允许嵌套 descriptor |
| 1.5 | `domain/vfs/logic/format-vfs-error-for-user.ts` | 5 | 改为 `vfsUserMessage` 返回 descriptor；硬编码表改 `VFS_CODE_TO_MESSAGE`（9 码） |
| 1.6 | `domain/vfs/logic/validate-entry-name.ts` | 4 | `reason` 改 descriptor；`assertValidVfsEntryName` 直接透传 |
| 1.7 | `domain/vfs/logic/vfs-path-mapper.ts`、`vfs-zip-path.ts` | 2 | |
| 1.8 | `domain/message-checkpoint/logic/restore-path.ts`、`revive-deleted-entry.ts` | 7 | 复用 session-fs 的 key |
| 1.9 | `common/error.ts` | 2 | YAML 错误 + `${fallback}：${message}` 拼接模板 |

验收：这 9 个文件的 A 桶处数归零；`check-i18n --report` 的 A 减 39、X 减 10（删除后基线同步下调）。

### G2 领域与业务错误（A 148 处）

同样先过 G1 的死链前置检查；A 桶里没有确认可达的抛错点就删，不建 key。

四个互不重叠的并行子组：

| 子组 | 文件（处数） | 小计 |
| --- | --- | --- |
| G2a agent / prompt | `validate-agent-definition` 4、`agent-definition.schema` 3、`validate-agent-prompt-layout` 28、`validate-dynamic-macros` 7、`expand-dynamic-macros` 1、`agent-registry.service` 3、`agent-run-shared` 3、`resolve-agent-for-project` 1、`run-agent-turn` 5、`session.service` 1 | 56 |
| G2b chat / skills / search / character-card | `annotate-draft.schema` 4、`composer-draft.schema` 1、`message-attachment.schema` 3、`project-agent-config.schema` 1、`attachment-scanner` 1、`parse-skill-front-matter` 4、`skill-name` 6、`skills.service` 5、`search-config` 4、`search/engines/dispatch` 1、`character-card-to-md-tree` 10 | 40 |
| G2c service / vfs / provider / usage | `provider.service` 3、`usage-stats.service` 7、`message-rollback.service` 2、`character-card-import.service` 5、`vfs-zip-io.service` 1、`vfs-batch-io.service` 1 | 19 |
| G2d infra / bootstrap | `cloud-sync-coordinator` 17、`cloud-sync-status` 1、`provider-table-snapshot-validate` 14、`novel-master-bootstrap:249` 1 | 33 |

组合型站点要显式处理嵌套 descriptor：

- `message-rollback.service.ts:98-106`：`detail` 取 `userMessageOf(cause) ?? cause.message`，再拼 `error.session_fs.vfs_restore_failed`（`{detail}` 可以是 descriptor 或字符串）。
- `vfs-batch-io.service.ts:339`：`batch ingest failed` 与「已提交 N 片」拆成 `error.vfs.batch_ingest_partial` + `{reason, committed, failedShard}`。
- `provider.service.ts`：`error.provider.saved_model_in_use` + `{modelName, blockingRefs}`，由抛错点带 key（code 表无法表达引用列表）。
- `provider-table-snapshot-validate.ts` 14 条：每条原因在抛错点带 key（4 个 code 不够区分列名/行号）。

验收：A 桶 148 处清零；每个抛错点要么带 descriptor，要么确认不可达 UI 并写进 PR 说明。

### G3 展示标签（B 68 处）

| # | 文件 | 处数 | 动作 |
| --- | --- | --- | --- |
| 3.1 | `domain/agent/stored-config-validity/labels.ts` | 12 | `STORED_CONFIG_LABELS` 9 条改 descriptor；`AGENT_LIST_LABELS` 3 条（`needsRepair` / `configInvalid` / `maxSteps(n)`）一并改；`maxSteps` 返回带 `{n}` 参数的 descriptor；`storedConfigInvalidReason` 返回 descriptor |
| 3.2 | `domain/workplace/logic/workplace-labels.ts` | 9 | 三个 UI label 函数返回 descriptor；`filetreeMacroLoadStateLabel` 保持 string |
| 3.3 | `domain/provider/model/thinking-level-options.ts`、`token-counter-mode-options.ts` | 10 | 选项表 label 改 descriptor |
| 3.4 | `presentation/chat/attachment-chip.ts` | 16 | 动作表改 descriptor；chip 模板 `{action}:{path}`；保留 `userAttach`/`skillAttach` 空串哨兵 |
| 3.5 | `service/prompt/prompt-preview-turns.ts` | 14 | `summaryText` / `metaText` 改 descriptor；**desktop 路径由 main 翻译后再写 string DTO**（见 G4.3），mobile 进程内直接翻译 |
| 3.6 | `domain/format/format-stream-metrics-line.ts` | 3 | 3 处字面量 → 4 个 key：`running` / `last` / `line` / `line_with_rate`（可选速率段拆成独立 key，不用空串拼） |
| 3.7 | `domain/workplace/logic/smart-sort.ts` | 2 | `(固定最小,)` / `(固定最大,)` |
| 3.8 | `common/format-token-count.ts` | 1 | `TokenSourceBadge.mark` 改 `string \| CoreMessageDescriptor` |
| 3.9 | `domain/chat/logic/resolve-chat-link-target.ts` | 1 | `不存在` 模板 |

### G4 应用侧接线

| # | 端 | 动作 |
| --- | --- | --- |
| 4.1 | desktop main | 新建 `apps/desktop/src/main/i18n/core.ts`：node `fs.readFileSync`（经 `@novel-master/core/i18n/catalog/<locale>.yaml` 子路径）+ `parseCoreCatalog`，启动一次建 `coreTranslator`；注册一次性 IPC `i18n:getCatalogs` 把 parse 好的 catalogs 对象发给 renderer；`format-ipc-error.ts:84-124` 填 `messageKey`/`params`（类型用 `MessageParams`）；`chat-prompt-tokens.service.ts:176-177` 用 translator 渲染 `mark` 后再拼 `label`；`prompt-preview-turns` 的 `summaryText/metaText` 在进 IPC 前由 main 翻译 |
| 4.2 | desktop shared | 新建 `shared/logic/core-i18n.ts`：具名再导出 `createTranslator`、`parseCoreCatalog`、`CoreMessageKey` 等类型（禁 `export *`、禁普通 `export * from core`；不 re-export YAML 文件本身——shared 跑在 main 与 renderer 两处，文件读取只在 main） |
| 4.3 | desktop renderer | 新建 `renderer/i18n/core.ts`：启动一次性 `i18n:getCatalogs` 拿对象 → `createTranslator`；改 `workspace-actions.ts`、`PreviewPane.tsx`、`App.tsx`、`AgentEditorView.tsx`、`SettingsViews.tsx`、`vfs-tree-utils.ts`、`AttachmentDraftChips.tsx`、`MessageAttachmentGroupCard.tsx`、`ModelSamplingView.tsx` 等调用点 |
| 4.4 | mobile | 新建 `apps/mobile/scripts/sync-core-catalog.mjs`：把 `packages/core/src/i18n/catalog/*.yaml` 拷到 `apps/mobile/android/app/src/main/assets/i18n/`（挂进 dev/start/打包前置 script）；新建 `src/i18n/core.ts`：启动一次 `blobFs().readFile(blobFs().asset('i18n/<locale>.yaml'), 'utf8')` + `parseCoreCatalog` → `createTranslator`；重写 `src/errors/format-error.ts` 走 `userMessageOf` + `coreTranslator`；改 `VfsPromptModal.tsx`、`VfsFileManager.tsx`、`AgentEditorInvalidCard.tsx`、`AgentEditorForm.tsx`、`AgentList.tsx`、`AttachmentDraftChips.tsx`、`ChatConversationPanel.tsx`、`ModelSamplingScreen.tsx`、`agent-editor-state.ts` |
| 4.5 | mobile webview | `scripts/build-webview.mjs` 构建期读 core YAML → `yaml.parse` → 生成 `runtime/i18n/catalog.generated.js`（内嵌 catalog 对象，生成物在 apps/mobile 侧，不经门 B）；新建 `runtime/i18n.ts` 建 translator；`createTranslator` 的 core dist 输入按先跑一次门 B 的实际 offenders 清单补 `WEBVIEW_CORE_ALLOWLIST`（`build-webview.mjs:399-407`；预期至少 `common/i18n.js`、`common/index.js`、`common/file.js`） |
| 4.6 | cli | 新建 `apps/cli/src/i18n.ts`：node fs + `parseCoreCatalog`；`sort-rule/commands.ts` 等打印点翻译 descriptor |
| 4.7 | 三端 + main | 统一按 `{ "zh-CN": ..., "en-US": ... }` 顺序构造 catalogs（localeRule 的对象键序约束） |

### G5 测试与防回归

| # | 动作 | 验收 |
| --- | --- | --- |
| 5.1 | 只改「断言用户可见文案」的核心测试（`test/vfs`、`test/message-checkpoint`、`test/service`、`test/cloud-sync`、`test/errors`、`test/prompt`）；改为断言 key 或经 `test/helpers/core-i18n.ts` 渲染 | `npm test`（core）全绿 |
| 5.2 | catalog 校验测试（0.7） | zh-CN 全量、en-US 无多余、占位符对齐、key 正则与域词表合法、叶子全 string、陷阱词静态扫描 |
| 5.3 | `check-i18n.mjs` 纳入收尾流程 | A/B 线性下降；C/D/E 只降不升（基线上限 172/58/86）；X 目标为 0（全删或复用既有 chat key，下降需在 allowlist diff 注明） |
| 5.4 | public 子入口快照（0.5） | package-exports 全绿；`tsconfig.test.json` 与 mobile jest 映射齐全 |
| 5.5 | nm-code-style 收尾 | `node .agents/skills/nm-code-style/scripts/check-style.mjs --all` 到 PASS |
| 5.6 | 文档 | 更新 `docs/public-api`（新子入口 `./i18n`）与 CHANGELOG |

### G6 后续（不在本轮，只登记）

- `en-US.yaml` 全量翻译（预计 ~200 条）。
- 应用自有文案：desktop main 105、desktop renderer 1102、desktop shared 65、mobile 1483、cli 8。
- 运行时语言切换 + locale 偏好键（需要重建 translator；main 也要收到 locale；renderer 的 IPC 取 catalog 要能重取）。
- seed 数据（内置智能排序规则的 name/description）与落库文本的本地化策略。
- 数字/日期格式化去 `zh-CN` 硬编码（`format-char-count.ts:3`、`infra/prompt-template/week-cn.ts`）。
- `chat.*.json`（JSON）与 `core.*.yaml`（YAML）合并为同一载体。
- mobile iOS 的 catalog bundle 读取路径（本轮只保 Android）。

---

## 6. 防回归设计

1. **`check-i18n.mjs`**：附录 A 的 AST 统计 + allowlist + 两条自动覆盖（log-call / invariant）。allowlist 条目形如
   ```json
   { "packages/core/src/infra/tokenizer/logic/chunk-splitter.ts": { "bucket": "D", "count": 12, "reason": "中文断句标点集，属数据" } }
   ```
   规则：非 allowlist 文件出现 CJK → fail；allowlist 文件处数 > 基线 → fail；`--report` 打印分桶统计。C/D/E/X 不会悄悄长，A/B 只能往下走。
2. **`parseCoreCatalog` 硬校验**：YAML 书写规范（§2.6）不是纸上约定——叶子非 string、key 不合法、结构非 mapping 都在加载即 throw。catalog 写坏最迟在测试/启动当轮失败。
3. **子集即契约**：`USER_VISIBLE_*_CODES` 用 `as const satisfies readonly Code[]`，映射表 `satisfies Record<子集元素, CoreMessageKey>`；漏一条编译不过，且不会强迫为 E/C 桶的码写文案。
4. **catalog 测试**：zh-CN 全量、en-US 无多余 key、同 key 占位符一致、key 正则 + 域词表、叶子全 string、陷阱词静态扫描。
5. **`check-style.mjs --all`**：迁移会制造新的单点/死引用（`formatVfsErrorForUser` 改名、`STORED_CONFIG_LABELS` 改形、session-fs 死函数删除），按 nm-code-style 收尾。
6. **public allowlist 快照**：新子入口必须登记，避免假公开；删除死函数同步删快照条目。
7. **门 B**：webview 侧 `createTranslator` 的 core dist 输入受 allowlist 门禁；catalog 本体构建期内嵌在 apps/mobile 生成物里，不引入 core 新输入——「新增 catalog 绕过检查」在 YAML 路线下结构上不可能。

---

## 7. 风险与未决

| 风险 | 说明 | 处置 |
| --- | --- | --- |
| 签名变更波及三端 | `vfsUserMessage`、`validateVfsEntryName`、`formatStatusChipLabel*`、`STORED_CONFIG_LABELS`/`AGENT_LIST_LABELS`、选项表都是 public 面 | G3+G4 同批；按 `find-fake-exports` 先撤不必要的 public |
| renderer 依赖 main 的 IPC 时序 | renderer 拿到 catalog 前不能翻译 core 文案 | 初始化序列里先 await `i18n:getCatalogs` 再渲染首屏；失败按启动错误处理（fail fast） |
| mobile 漏跑拷贝脚本 | assets 里没有 yaml → 启动 readFile 抛错 | 这是特性不是风险：错误信息里写明「跑 sync-core-catalog」；把脚本挂进 dev/start/打包前置 |
| YAML 写坏导致启动失败 | 半角冒号裸值是 parse 错误、裸布尔/数字被叶子校验拒绝 | fail fast 是有意为之；catalog 测试 + 静态陷阱词扫描在 CI 先拦 |
| desktop main 也要 locale | main 要翻译 token label 与 prompt preview summary；但 locale 偏好本轮不做 | 本轮固定 zh-CN；把 main 的 translator 做成可替换参数，G6 再接入 locale |
| webview 门 B 改动 | `createTranslator` 的 core dist 输入要补 allowlist，容易漏 | 先加 import 跑一次门 B（`build-webview.mjs:397-408`），按实际 offenders 清单补；把该流程写进 G4.5 |
| 测试中文断言量大 | 449 文件 / 377 含 CJK（R3 复跑） | 只改 A/B 相关断言，其余不动 |
| en-US 质量 | 机翻会污染产品 | 本轮只建骨架，翻译单列 G6 |
| 参数类型 | `MessageParams` 只允许 string/number/boolean/null/undefined/MessageLike/数组 | `IpcErrorPayload.params` 直接用它；禁止 `Record<string, unknown>` |
| 回退顺序依赖对象键序 | `common/i18n.ts:48` 用 `Object.keys().find` | 固定 `zh-CN` 在前；加注释与测试 |
| 宏/提示词文案被误迁 | `workplace-labels` 一半 UI 一半 prompt | 表已按行拆开（`:41/:43/:46` 归 C） |
| 未迁移路径回退到英文 desc | `AppError` 默认 message 是英文 | A 桶全部迁移后不可达；G2 验收要求逐条确认 |
| 发布包是否带 src yaml | package.json 无 `files` 字段，默认随包；但需防未来加 `files` 时漏掉 | G0.5 显式复核并加注释 |

---

## 8. 验收清单（本轮 Definition of Done）

- [ ] `check-i18n --report`：A=0、B=0；C/D/E 只降不升（基线上限 172/58/86）；X=0（死代码已删/复用）。
- [ ] A/B 的 50 个文件里**对应桶的处数为 0**（不是「文件里一个中文都没有」——`workplace-labels.ts` 还保留 3 条 C 桶宏标签）。
- [ ] `src/i18n/catalog/zh-CN.yaml` 经 `parseCoreCatalog` 展平后覆盖全部 `CORE_MESSAGE_KEYS`；`en-US.yaml` 无多余 key；key 正则、域词表、叶子全 string、陷阱词扫描全部通过（§2.6 是 catalog 的验收标准）。
- [ ] 五个宿主各有一次性加载入口：desktop main（fs+parse）、desktop renderer（IPC 拿对象）、mobile（assets + `fs.asset()` + parse）、webview（构建期内嵌）、cli / core 测试（fs+parse）；desktop renderer 未直连 `@novel-master/core`；所有 catalogs 按 `zh-CN` 在前的键序构造。
- [ ] `@novel-master/core/i18n` 子入口 + `"./i18n/catalog/*"` 数据子路径 + 快照 + `tsconfig.test.json` paths + mobile jest 映射齐全。
- [ ] core 来源的用户可见错误统一走 `userMessageOf`（desktop 经 IPC payload，mobile 进程内）；app 自有文案（`format-ipc-error.ts` 的 Zod 标签、`format-error.ts` 的 ProviderError 分支）明确不在本轮。
- [ ] 死代码已删：`sessionFsRollbackNoCheckpoint` / `formatRollbackRevisionBackfillAlertMessage` / `user-vfs-turn-preview`，public 快照同步。
- [ ] `npm run typecheck`、core `npm test`、`check-i18n`、`check-style --all` 全绿。

---

## 附录 A：统计与分类复现

### A.1 census（节点级）

```js
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = "packages/core/src";
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\u3000-\u303f\uff01-\uff60]/;

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.tsx?$/.test(e.name)) acc.push(p);
  }
  return acc;
}

const hits = [];
for (const file of walk(ROOT)) {
  const text = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  (function visit(node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node) || ts.isJsxText(node)) {
      if (CJK.test(node.getText(sf))) {
        hits.push({ file: path.relative(ROOT, file).replaceAll("\\", "/"), line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 });
      }
    }
    ts.forEachChild(node, visit);
  })(sf);
}
console.log("total", hits.length);
```

### A.2 bucket 归类（可执行的判定顺序）

对 `hits` 的每一条，按以下顺序定桶（与 `check-i18n.mjs` 同款）：

1. **人工基线**：若 `file:line` 命中 §4「混合文件的行级说明」→ 用该行说明的桶；否则用 §4 表里该文件的桶。
2. **自动覆盖（在人工基线之后执行，命中即改判）**：
   - 最近的外层 `CallExpression` 的 callee 匹配 `(^|\.)(log|logger)\.(debug|info|warn|error)$` 或 `^console\.(debug|info|warn|error|log)$` → **E**；
   - 最近的外层 `ThrowStatement` 文本含 `INVARIANT` → **E**。
3. **断言**：A 187、B 68、C 172、D 58、E 86、X 10，合计 581；同文件内命中多个桶时按 §4 表的行级说明切分。

`check-i18n.mjs` 在 G0 落成时把这套规则固化成 `i18n-allowlist.json`：每个文件一条 `{bucket, count, reason}`，行级例外单独一条 `{file, line, bucket, reason}`。

### A.3 测试侧统计

同一 census 把 `ROOT` 换成 `packages/core/test`：449 个 `.ts/.tsx`，377 个含 CJK；行含汉字口径 12588 行（R3 复跑；R2 的「汉字 + 全角标点」12694 行变体本轮未复跑，引用 R2）。

## 附录 B：catalog 片段示例（YAML，§2.6 规范的样板）

```yaml
# core 用户可见文案唯一真源。书写规范见 spec §2.6：
# - 值含半角 ": " 或形似数字/布尔 → 必须加引号（全角冒号不受影响）
# - on/off/yes/no/true/false 等陷阱词永不可作裸值
# - 缩进 2 空格；层级即 key；一 key 一行；多行文案用双引号 + \n
error:
  vfs:
    not_found: 文件不存在或已被删除。          # 全角标点/中文裸值安全
    invalid_name: 文件名不合法：{reason}       # {reason} 是嵌套 descriptor 参数
    invalid_name_dotdot: "文件名不能为 . 或 .."  # 值以空格结尾，顺手统一引号风格也行
    character_card_too_large: "角色卡过大：文件 \"{logical}\" 内容 {sizeBytes} 字节，超过单文件上限 {limitBytes} 字节"  # 值含半角冒号+空格 → 必须引号
  session_fs:
    rollback_message_not_found: 消息不存在：{messageId}
    rollback_tail_drift: 回滚期间待截断的消息集合发生变化（预期 {expectedCount} 条，实际 {actualCount} 条），已拒绝截断以免误删新消息，请重试
    revision_backfill_required: "快照丢失，将使用最新内容修复。\n\n丢失快照的文件：\n{fileLines}\n\n{tailLine}"  # 多行用双引号 + \n，不用 YAML 折行
  cloud_sync:
    push_mutex_timeout:
      push: 推送繁忙，等待互斥锁超时，请稍后再试
      pull: 拉取繁忙，等待互斥锁超时，请稍后再试
  agent:
    invalid_schema:
      name_required: definition.name 必填且为非空字符串（写在 definition 顶层；工具参数 name 仅用于定位，不能替代）
  skill:
    not_found_in_domain: 技能 {name} 在 {domain} 域不存在（文件 {path}）；{hint}
  db_backup:
    provider_row_id_missing: llm_provider 第 {rowIndex} 行缺少非空 id
label:
  agent:
    invalid_title: 配置已失效
    max_steps: 最大步数 {n}
  workplace:
    rule_on: 规则·开
  attachment:
    action:
      delete: 删除
    chip: "{action}:{path}"                   # 值含半角冒号 → 必须引号
  token_source:
    api: 远程
  stream_metrics:
    running: 生成中
    last: 上次生成
```

展平后即 `error.vfs.not_found`、`error.cloud_sync.push_mutex_timeout.push`、`label.attachment.chip` 等 dotted key，供 `createTranslator` 直接消费。

## 附录 C：域词表与 code 前缀映射

| code 前缀（`error-codes.ts:26-139`） | key 域段 |
| --- | --- |
| `AGENT_*` | `agent` |
| `VFS_*`（含 `VFS_CHARACTER_CARD_*` / `VFS_ZIP_*` / `VFS_CONTENT_*`） | `vfs`（子域并入 name：`character_card_…` / `zip_…` / `content_…`） |
| `CHAT_*` | `chat` |
| `TOOL_*` | `tool` |
| `PROVIDER_*` | `provider` |
| `SKILL_*` | `skill` |
| `COMPACTION_CONDITIONS_*` | `compaction` |
| `SMART_SORT_RULE_*` | `smart_sort_rule` |
| `PREFERENCES_*` | `preferences` |
| `INFRA_*` | `infra` |
| `FORMAT_*` | `format` |
| `KKV_*` | `kkv` |
| `DEPTH_*` | `depth` |
| `SESSION_FS_*` | `session_fs` |
| `PROMPT_*` | `prompt` |
| `WORKPLACE_*` | `workplace` |

`label` 域词表：`agent` `attachment` `chat` `provider` `workplace` `format` `token_source` `stream_metrics` `prompt_preview` `smart_sort`。

专用错误类的独立 code 表：`VfsErrorCode`（9）、`SessionFsErrorCode`（9，`ROLLBACK_NO_CHECKPOINT` 随死代码删除）、`ProviderErrorCode`（15，只取用户可见子集）、`CloudSyncErrorCode`（12）、`ProviderTableSnapshotErrorCode`（4）、`ToolErrorCode`（5，默认不进用户可见子集，只保留 cause 解包）、`VfsZipErrorCode`（8，无中文文案）。
