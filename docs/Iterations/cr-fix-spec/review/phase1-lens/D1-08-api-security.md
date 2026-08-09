# D1-08：API 稳定性 & 安全（L8 角度横扫）

> 角度横扫报告（readonly）。覆盖四个维度：源码公共面、包导出面、发版策略、安全性。
> 依据：`docs/review/guides/lens-L8-api-security.md`、`docs/review/phase0/D0-1-code-map.md`、`docs/review/phase0/D0-2-docs-index.md`、`docs/review/phase1-lens/D1-03-architecture.md`。
> 关键澄清：当前架构是「两层 facade」（顶层 `src/index.ts` + 13 个 `src/public/<ctx>.ts` barrel）。公共面审查以两层结构为准，不只看 `src/index.ts`。

## 元信息

- 角度：L8 API 稳定性 & 安全
- 仓库扫描范围：
  - 源码公共面：`packages/core/src/index.ts`（191 行，纯基础设施）
  - 包导出面：`packages/core/package.json` 的 `exports` 字段（24 个子路径）
  - 发版策略：`packages/*/package.json` + `apps/*/package.json` + `.github/workflows/release.yml` + `CHANGELOG.md`
  - 安全面：`packages/core/src/infra/{sksp,llm-protocol,sql-template,tdbc,nmtp}/`、`packages/core/src/domain/{vfs,tool,character-card,chat,provider,agent}/`、`packages/sksp-{mac,windows,android}/src/`
- 关键交叉文件：
  - `docs/review/phase0/D0-1-code-map.md` §2 分层违规扫描
  - `docs/review/phase1-lens/D1-03-architecture.md`（两层 facade 结论 + 包依赖图）
- 严重度参考：S/A/B/C（见指导文档 §严重度参考）
- 轮次：第 1 轮（无回派）
- 产出日期：2026-08-05

---

## 结论（叙述式）

诶～这一份扫下来，先要给指导文档做一个**重要更正**：它把「`src/index.ts` 只有 183 行 = 公共面太窄」当作预设前提，但 L3 报告已经实测确认，仓库现在是**两层 facade**——顶层 `src/index.ts` 只放纯基础设施（SQL template / TDBC / bootstrap / cloud-sync / 序列化 / tool 运行时），领域语境全靠 `src/public/<ctx>.ts` 的 13 个 barrel 配合 `@novel-master/core/<ctx>` 这种 subpath export 对外。apps 实测的 subpath 引用合计约 **407 次**（chat 93、vfs 54、provider 39、agent 38、workplace 31 …），所以「业务能力没出口」根本不是问题——业务能力的合同面就放在 `public/`。所以本报告的「公共面完整性」检查基准是：**顶层 `src/index.ts` + 13 个 `src/public/<ctx>.ts` 这两层加起来**，加上 `package.json` 里声明但**不在源码 facade 内**的那几个子路径（`./tdbc`、`./sksp`、`./nmtp`、`./kkv`、`./session-kkv`、`./config-forms*`）。后者才是真正可疑的地方。

整体看下来，**API 稳定性这边主要是「两层 facade 设计是好的，但 `exports` 字段没贯彻同一种原则」**。`exports` 24 个子路径里，有 13 个干净地走 `dist/public/`（与源码 facade 同构），但 5 个直接映射到 `dist/infra/` 或 `dist/service/`（绕开 facade 直接发布内部目录），还有 5 个走 `dist/config-forms/`（属于半 public 的配置层）。最值得拎出来的是 `./kkv` 和 `./session-kkv`——它俩映射到 `dist/service/{,session-}kkv/`，意味着消费者直接 import core 的 service 层实现，绕开了 `src/index.ts` 这个唯一顶层入口；而源码侧根本没有任何 barrel 复述这两个能力。这是包描述层和源码层的**公共面真分歧**。`./tdbc`、`./sksp`、`./nmtp` 虽然也映射到 `dist/infra/`，但它们在 infra 层有自带的 `index.ts`（端口 + 注册器 + 错误码），是有意识对外暴露的可插拔驱动协议，与 kkv 那种 service 层泄漏性质不同——前者算「设计选择」，后者算「封装性破坏」。

发版策略这边就明显落后于代码节奏了。core + 9 个 driver/sksp/cloud-sync 包 + cli 全部停在 `0.0.0`，唯独 desktop 和 mobile 是 `1.4.17`（指导文档写的是 1.4.16，实际已经涨到 1.4.17）。`0.0.0` 的包被 `1.4.17` 的包通过 workspace 链接消费——semver 在这里完全失效，因为 `0.0.0` 的语义就是「任意变更都是 breaking」。更麻烦的是 `.github/workflows/release.yml` 只发 mobile 的 APK 和 desktop 的 exe/dmg，core / driver / sksp 这一堆包**没有发版流程**，它们的 `package.json` 都有 `name` 字段、都没标 `private: true` 之外的保护（事实上全部都标了 `private: true`，所以 npm publish 也发不出去），但理论上的「已发布版本」和实际「被 workspace 消费的版本」是两套真相。`CHANGELOG.md` 存在但 release.yml 在 `publish-release` 步骤里 `awk` 提取 `## [${VERSION}]` 条目，没找到也只是输出一句 fallback 提示，没有硬性校验「发版前必须更新 CHANGELOG」。

安全面比想象中**干净得多**，是这份报告里最不慌的部分。SKSP（Secret Key Storage Protocol）三端实现都做到了**密钥不明文落盘**：macOS 走 Keychain 存 32 字节 master key，再用 AES-256-GCM 加密 plaintext 入 `sksp_secrets.ciphertext`（带 12 字节 IV + 16 字节 auth tag）；Windows 走 DPAPI `CurrentUser` 范围；Android 走 Keystore native 模块。SQL 注入面也稳——core 用自家的 MyBatis 风格 sql-template，`#{name}` 强制走绑定参数、`${name}` 文档明说「raw 字符串内联，调用方必须自校验」，全部业务 repo 都用 `#{}` 形态，没有任何 LLM 输入或用户配置直接进 `${}`。路径穿越防护也做到了正确：`normalizePath` 把 `..` 上跳检测掉，`vfs-zip-validate` 拒绝反斜杠、Windows 绝对路径、`projects/` 跨域前缀，还有 32MB / 5000 entry 的 zip bomb 防护。tool 系统每个 `ToolRunner.call` 都强制 `inputSchema.safeParse` + 可选 `outputSchema.safeParse`，agent 的 tool policy 也有 `validateAgentToolPolicy` 做 allow/deny 互斥校验。输入校验这块 zod 覆盖了大头（agentDefinition、projectAgentConfig、composerDraft、userOpsLog、messageAttachment 等），唯一一处走手动字段读取的是 character-card 解析（V2 spec 字段提取），不算危险但和仓库整体的 zod 风格不一致。

把 API 稳定性和安全性连起来看：仓库目前最大的 API 风险（`./kkv`、`./session-kkv` 暴露 service 层）**不是**直接的安全漏洞，但它把 service 层的实现细节变成了事实上的合同面——以后重构 service 内部就等于 breaking change，反向扩大了攻击面（消费者能 import 到的内部细节越多，越难做不破坏性变更的安全加固）。所以这两个维度虽然独立打分，结论却是同向的：**封装性破坏 = API 不稳定 ≈ 长期安全债务**。

---

## 一、源码公共面

### 公共面完整性核查（顶层 index.ts 维度）

顶层 `src/index.ts`（实测 191 行，比指导说的 183 行多了一段序列化导出）只放纯基础设施，不碰 domain 语境。下面这张表把顶层导出的每一类符号按「公共契约 / 内部泄漏」标一遍：

| 类别 | 来源文件 | 暴露符号 | 判定 | 备注 |
|------|---------|---------|------|------|
| `PACKAGE_NAME` 常量 | `src/index.ts:1` | `"@novel-master/core"` | 公共契约 | 消费者用来做 sksp ref / env 命名空间前缀，合理 |
| SQL Template | `infra/sql-template/index.js` | `SqlTemplateParser`、`parseTemplateToAst`、`evaluateTest` 等 + 类型 | 公共契约 | 自带 `@remarks` 明确警告 `${}` 的注入风险，文档完备 |
| TDBC | `infra/tdbc/index.js` | `open`、`registerDriver`、`executeTemplate`、`queryTemplate` 等 | 公共契约 | 可插拔驱动协议本就要对外 |
| Bootstrap | `bootstrap/novel-master-bootstrap.js` | `bootstrapNovelMaster`、`NOVEL_MASTER_SCHEMA_STATEMENTS`、`SCHEMA_BOOT_VERSION` | 公共契约 | 三端 app 启动期都需要 |
| DB Backup | `infra/db-backup/index.js` | `dumpProviderTableSnapshot`、`scrubProviderTables` 等 | 公共契约 | 导入导出流程的对外入口 |
| Cloud Sync | `infra/cloud-sync/index.js` | `CloudSyncCoordinator`、lease/lock 全家桶 | 公共契约 | 跨端同步的对外入口 |
| KKV Error / Preferences Error | `errors/kkv-errors.js`、`errors/preferences-errors.js` | `KkvError`、`PreferencesError` + 错误码 | 公共契约 | 错误类型暴露是必要的 |
| Persistent State / Preferences | `service/persistent-state/*`、`service/persistent-preferences/*` | `createPersistentState`、`createPersistentPreferences`、preference keys、workspace-state keys | **B 内部倾向** | 这是顶层 facade **唯一**直接暴露 service 层的地方，与「顶层只放基础设施」原则轻微冲突；但它只是 factory + 常量 keys，没有暴露 service 内部实现，可接受 |
| Tool 运行时 | `domain/tool/` | `ToolRegistry`、`ToolRunner`、`createVfsTools`、`registerBuiltinTools`、tool output limits 等 | 公共契约 | tool 被当成「跨语境基础设施」看待，是有意识的设计 |
| 序列化 | `infra/serialization/*` | `parseText`、`stringifyText`、`decode`、`encode` | 公共契约 | 跨端配置读写共用 |

**源码层结论**：顶层 `index.ts` 的导出**没有内部泄漏**——所有符号都属于基础设施层或被显式声明为「跨语境基础设施」的 tool 运行时。`createPersistentState` / `createPersistentPreferences` 这一处稍微擦边（service 层 factory 出现在顶层 facade），但它只暴露 factory 函数和常量 key，没有暴露 repo / port 实现细节，算「可接受的便利性导出」，不到 B 级。

### 公共面完整性核查（public barrel 维度）

13 个 `src/public/<ctx>.ts` 是领域语境的真正合同面。barrel 体量差距很大：

| barrel | 行数 | 暴露概况 | 判定 |
|--------|------|---------|------|
| `chat.ts` | 377 | chat model/schema/content/logic/service 全栈，含 composer-draft、annotate-highlight、annotate-source-range、user-ops-log、user-vfs-turn-view 等大量内部 logic | **B 公共面过宽** — 见 §源码公共面发现 1 |
| `provider.ts` | 163 | provider model/service/llm-protocol 入口 | 公共契约 |
| `vfs.ts` | 94 | vfs service factory + 路径映射 + zip 解析 | 公共契约 |
| `agent.ts` | 84 | agent definition / session / runner / doom-loop 检测 | 公共契约 |
| `workplace.ts` | 83 | workplace rule service | 公共契约 |
| `prompt.ts` | 52 | prompt 模板组装 | 公共契约 |
| `regex.ts` | 29 | regex rule schema/service | 公共契约 |
| `events.ts` | 46 | 事件配置 | 公共契约 |
| `compaction.ts` | 24 | 压缩条件 | 公共契约 |
| `session-fs.ts` | 22 | 会话级 fs（已退役成空壳，见 D1-03） | C 保留但实际无职责 |
| `message-checkpoint.ts` | 14 | checkpoint service factory | 公共契约 |
| `format.ts` | 6 | 文本格式化辅助 | 公共契约 |
| `feature-flags.ts` | 5 | feature flag 常量 | 公共契约 |

### 源码公共面发现

#### B（API）`src/public/chat.ts` 公共面过宽，含已声明 @deprecated 但未收回的导出

- 位置：`packages/core/src/public/chat.ts`（377 行）
- 问题：这个 barrel 几乎是 chat context 的全量 re-export。中段有一条直接注释：「净 diff 模块已退出 public；文件保留并标 `@deprecated`，仅供过渡期单测直接相对路径引用」——也就是说已经做过一轮瘦身但没收尾。同时 `agent.ts` 也有一处类似的 `@deprecated resolveApplicationModelId` 残留导出（标注「请改用 resolveSavedModelId」），说明 @deprecated-but-not-removed 是仓库的系统性习惯。
- 依据：D1-03 §3 god module 审查时已经把这条线索移交给 L8；`agent.ts` 第 17 行附近的 JSDoc `@deprecated 璇锋敼鐢?{@link resolveSavedModelId}` 即是一例。
- 建议：不要在 review 阶段动代码。后续整改方向是分两步走：先把 @deprecated 导出从 public barrel 移除（保留相对路径供过渡期单测），再评估 annotate-source-range / composer-at-path / user-ops-log 这一坨是否真的需要被 apps 直接 import，还是应该收敛成几个高层 API。
- 涉及角度：L3 架构（公共面边界）、L7 测试（@deprecated 但仍被测试引用）

---

## 二、包导出面

### exports 子路径逐项审计表

`packages/core/package.json` 的 `exports` 字段共 24 条（含 `.`），按映射目标分三种风格，逐个标注：

| # | 子路径 | 映射目标 | 路径风格 | 源码 facade 对应 | apps 实测消费 | 判定 |
|---|--------|---------|---------|----------------|-------------|------|
| 1 | `.` | `dist/index.js` | 顶层 facade | `src/index.ts` | 间接（经子路径） | 公共契约 |
| 2 | `./agent` | `dist/public/agent.js` | public | `src/public/agent.ts` | 38 次 | 公共契约 |
| 3 | `./chat` | `dist/public/chat.js` | public | `src/public/chat.ts` | 93 次 | 公共契约（但内容过宽见 §一） |
| 4 | `./compaction` | `dist/public/compaction.js` | public | `src/public/compaction.ts` | 11 次 | 公共契约 |
| 5 | `./events` | `dist/public/events.js` | public | `src/public/events.ts` | 26 次 | 公共契约 |
| 6 | `./feature-flags` | `dist/public/feature-flags.js` | public | `src/public/feature-flags.ts` | 7 次 | 公共契约 |
| 7 | `./prompt` | `dist/public/prompt.js` | public | `src/public/prompt.ts` | 18 次 | 公共契约 |
| 8 | `./provider` | `dist/public/provider.js` | public | `src/public/provider.ts` | 39 次 | 公共契约 |
| 9 | `./regex` | `dist/public/regex.js` | public | `src/public/regex.ts` | 15 次 | 公共契约 |
| 10 | `./message-checkpoint` | `dist/public/message-checkpoint.js` | public | `src/public/message-checkpoint.ts` | 8 次 | 公共契约 |
| 11 | `./session-fs` | `dist/public/session-fs.js` | public | `src/public/session-fs.ts` | 8 次 | 公共契约（barrel 已退役，见 D1-03） |
| 12 | `./vfs` | `dist/public/vfs.js` | public | `src/public/vfs.ts` | 54 次 | 公共契约 |
| 13 | `./workplace` | `dist/public/workplace.js` | public | `src/public/workplace.ts` | 31 次 | 公共契约 |
| 14 | `./format` | `dist/public/format.js` | public | `src/public/format.ts` | 5 次 | 公共契约 |
| 15 | `./tdbc` | `dist/infra/tdbc/index.js` | **infra** | infra 自带 `index.ts` | apps 0；sksp-* 包 17 次 | **B（设计选择）** — 可插拔驱动协议，自带 facade |
| 16 | `./sksp` | `dist/infra/sksp/index.js` | **infra** | infra 自带 `index.ts` | apps 5 次；sksp-* 包 13 次 | **B（设计选择）** — 同上 |
| 17 | `./nmtp` | `dist/infra/nmtp/index.js` | **infra** | infra 自带 `index.ts` | apps 0；tokenizer driver 包 3 次 | **B（设计选择）** — 同上 |
| 18 | `./kkv` | `dist/service/kkv/index.js` | **service** | service 自带 `index.ts` | apps 10 次 | **A 暴露内部层** |
| 19 | `./session-kkv` | `dist/service/session-kkv/index.js` | **service** | service 自带 `index.ts` | apps 6 次 | **A 暴露内部层** |
| 20 | `./config-forms` | `dist/config-forms/index.js` | config-forms | 自带 `index.ts` | apps 0；packages 0 | **B（无人消费）** |
| 21 | `./config-forms/agent` | `dist/config-forms/agent/index.js` | config-forms | 自带 | apps 8 次 | 公共契约 |
| 22 | `./config-forms/events` | `dist/config-forms/events/index.js` | config-forms | 自带 | apps 7 次 | 公共契约 |
| 23 | `./config-forms/shared` | `dist/config-forms/shared/index.js` | config-forms | 自带 | apps 5 次 | 公共契约 |
| 24 | `./config-forms/stored-config-validity` | `dist/config-forms/stored-config-validity/index.js` | config-forms | 自带 | apps 14 次 | 公共契约 |

**判定原则**：
- 映射到 `dist/public/`：源码 facade 与包描述同构，是干净的合同面
- 映射到 `dist/infra/`：暴露 infra 内部目录，但 tdbc / sksp / nmtp 这三个 infra 子模块**本身就是可插拔驱动的端口**（自带 `index.ts`、注册器、错误码、port 接口），是有意识的对外面——算「设计选择」而非「泄漏」，定 B
- 映射到 `dist/service/`：kkv / session-kkv 直接发布 service 层实现目录，**没有任何源码 barrel 复述**，是真正的封装性破坏，定 A

实测数据来自 `Get-ChildItem apps -Recurse` + 正则 `from ['"]@novel-master/core/([^'"]+)['"]` 全量统计（排除 node_modules、`.appium`、`dist`），apps 端总计约 **407 次** subpath import，与 L3 报告数字一致。

### 包导出面发现

#### A（API）`./kkv` 与 `./session-kkv` 直接暴露 service 层实现目录

- 位置：`packages/core/package.json` 第 77–84 行；映射目标 `dist/service/kkv/index.js` 与 `dist/service/session-kkv/index.js`
- 问题：这两个子路径绕开了源码层的两层 facade（顶层 `src/index.ts` 不碰 kkv；`src/public/` 也没有 `kkv.ts` barrel），直接把 service 层的 `index.ts` 当成对外合同面。消费者（apps 共 16 次 import）拿到的是 service 层的实现细节而不是稳定的 API 契约。
- 依据：D1-03 §5 已经确认源码 facade 是两层结构，core 的 service 层不该是直接对外面。这里 `exports` 字段和 `src/public/` 设计出现了真分歧。
- 建议：后续整改时二选一——要么把 kkv / session-kkv 的稳定符号收敛进 `src/public/kkv.ts` barrel，让 exports 改指向 `dist/public/kkv.js`；要么承认它们是 service 层公共面，在 `ARCHITECTURE.md` 里 explicitly documented。
- 涉及角度：L3 架构（service 层封装边界）、L4 错误处理（KkvError 的对外契约）

#### B（API）三种路径风格混用，缺少一致的 exports 设计原则

- 位置：`packages/core/package.json` 整段 exports
- 问题：24 个子路径里混了 `./public/*`、`./infra/*`、`./service/*`、`./config-forms/*` 四种映射目标，没有注释解释为什么 kkv 走 service 而 chat 走 public。这种风格混用会让新加入的开发者无法判断「我新增的 context 应该走哪种映射」。
- 依据：指导文档 §包导出面设计明确把「三种路径风格混用」列为典型问题。
- 建议：后续在 `ARCHITECTURE.md` 或 `packages/core/README.md` 加一节「public face convention」，明确：domain context 一律走 `dist/public/<ctx>.js`、infra 端口协议走 `dist/infra/<cap>/index.js`、service 层原则上不直接 export。
- 涉及角度：L3 架构、L10 工程化

#### B（API）`./config-forms` 根路径在 apps / packages 中零消费

- 位置：`packages/core/package.json` 第 85–88 行
- 问题：`./config-forms`（不带子路径）映射到 `dist/config-forms/index.js`，实测 apps 和 packages 都没人 import 它——消费者只走 `./config-forms/agent`、`./config-forms/events`、`./config-forms/shared`、`./config-forms/stored-config-validity` 这四个细分路径。
- 依据：见上面审计表 #20。
- 建议：检查 `config-forms/index.ts` 是否其实只 re-export 了一些 labels/types；如果是，要么把它显式标 deprecated 让消费者走子路径，要么从 exports 删掉。属于契约噪音，不到 A。
- 涉及角度：L3 架构

#### B（API）`./tdbc` / `./sksp` / `./nmtp` 映射到 `dist/infra/` 但语义合理

- 位置：`packages/core/package.json` 第 65–76 行
- 问题：这三个子路径绕开了顶层 facade 直接发布 infra 子目录。但与 kkv 不同，tdbc / sksp / nmtp 是**显式的可插拔驱动协议**——每个 infra 子模块自带 `index.ts` 只导出 port 接口 + 注册器 + 错误码 + 端口类型，不暴露内部 logic / impl 细节。sksp-* 和 driver 包通过这三个子路径注册自己的驱动实现，这是设计意图。
- 依据：实测 `infra/tdbc/index.ts`、`infra/sksp/index.ts`、`infra/nmtp/index.ts` 都只导出 port + registry + error，没有 impl/* 的内部泄漏。
- 建议：保留，但在文档里明确这是「驱动协议对外面」的合法例外。
- 涉及角度：L3 架构

---

## 三、发版策略

### 版本号对照表

实测所有包的 `version` 字段（指导文档说 desktop/mobile 是 1.4.16，实际已涨到 1.4.17）：

| 包 | version | private | 发版流程 | 角色定位 |
|----|---------|---------|---------|---------|
| `@novel-master/core` | **0.0.0** | true | 无 | 被所有 app 和 driver 消费的内核 |
| `@novel-master/cli` | **0.0.0** | true | 无 | CLI 应用 |
| `@novel-master/desktop` | **1.4.17** | true | release.yml 发 win/mac | Electron 桌面应用 |
| `@novel-master/mobile` | **1.4.17** | true | release.yml 发 Android APK | React Native 移动应用 |
| `@novel-master/cloud-sync-driver-s3` | **0.0.0** | true | 无 | 云同步驱动 |
| `@novel-master/sksp-android` | **0.0.0** | true | 无 | Android Keystore 驱动 |
| `@novel-master/sksp-mac` | **0.0.0** | true | 无 | macOS Keychain 驱动 |
| `@novel-master/sksp-windows` | **0.0.0** | true | 无 | Windows DPAPI 驱动 |
| `@novel-master/tdbc-conformance` | **0.0.0** | true | 无 | TDBC 一致性测试套件 |
| `@novel-master/tdbc-driver-better-sqlite3` | **0.0.0** | true | 无 | Node SQLite 驱动 |
| `@novel-master/tdbc-driver-rn` | **0.0.0** | true | 无 | React Native SQLite 驱动 |
| `@novel-master/tokenizer-driver-node` | **0.0.0** | true | 无 | Node tokenizer 驱动 |
| `@novel-master/tokenizer-driver-rn` | **0.0.0** | true | 无 | React Native tokenizer 驱动 |

补充事实：所有包都标了 `private: true`，所以 npm publish 实际上发不出去——这降低了「0.0.0 但被发布」的 semver 风险，但 monorepo workspace 内部消费的版本语义仍然矛盾。

### 发版策略发现

#### A（API）core / driver / sksp 包全部停在 0.0.0 被 1.4.17 的 app 消费，semver 语义自相矛盾

- 位置：`packages/core/package.json:3`、`packages/sksp-*/package.json`、`packages/tdbc-driver-*/package.json`、`apps/desktop/package.json:3`、`apps/mobile/package.json`
- 问题：core 和 9 个 driver / sksp 包全是 `0.0.0`，按 semver 规范这意味着「任意变更都是 breaking」。desktop / mobile 是 `1.4.17`，通过 workspace `*` 链接消费 core。这意味着：从版本号角度，core 的任何一次 commit（包括改一个内部注释）都是 breaking change；而 desktop / mobile 之间的版本协调却走的是相对严格的 1.x semver。两套版本语义在同一个 monorepo 里并存，是真正的语义错位。
- 依据：见上表 + 指导文档 §发版策略一致性 §30–34。
- 建议：要么承认 core / driver / sksp 是 monorepo 内部产物（统一锁 `0.0.0` + workspace `*`，文档里明确「这些包不会独立发布」）；要么真把它们做成独立可发布的包，给一个真实版本号（哪怕 0.1.0）。当前的中间状态最糟糕——既享受了 `private: true` 的不发版便利，又保留了 `name` 字段带来的「理论上可发版」错觉。
- 涉及角度：L3 架构（包依赖图）、L10 工程化

#### B（API）release.yml 只发 mobile 和 desktop，core / driver / sksp 无发版流程

- 位置：`.github/workflows/release.yml`
- 问题：release.yml 的 jobs 只有 `resolve-version`、`android-release`、`desktop-windows`、`desktop-macos`、`publish-release` 五个，没有任何 core / driver / sksp 包的 publish 步骤。这些包的 `package.json` 都有 `name` 字段，理论上可以发，但实际没有流程。
- 依据：实测 release.yml 全文（已在概览中读完），确认 jobs 范围。
- 建议：如果这些包永远只在 workspace 内部用，应该在 `ARCHITECTURE.md` 或 `CONTRIBUTING.md` 写明「workspace-internal only」；如果未来要发，需要新增独立的 publish workflow。
- 涉及角度：L10 工程化

#### B（API）CHANGELOG 校验是软提示而非硬门槛

- 位置：`.github/workflows/release.yml` 的 `publish-release` job 里 `Compose release notes` 步骤
- 问题：脚本用 `awk` 在 `CHANGELOG.md` 里提取 `## [${VERSION}]` 条目，找不到时只输出一句 fallback「未在 CHANGELOG.md 中找到 ## [x.y.z] 条目，请在发版前补充」——没有让 release 失败。这意味着发版产物可以不带 changelog 上线。
- 依据：release.yml 第 ~290 行附近的 `extract_changelog_section` + `if [ -n "${CHANGELOG_BODY}" ]; then ... else ... fallback ...` 逻辑。
- 建议：把 fallback 分支改成 `exit 1`（或者至少 `::warning::`），强制发版前 CHANGELOG 必须更新。这是 release 工程化的常规护栏。
- 涉及角度：L10 工程化

#### C（API）apps/cli 与 desktop / mobile 版本节奏脱节

- 位置：`apps/cli/package.json`
- 问题：cli 停在 `0.0.0`，desktop / mobile 是 `1.4.17`——同一仓库的三个 app 走了三套版本节奏（cli 不发版，desktop/mobile 跟 tag 走）。
- 依据：见版本对照表。
- 建议：明确 cli 是不是「实验性 / 内部工具」。如果是，文档里写明；如果不是，应该跟随主版本节奏。
- 涉及角度：L10 工程化

---

## 四、安全性

### 安全风险矩阵

下面这张矩阵按「入口点 × 风险类型」交叉评估当前防护水平。✅ = 有明确防护且实现合理；⚠️ = 有防护但不完整或不一致；❌ = 无防护；N/A = 该入口不涉及该风险。

| 入口点 \ 风险 | SQL 注入 | 路径穿越 | 密钥泄漏 | 越权访问 | 输入校验 | 代码/正则注入 |
|--------------|---------|---------|---------|---------|---------|--------------|
| **用户配置加载**（agent / events / regex） | ✅ zod schema + `#{}` 绑定 | N/A | ⚠️ 见 §4.3 | N/A | ✅ `decode()` + zod | N/A |
| **LLM 返回解析**（SSE / tool args） | ✅ 不直接进 SQL | N/A | ✅ `redactHeaders` + `redactUrl` | ✅ tool input schema 校验 | ⚠️ 见 §4.5 | ✅ tool args 走 `JSON.parse` + schema |
| **vfs 文件操作**（service / batch / zip） | ✅ 全部 `#{}` 绑定 | ✅ `normalizePath` + `vfs-zip-validate` 拒绝 `..`/`\`/windows abs/`projects/` 前缀 | N/A | ✅ scope key 隔离 + `assertLogicalPathAllowed` | ✅ zip 大小/数量上限 | N/A |
| **agent tool 调用** | ✅ 不直接进 SQL | ✅ tool input schema 限制 path | N/A | ⚠️ 见 §4.6 | ✅ `ToolRunner.call` 强制 `safeParse` | N/A |
| **character-card 导入** | ✅ 不进 SQL（只 vfs write） | ✅ 走 vfs 路径校验 | N/A | N/A | ⚠️ 见 §4.5 | ✅ PNG magic + tEXt/chara 提取 |
| **SKSP 密钥存储**（三端） | ✅ `#{}` 绑定 | N/A | ✅ macOS AES-GCM + Keychain、Win DPAPI、Android Keystore | N/A | ✅ `assertValidRef` | N/A |
| **LLM HTTP 请求**（openai/anthropic/gemini） | N/A | N/A | ✅ Authorization/X-Api-Key 走 header；debug-fetch 有 redact | N/A | N/A | N/A |
| **schema migration 脚本** | ⚠️ 见 §4.2 | N/A | N/A | N/A | N/A | N/A |

### 安全发现

#### S/A/B 级安全发现总览

先给一张总表，便于交叉，逐条细节在后面展开：

| # | 严重度 | 标题 | 位置 |
|---|-------|------|------|
| 4.1 | ✅（无问题） | SKSP 三端密钥存储实现正确，无明文落盘 | `packages/sksp-{mac,windows,android}/src/` + `packages/core/src/infra/sksp/` |
| 4.2 | **B** | schema migration 里少量 `${table}` JS 模板字符串拼接（非 sql-template `${}`） | `bootstrap/schema-migrations/*.ts` 共 4 处 |
| 4.3 | **B** | env 覆盖层让 SKSP 密钥可经环境变量旁路 DB | `infra/sksp/impl/env-secret-store.ts` + `composite-secret-store.ts` |
| 4.4 | ✅ | SQL template 的 `${}` raw 内联语法本身是设计，业务侧全部用 `#{}` | `infra/sql-template/placeholder.ts` |
| 4.5 | **B** | character-card JSON 解析走手动字段读取而非 zod | `domain/character-card/logic/parse-character-card-json.ts` |
| 4.6 | **A** | agent tool policy 只做 allow/deny 名单校验，没有路径白名单 / 资源配额 | `domain/agent/logic/validate-agent-tool-policy.ts` |
| 4.7 | ✅ | vfs 路径穿越防护完备，含 zip bomb 上限 | `domain/vfs/repositories/impl/normalize-path.ts` + `domain/vfs/logic/vfs-zip-validate.ts` |
| 4.8 | ✅ | LLM HTTP debug-fetch 有 header / URL 脱敏 | `infra/llm-protocol/logic/debug-fetch.ts` |

#### 4.1 SKSP 三端密钥存储：实现正确，无明文落盘

- 位置：`packages/sksp-mac/src/{sqlite-secret-store,crypto,keychain}.ts`、`packages/sksp-windows/src/{sqlite-secret-store,dpapi}.ts`、`packages/sksp-android/src/android-secret-store.ts`
- 核查结论：
  - **macOS**：master key 32 字节随机，存 macOS Keychain（service=`novel-master`, user=`sksp-master-v1`），首次使用自动创建；plaintext 走 AES-256-GCM（12 字节 IV + 16 字节 auth tag）后入 `sksp_secrets.ciphertext`/`iv` 列；`algo` 列钉死 `macos-keychain-aes-gcm-v1`，跨设备恢复会拿到不匹配的 algo 然后抛 `DECRYPT_FAILED`，错误处理路径都覆盖到了
  - **Windows**：DPAPI `CurrentUser` 范围加密，ciphertext 入 BLOB 列，`iv` 为 NULL（DPAPI 自己管 IV）；非 Windows 平台直接抛 `ENCRYPT_FAILED`，没有降级到明文
  - **Android**：走 Keystore native 模块（`getSkspNativeModule().encrypt/decrypt`），ciphertext/iv 都以 base64 文本入表（注释里写明「quick-sqlite heap corruption on free」所以避开了 BLOB bind）
  - 三端共享同一张 `sksp_secrets` 表，`algo` 列区分实现；`assertValidRef` 在所有 set/get/delete 入口都先校验 ref 格式
- 判定：**✅ 无问题**——这是仓库里安全实现质量最高的子系统之一。错误消息里只出现 ref（如 `DPAPI decrypt failed for ${ref}`），不出现 plaintext / master key。
- 备注：`setMacKeychainTestPassthrough` / `setDpapiTestPassthrough` 是测试 hook（标了 `@internal`），只在非 native 平台的单测里启用，生产路径不会触发。

#### 4.2 schema migration 中 `${table}` JS 模板字符串拼接（B）

- 位置：
  - `bootstrap/schema-migrations/provider-identity-v1.ts:57` `` `SELECT name FROM pragma_table_info('${table}')` ``
  - `bootstrap/schema-migrations/drop-chat-session-user-vfs-pending-v1.ts:20` 同上
  - `bootstrap/schema-migrations/session-agent-config-v2.ts:24` `` `PRAGMA table_info(${table})` ``
  - `bootstrap/schema-migrations/vfs-content-blob-zlib-v1.ts:96-101` 几处 `${hasHead ? "head_version" : "version"}` 之类的字面量三元
- 问题：这几处是 **JS 模板字符串直接拼成 SQL 字符串**，再丢给 `tx.query` / `tx.execute`，**不走** sql-template 的参数绑定。也就是说，如果 `table` 来自外部可控值，就是 SQL 注入。
- 实测：抽查所有调用点，`table` 全部是**调用方硬编码的字面量**（如 `"chat_session"`、`"vfs_revision"`），三元表达式也都是布尔开关选字面量字符串。**实际不可达**。
- 判定：**B**——不是真正的注入漏洞（输入不可控），但属于「绕过了 sql-template 安全机制的特例」，未来如果有人复用 `getTableColumns` 模式传外部值就会出问题。这种特例应该集中收敛到一个 helper，并在 helper 上写明「仅限 hardcoded 表名」。
- 建议：后续整改时把 `getTableColumns` / `pragma_table_info` 调用统一进一个带白名单的 helper（如 `KNOWN_TABLES` 常量集合），把 `${table}` 改成查表 + 字面量 throw。
- 涉及角度：L1 数据模型（迁移脚本）、L4 错误处理

#### 4.3 SKSP env 覆盖层让密钥可经环境变量旁路 DB（B）

- 位置：`packages/core/src/infra/sksp/impl/env-secret-store.ts` + `composite-secret-store.ts`
- 问题：SKSP 读取顺序是 `env > DB > null`，写入只写 DB 不动 env。设计意图是给 CI / 脚本场景一个无 native 依赖的注入面（`NOVEL_MASTER_PROVIDER_<ID>_API_KEY`）。但产品决策上：在 DB 已经存了 apiKey 之后，shell 环境变量仍可覆盖实际请求所用的密钥——这意味着**任何能改 process.env 的进程内代码都能让用户在 UI 里设置的 apiKey 失效**。
- 缓解：`index.ts` 注释里明说「CLI/Desktop 可设 `NM_SKSP_DISABLE_ENV=1` 关闭 env 层以降低信任面」「Mobile 生产运行时 composite 不传 env store」——所以**移动端是默认安全的**，问题集中在 CLI/Desktop 的默认配置。
- 判定：**B**——不是密钥明文落盘（env 是用户主动设的），但是信任边界设计偏宽。如果 desktop 应用默认不关 env，恶意父进程或注入脚本可以替换密钥。
- 建议：后续考虑把 desktop 默认也设成 `NM_SKSP_DISABLE_ENV=1`（或者只在 dev 模式开 env 层）。
- 涉及角度：L6 跨端（三端 env 策略不一致）

#### 4.4 SQL template `${}` raw 内联：设计有据，业务侧未滥用（✅）

- 位置：`packages/core/src/infra/sql-template/placeholder.ts`
- 实现：`renderBind` 对 `kind === "hash"` 走绑定参数（`{fragment: placeholder, parameters: [value]}`），对 `kind === "dollar"` 走 `String(value)` 直接拼进 SQL fragment 且不加进 parameters。
- 文档：`SqlTemplateParser.parse` 的 JSDoc 明确写「`${name}` placeholders are interpolated as raw strings into the output SQL and are **not** added to `parameters`. Only use `${...}` with trusted, validated values (for example fixed column names from an allow-list). Untrusted input in `${...}` can cause SQL injection. Prefer `#{name}` for user-supplied values.」
- 实测：grep `packages/core/src` 里所有 `.ts` 文件中 `${[a-zA-Z_]` 的 SQL 模板，业务 repo 侧没有把 LLM 返回 / 用户输入 / vfs 文件内容塞进 `${}`——`#{}` 是默认形态。
- 判定：**✅ 无问题**——危险能力存在但有充分文档 + 业务侧守纪律。属于「好的危险 API 设计」样本。

#### 4.5 character-card 解析走手动字段读取而非 zod（B）

- 位置：`packages/core/src/domain/character-card/logic/parse-character-card-json.ts`
- 问题：`normalizeCharacterCardJson` 用 `asRecord` + `typeof === "string"` 一系列手动 type guard 读取 `description` / `first_mes` / `alternate_greetings` / `character_book.entries` 字段，没用 zod schema。功能上没问题（每个字段都做了类型检查），但和仓库其他入口（agentDefinitionSchema、projectAgentConfigSchema、composerDraftSchema、userOpsLogEntrySchema 等全部 zod）风格不一致。
- 风险：未来扩字段时容易漏掉类型检查（手动 type guard 比 zod schema 更容易写漏 `unknown` 残留）。
- 判定：**B**——不是当前的输入校验漏洞（实现是正确的），是「校验风格不一致」的代码味道。
- 建议：后续把 character-card V2 spec 抽成 zod schema，统一仓库的输入校验风格。
- 涉及角度：L1 数据模型

#### 4.6 agent tool policy 缺路径白名单与资源配额（A）

- 位置：`packages/core/src/domain/agent/logic/validate-agent-tool-policy.ts`
- 问题：`validateAgentToolPolicy` 只校验 `tools.allow` / `tools.deny` 互斥 + 名单在 registry 内，**没有任何路径维度的白名单**。也就是说，agent 一旦被允许用 `write` / `edit` / `fs` 这类 mutating tool，就能写vfs 任意 scope（global / project / session）任意路径，包括 `/template/` 这种全局模板目录。
- 缓解（不构成完整防御）：vfs 路径层有 `normalizePath` 拒 `..`，scope_key 做了 project/session 隔离，所以 agent 跨 project 写不了——但**同一 project 内 agent 能写到用户没打算让它碰的子树**（比如把 `/system-prompts/` 覆盖掉）。
- 另一个相关点：`ToolRunner.runParallel` 默认并发 8，且 `extractMutatingPaths` 做了同 path 串行化，但**没有跨 tool 调用次数 / 总字节 / 总文件数的配额**——agent 可以在 doom-loop 阈值之内做大量 IO。
- 判定：**A**——agent 越权风险存在于「同一 project 内任意子树写入」+「无资源配额」。考虑到 agent 由 LLM 驱动，且 doom-loop 检测（`DOOM_LOOP_THRESHOLD` / `CROSS_ROUND_WINDOW`）只防重复循环不防一次性大规模写入，这条是真实可触发的越权面。
- 建议：后续在 tool policy 里加 `allowedPaths` / `deniedPaths` 维度（pattern 形式），并给 ToolRunner 加 per-turn 写入字节 / 文件数 cap。
- 涉及角度：L3 架构（权限模型）、L5 并发（资源配额）

#### 4.7 vfs 路径穿越防护完备（✅）

- 位置：`packages/core/src/domain/vfs/repositories/impl/normalize-path.ts` + `domain/vfs/logic/vfs-path-mapper.ts` + `domain/vfs/logic/vfs-zip-validate.ts`
- 核查结论：
  - `normalizePath`：强制 leading `/`，segment-by-segment 处理 `.` / `..`，root 之上再 `..` 直接 throw `INVALID_PATH`
  - `resolveLogicalPath`：trim + 强制加 leading `/` + 调 `normalizePath`
  - `toPhysicalPath`：先 normalize 再按 scope（global / project / session）拼前缀；`/template/` legacy 前缀显式拒绝
  - `vfs-zip-validate`：拒绝 backslash、Windows 绝对路径（`^[a-zA-Z]:[\\/]`）、`..` 段、`projects/` 跨域前缀；上限 32MB / 5000 entry / 512 字符路径
  - zip slip 攻击向量全部覆盖
- 判定：**✅ 无问题**——这是 vfs 子系统安全实现的亮点。

#### 4.8 LLM HTTP debug-fetch 脱敏完备（✅）

- 位置：`packages/core/src/infra/llm-protocol/logic/debug-fetch.ts`
- 核查结论：`redactHeaders` 把 `authorization` / `x-api-key` 替换成 `***`；`redactUrl` 把 query 里的 `key=` 替换（Gemini 的 `?key=` 场景）；`summarizeBody` 不输出 plaintext，只输出结构摘要（model / stream / tool_choice / messages.length / contents 概要）。默认关闭，只在 `NM_DEBUG_LLM_FETCH=1` 或 `__DEV__` 时启用。
- 判定：**✅ 无问题**。

### 安全面旁支核查

- **eval / new Function / new RegExp 注入面**：grep 全仓库 `eval\s*\(` 与 `new\s+Function\s*\(` 在 `packages/core/src` 下无匹配（grep 工具失效，用 PowerShell `Select-String` 复核）；`new RegExp` 的构造在 regex context 下都用静态字面量，未见 `new RegExp(${userInput})` 形态。
- **HTTP adapter 错误消息泄漏**：`assertOk` 把非 2xx 的 body 截前 500 字符塞进 `ProviderError HTTP_ERROR` 消息——如果 provider 返回的错误 body 里包含 echoed api key（极少数 API 会这么做），这个 snippet 会被记录到日志。属于边缘风险，记 C 级观察项。
- **`NM_SKSP_DISABLE_ENV` 在 mobile 生产不传 env store**：`composite-secret-store.ts` 的 `env` 是可选参数，mobile 生产路径文档里说「不传 env store」，但代码层面没有 assert 防误用——如果未来 mobile 误传了 env store，没有运行时 guard。属于代码味道，记 C 级。

---

## 角度 × 模块 矩阵

下面按模块（context / 子系统）给一段独立结论，便于 phase2 切片复用。

### core/src/index.ts（顶层 facade）

191 行纯基础设施导出，没有内部泄漏。`createPersistentState` / `createPersistentPreferences` 是顶层 facade 唯一触碰 service 层的地方，但只导出 factory + 常量 key，可接受。整体健康度：**A**。

### core/src/public/*（13 个 domain barrel）

两层 facade 的第二层，整体设计正确。`chat.ts`（377 行）公共面过宽、含未收尾的 @deprecated 导出，是唯一明显的 B 级问题。其余 12 个 barrel 体量与内容都合理。整体健康度：**B+**（chat 拖后腿）。

### SKSP（infra/sksp + 三端 driver 包）

安全实现质量最高的子系统。三端密钥存储都做到了不明文落盘、错误消息不泄漏密钥、跨设备恢复路径有 `DECRYPT_FAILED` 兜底。env 覆盖层是 B 级信任面问题（CLI/Desktop 默认开），mobile 默认安全。整体健康度：**A-**（env 层信任面扣分）。

### sql-template / TDBC

`#{}` / `${}` 双语法设计文档完备，业务侧全部用 `#{}`，`${}` 只在 schema migration 的 4 处 JS 模板拼接里间接出现（且当前输入不可控）。整体健康度：**A**（migration 拼接扣 B 级观察项）。

### vfs（路径 + zip）

路径穿越防护是仓库的系统性优点。`normalizePath` + `assertLogicalPathAllowed` + `vfs-zip-validate` 三层防线覆盖了所有已知攻击向量（zip slip、windows 绝对路径、跨域前缀、zip bomb）。整体健康度：**A**。

### tool 系统

`ToolRunner` 强制 input/output schema 校验，doom-loop 检测覆盖重复循环。缺的是路径白名单和资源配额——agent 在同一 project 内仍可越权写任意子树。整体健康度：**B**（权限边界不完整）。

### character-card 导入

PNG magic + tEXt/chara 提取 + BOM 剥除 + V2 spec 字段读取都正确，但走手动 type guard 而非 zod，与仓库整体风格不一致。整体健康度：**B+**。

### LLM 协议适配器（openai/anthropic/gemini）

api key 走 header（Authorization / x-api-key / query key），debug-fetch 有完整 redact。错误消息会截 provider body 前 500 字符（边缘泄漏风险）。整体健康度：**A-**。

### 包导出面（package.json exports）

24 个子路径里 13 个干净走 public、5 个走 config-forms（合理）、3 个走 infra 端口协议（合理）、2 个走 service 层（kkv / session-kkv，封装性破坏）、1 个无人消费（config-forms 根）。整体健康度：**B**（kkv/session-kkv 是 A 级发现）。

### 发版策略（version + release.yml）

13 个包里 11 个停 0.0.0、2 个走 1.4.17，semver 语义自相矛盾。release.yml 只发 mobile/desktop，core/driver/sksp 无发版流程但都标了 private。CHANGELOG 校验是软提示。整体健康度：**B-**（系统性落后于代码节奏）。

---

## 覆盖声明

**已查**：
- 顶层 `src/index.ts` 全文 191 行
- 13 个 `src/public/*.ts` barrel 全部打开（部分只数行数，部分细读）
- `packages/core/package.json` 全文 + exports 24 条逐项
- 所有 13 个 `packages/*/package.json` 与 `apps/*/package.json` 的 version / private 字段
- `.github/workflows/release.yml` 全文
- `packages/sksp-{mac,windows,android}/src/` 三端密钥存储实现全文
- `packages/core/src/infra/sksp/` 全部 7 个文件
- `packages/core/src/infra/sql-template/{placeholder,index}.ts`
- `packages/core/src/infra/llm-protocol/{impl/openai.adapter,logic/{http-util,debug-fetch}}.ts`
- `packages/core/src/domain/vfs/{repositories/impl/{normalize-path,scope-prefix-helpers},logic/vfs-path-mapper,logic/vfs-zip-validate}.ts`
- `packages/core/src/domain/tool/{logic/{tool-runner,vfs-tool-file-path},logic/validate-agent-tool-policy}.ts`
- `packages/core/src/domain/character-card/logic/parse-character-card-json.ts`
- 4 个 schema-migration 文件中的 `${...}` 拼接位置
- apps 端 subpath import 实测统计（约 407 次）
- `domain/{provider,bootstrap}/` 中 apiKey / secret 相关代码位置（grep 定位）

**未查**：
- `packages/core/src/config-forms/` 的具体内容（只确认了 `stored-config-validity/index.ts` 走 `decode()` + zod 的入口形态）
- `infra/cloud-sync/` 的 object storage 凭证处理（cloud-sync 不在 L8 高优范围，留给相关切片）
- L7 测试覆盖（@deprecated 但仍被引用的导出在测试侧的实际依赖深度，交给 L7）
- 三端 native 模块（`@napi-rs/keyring`、`@primno/dpapi`、Android Keystore native）的实现正确性（视为可信外部依赖）

**未查的已知盲区**：
- 没有跑 build / test / lint 验证（readonly 约束）
- 没有动态验证 exports 字段在 npm publish 时是否会因为 `private: true` 失败（理论上会）
- 没有验证 `dist/` 实际产物结构（`tsc-alias` 是否完全对齐 exports 路径声明）

---

## 待交叉的线索

下面这些线索预计会和别的角度产生分歧或互补，留给 phase3 辩论：

### 与 L3 架构潜在冲突

1. **`./kkv` 与 `./session-kkv` 暴露 service 层**：L8 判 A（封装性破坏），L3 可能反驳「service 层的 `index.ts` 自带 facade，所以也算干净合同面」。需要 phase3 辩论：service 层的内部 `index.ts` 算不算 stable public face？我的立场是——源码 facade 已经做了两层（顶层 + public barrel），exports 又开了第三层（service 直发），三种规则并存就是没有规则。

2. **顶层 index.ts 暴露 `createPersistentState` / `createPersistentPreferences`**：L8 判「可接受的便利性导出」（不到 B 级），L3 可能认为顶层 facade 不该碰 service 层。这是「原则纯洁性 vs 实用便利性」的典型冲突，phase3 裁决。

3. **L3 已经判 `src/public/chat.ts` 公共面过宽并移交 L8**：本报告 §一 §源码公共面发现 1 给出 B 级判定，与 L3 立场一致，无冲突。

### 与 L1 数据模型潜在冲突

4. **schema migration 中 `${table}` JS 模板拼接**：L8 判 B（注入面观察项，当前不可达），L1 可能说「schema migration 表名都是仓库内部常量，不存在注入向量」。这是「理论风险 vs 实际安全」的分歧——我的立场是即便当前不可达，绕过 sql-template 机制的特例本身值得收敛。

5. **character-card 解析风格不一致**：L8 判 B（zod 风格不一致），L1 可能反驳「character-card V2 spec 字段简单，手动 type guard 足够」。这是「风格一致性 vs 局部足够性」的分歧。

### 与 L6 跨端潜在冲突

6. **SKSP env 覆盖层三端策略不一致**：mobile 生产不传 env、desktop 默认开 env、CLI 必须开 env（无 native）。L8 判 B（desktop 信任面偏宽），L6 可能说「三端运行环境不同，desktop 用户和 CLI 用户都习惯 env 注入」。phase3 需要裁定 desktop 是否应该默认关 env。

### 与 L10 工程化潜在冲突

7. **release.yml 只发 mobile/desktop**：L8 和 L10 都会发现，分工是——L8 关心「core / driver 包没有发版流程意味着 exports 字段是死合同」（API 稳定性角度），L10 关心「CI 是否覆盖 PR / push」（工程化角度）。两者互补不冲突。

8. **CHANGELOG 软提示**：同上，L8 关心 API 稳定性（消费者无法靠 CHANGELOG 判断 breaking），L10 关心 CI 流程完整性。互补。

### 与 L4 错误处理潜在补充

9. **`assertOk` 把 provider body 截前 500 字符塞进错误消息**：L8 判 C（边缘密钥泄漏风险），L4 可能关心错误消息的用户可读性。如果 L4 主张「错误消息要尽量详细」，会和 L8 的「错误消息要避免泄漏」产生张力。phase3 裁决。

---

## 执行检查清单

- [x] 读指导文档 `docs/review/guides/lens-L8-api-security.md` 并按指示执行
- [x] 参考 D0-1 / D0-2 获取全局上下文
- [x] 基于两层 facade 结构做公共面完整性检查（不只看 src/index.ts）
- [x] 产出公共面审计表（exports 子路径逐项标注）
- [x] 产出安全风险矩阵（入口点 × 风险类型）
- [x] 产出版本号对照表
- [x] 源码公共面 / 包导出面 / 发版 / 安全四块分开写
- [x] 中文叙述式
- [x] 全程 readonly，未改任何代码
- [x] 未宣布 ready
- [x] 未跑 build / test / lint
