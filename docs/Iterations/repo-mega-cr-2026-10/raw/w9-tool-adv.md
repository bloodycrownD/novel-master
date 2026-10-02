---
zone: w9-tool-adv
agent: 辩护人（advocate）
files_scanned: 29（packages/core/src/domain/tool/ 全部 .ts，含 search/ 子树与 engines/ 5 个适配器，无 test）
对抗对: w9-tool-adv ↔ w9-tool-pro（同 zone，互不可见）
方法: 全文件逐行读；关键结论经 tsx 实跑复验（pathStartsWithPrefix / truncateLine / capUtf8BytesFill / capMatchList / capUtf8Bytes）；消费方用 Select-String 全仓反查
---

## 摘要

工具域 = LLM 可调用单元的注册、校验、执行、输出整形与预算控制。内含三块：
①`logic/`——注册器（46 行）、runner（schema+path 双闸+同路径串行化）、输出预算单源模块
（三档+两个字节截断器）、LLM 侧/UI 侧输出整形；②`builtin/`——11 个内置工具（6 个 VFS
文件工具 + task/skill/agent/curl/search）与共享 ctx、overflow 落盘；③`search/`——五引擎
串行降级链与凭据配置。合计约 5.8k 行。

## 职责与边界

- **做什么**：把「模型意图」变成「受约束的副作用」。四层收口：注册期（重名即抛）→ 入参期
  （zod schema + path policy）→ 执行期（ToolError 归一、并发排队）→ 输出期（预算截断 +
  落盘降级 + LLM 文本整形 + UI 摘要）。
- **不做什么**：不做 VFS 存取（`@/domain/vfs/`）、不做技能语义（`@/domain/skills/`）、
  不做 agent 定义校验（`validateAgentDefinition`）、不做工具可见性 policy
  （`resolve-agent-tool-registry`）、不做 wire format（`infra/llm-protocol/tool-definitions.ts`）。
- **分层纪律**：domain 层不 import infra（唯一例外是 `format-tool-output.ts:11` 的
  `TdbcError` 类型 import，用于解包 cause，已在 `builtin-tool-context.ts:243-248` 注明
  「类型就地定义不跨层 import」的同款权衡）。

## 对外接口

| 符号 | 位置 | 性质 |
|---|---|---|
| `Tool<Input,Output,Ctx>` | `model/tool.ts:17` | 协议无关接口，`description` 是 `(ctx)=>string` |
| `ToolRegistry<Ctx>` | `logic/tool-registry.ts:16` | register/unregister/get/list/clear |
| `ToolRunner<Ctx>` | `logic/tool-runner.ts:72` | call / runParallel（concurrency 默认 8，`:30`） |
| `TOOL_OUTPUT_MAX_LINES/LINE_LENGTH/BYTES/MATCHES` | `logic/tool-output-limits.ts:7-10` | 2000 / 2000 / 50KB / 100 |
| `capUtf8Bytes` / `capUtf8BytesFill` / `capMatchList` / `sliceUtf8BytePrefix` | 同上 | 两种截断语义 + 条数双段式 |
| `checkToolPathPolicy` | `logic/tool-path-policy.ts:127` | A-14 闸门（生产装配恒 undefined） |
| `classifyMutatingToolCall` | `logic/fs-command-classify.ts:111` | write/edit/fs/skill 单源分类 |
| `buildToolResultBlock` / `resolveToolResultOk` | `logic/build-tool-result-block.ts:248/41` | 落库块 + UI 摘要 |
| `formatToolOutputForLlm` / `formatToolErrorForLlm` | `logic/format-tool-output.ts:352/414` | 形状守卫 → 可读文本 |
| `FILE_TOOL_NAMES` / `isMutatingFileToolName` | `builtin/vfs-tools.ts:39/61` | 6 个文件工具名与突变集 |
| `registerBuiltinTools` | `builtin/register-builtin-tools.ts:31` | 6+5=11 个 |
| `sinkOversizedOutput` | `builtin/overflow-sink.ts:85` | 超预算落 `/tmp/` |
| `searchTool/curlTool/skillTool/agentTool/subagentTool` | `builtin/*` | 5 个静态工具 |
| `createSearchConfigStore` / `resolveEngineChain` | `builtin/search/search-config.ts:244/182` | KKV+SKSP 薄封装 |

废弃别名（仍从 `src/index.ts:198-199` 导出）：`MUTATING_VFS_TOOL_NAMES`、
`isMutatingVfsToolName`、`registerVfsTools`、`VfsToolContext`。

## 数据访问

| 资源 | 位置 | 写/读 |
|---|---|---|
| session KKV `file_cache` `full:{path}` | `builtin/vfs-tools.ts:549-565`（write 成功后）、`overflow-sink.ts:93-100`（落盘后） | upsert |
| KKV 模块 `nm-search`：`engineOrder` / `searxngBaseUrl` | `search/search-config.ts:29-35, 262-302` | 读写 |
| SKSP ref `search/{engineId}/apiKey` | `search/search-config.ts:41-43, 255-264`；`types.ts:201-220` 只回 `configured:boolean` | 读写，明文不落 KKV/日志 |
| VFS `/tmp/{tool}-{yyyyMMdd}-{rand4}.{ext}` | `overflow-sink.ts:31, 72-77` | write |
| `workplace_dir_rule` 父链补行 | `vfs-tools.ts:615-644`（write 新建 / fs mkdir / 落盘 `/tmp`） | 补行，失败吞错 |

明文 key 出口面自查：只经 `ResolvedEngineConfig` 参数注入适配器，错误路径统一
`redactSecret` **先脱敏后截断**（`types.ts:216-218` 顺序正确），聚合错误每行再截 300
（`search-tool.ts:109`）。

## 依赖关系

- import（向外）：`@/errors/tool-errors` `@/errors/vfs-errors` `@/domain/vfs/**`
  `@/domain/skills/logic/skill-paths` `@/domain/chat/model/content-block`+
  `logic/skill-tool-ref` `@/domain/session-kkv/model/session-kkv-domains`
  `@/domain/workplace/logic/rule-snapshot-codec` `@/service/**` 四个 port
  （vfs/session-kkv/skills/agent/chat/workplace）`@/service/vfs/logic/ensure-import-dir-rules`
  `@/infra/tdbc`（仅类型）、`@/infra/sksp/ports/secret-store.port`（仅类型）`zod`。
- 被谁消费（实测反查）：
  `service/agent/logic/run-agent-turn.ts:41/784-812/1140-1148`（装配 + policy 过滤）、
  `service/agent/impl/agent-runner.ts:90/220/273`（ToolRunner + toolsFromRegistry）、
  `service/chat/create-user-vfs-turn-service.ts:51-78`（用户回合）、
  `domain/agent/logic/resolve-agent-tool-registry.ts:7/58-83`、
  `domain/agent/logic/validate-agent-tool-policy.ts:9/24/34`、
  `infra/llm-protocol/logic/tool-definitions.ts:17`（description 求值）、
  `public/index.ts:181-214`。

---

# 一、辩护理由清单

## D-1 工具注册器：46 行、零依赖、重名即抛——是正确取舍不是"太薄"

理由三点，都有代码依据。

1. **fail-fast 重名**（`logic/tool-registry.ts:24-29`）在当前消费图里不可达，但可达性
   不是选择它的理由，正确性才是：内置注册是静态 11 个；policy 过滤只做减不做加，且
   **按 `baseRegistry.list()` 顺序重建**（`resolve-agent-tool-registry.ts:62, 75-82`），
   集合语义保证不可能重名。一旦将来引入插件/动态注册，last-wins 会静默吞掉同名工具，
   throw 会在装配期当场炸。
2. **插入序 `list()` 是确定性来源**：LLM 侧工具列表顺序 = 装配顺序，跨端（mobile/
   desktop/desktop-cli）可复现，不依赖 Map 之外的任何排序。换成 Object 或 Set 会丢这个。
3. **`Ctx` 泛型 + 鸭子读**（`tool-path-policy.ts:96-103` 有 WHY 注释）是让 path policy
   与 `BuiltinToolContext` 解耦的关键：runner 是 `Ctx = unknown`，policy 就不能反向
   import service 类型。duck typing 在这里省掉的是一整条 domain→service 依赖边。

不接受"注册器应该有 unregister / should be extensible"这类指控——`unregister` 是标准的
组合性 API（未来 policy 覆盖式注册要删旧工具），保留成本是 3 行。

## D-2 输出预算三档：对应三种**不同形态**的过载，不可互相替代

- **行数档 2000**（`tool-output-limits.ts:7`）：防「行很短的正常文件」把上下文打爆，
  并给模型一个可预期的分页单位（read 的 `offset`/`limit` 就是行）。
- **字节档 50KB**（`:9`）：**这才是花钱的那一档**。token 与字节弱相关：2000 行中文
  ≈ 200 万字符，行数档完全拦不住，所以必须并存。两档**都命中才算 truncated**
  （`vfs-tools.ts:196`：`byteCapped.truncated || lineNextOffset != null`）——用 `||`
  而不是"字节档覆盖行数档"，是为了让「文件有 3000 行但只有 8KB」时 `truncated=true`
  且 `nextOffset=2001`，模型仍能翻页。
- **条数档 100**（`:10`）：grep/glob/agent-list 的过载单位是**条**不是行。一条 grep
  匹配可带 8KB contextLines excerpt，100 条 ≈ 800KB——字节档会先砍到只剩 12 条；
  反之 100 条短路径只有几 KB，行数/字节两档都不触发，只有条数档拦得住。
  `capMatchList` 先按条数后按字节（`:200-215`）的双段式就是这条推理的落地。
  实测：100 条 × 2000 字符 → 只留 **25** 条，字节段确实压过条数段。
- `TOOL_OUTPUT_MAX_LINE_LENGTH`（2000 字符）**不是第四档**，是单行宽度护栏，只在
  grep excerpt（`vfs-tools.ts:524`）与 skill read（`skill-tool.ts:382/431`）上生效。
  read 工具在 50KB 单预算下**刻意不再按字符截行**（`vfs-tools.ts:189-191` 注释明写
  「不再按 2000 字符截行」），因为 minified JSON / 无换行 HTML 单行可以几百 KB，
  按 2000 字符切会把 JSON 切成语义碎片。`truncateLine` 返回 `{line, truncated}` 标志
  而非裸串，是让它可被复用的组合件。

## D-3 `capUtf8BytesFill` vs `capUtf8Bytes` 不是重复实现，是显式的两套语义

理由写在 `tool-output-limits.ts:136-145` 的 WHY 里，实现与之逐条对齐：

- read 场景单行可达几百 KB。`capUtf8Bytes` 的「装不下就整行丢弃」在这种情况下会让
  **一次 read 一行都留不下**，模型只拿到 `truncated=true` 却没有内容，纯负价值。Fill 版
  让末行截到预算点，配 `lastLineTruncated` 标志声明「该行尾部不可续读」。
- 配套的 `nextOffset` 推导（`vfs-tools.ts:198-214`）专门避开「重读同一行 → 预算不变 →
  再截一次 → 死循环」，注释把三种分支（末行部分保留 / 末行整行丢弃 / 末行是文件尾）
  逐一写明。这是被推演过的边界，不是随手写的。
- 反过来 grep excerpt / fs ls 的行都是短行，整行丢弃语义**更安全**（不给模型半截
  excerpt 误导判断），所以既有函数一字不动。**保留旧函数而不是改签名**意味着
  skill / fs 的行为在预算重构后不会被动漂移。

## D-4 path policy 占位：保留有价值，删掉才是真损失

事实先摆清（实测反查）：生产装配三处全部写死 `allowedPaths: undefined`
（`service/agent/logic/run-agent-turn.ts:926`、`:1276`、
`service/chat/create-user-vfs-turn-service.ts:78`）；runner 侧是**无条件调用**
（`tool-runner.ts:100`），但 policy 在 undefined 时首行返回（`tool-path-policy.ts:69-71`、
`:85-87`），运行时成本为零。这与 W1 裁决 1「A-14 占位转 intentional」一致。

保留的三个理由：

1. **闸门位置正确且不可事后摆放**：schema 校验之后、`tool.run` 之前
   （`tool-runner.ts:92-106` 的顺序）。将来开启时只需在三个装配点填一个
   `resolveAllowedPaths`，runner 骨架与所有工具实现零改动。
2. **契约已固定在类型上**：`BuiltinToolContext.allowedPaths`（`builtin-tool-context.ts:181-193`）
   + `ToolError` 的 FORBIDDEN 分支（`errors/tool-errors.ts:98`）。这是把"以后要支持什么"
   写进类型系统的最小成本做法。
3. **有测试锁定语义**（`test/tool/tool-runner-path-policy.test.ts` 覆盖 undefined / 多前缀 /
   越界 / 前缀相等），不是一段没人验证过的猜测。

**我方立场**：它是占位，我承认；它现在一文不值，我也承认。但反对"当死代码删掉"——
删了之后重新加就要在 runner 里再插一次带序校验，破坏「所有入参校验集中在 runner 一处」
的结构，且这次要重做的还包括所有 `PATH_FIELDS` 抽取逻辑。正确处置是**加显式 TODO + 在
补 normalize 之前禁止任何人打开**（见让步 1），不是删除。

## D-5 同路径串行化（pathTail）是当前并发模型下**唯一**的写保护

RULE.md:83 已白纸黑字拍板：底层乐观锁全拆（60af90b）、write 固定 last-write-wins、
「`toolRunner.runParallel` 的 pathTail 同路径串行化覆盖 write/edit/fs/skill 四个工具名
……是唯一保护层」，并把两个盲区（原始键不归一、跨 runner 实例不串行）列为「拍板接受」。

因此本机位**不接受**「runParallel 没有并发保护」这一类指控——保护存在，作用域是
(path × 单次 runParallel 调用)。`tool-runner.ts:140-170` 的实现正确性也站得住：
`myTail = Promise.all(prevTails).then(() => gate)` 让多个 path 的前驱全部完成才放行，
`finally { release?.() }` 保证异常路径不泄漏 gate。

我方要维护的三点设计：
1. **收窄而非放宽**：`classifyMutatingToolCall`（`fs-command-classify.ts:111-132`）只对
   write/edit/fs/skill 返回非 null `paths`，read/glob/grep/task/curl/search 一律
   `{mutating:false, paths:null}` 不排队，避免无谓串行化拖慢并行度。
2. **skill 合成键设计正确**（`:65-99`）：`skill:{domain}:{逻辑路径}` 既与普通路径键天然
   隔离（技能存 meta 域，物理上不同路径），又让 global/project 同名技能互不排队
   （排一起只白损失并行度）。这个"两重目的"的注释是本域里推理密度最高的一段，值得保留。
3. **「被覆盖内容可从 revision 历史回滚」是恢复路径**（RULE.md:83 末句），所以 last-write-wins
   的数据风险有兜底，不至于不可逆。

## D-6 checkpoint 判突变 与 runner 判突变 故意不同，不是同一布尔量的两份实现

`tool-use-mutates-workspace.ts:21-25`：

```ts
const action = typeof input.action === "string" ? input.action : "";
// checkpoint 对无 action 保守视为突变；runner 路径串行化则视为非突变（见 fs-command-classify）
if (action === "") { return true; }
```

两处都写了互指注释。分叉的正确性论证：checkpoint 的下游是**回滚能力**——误判为突变
的代价是多存一个 checkpoint（浪费磁盘），漏判为突变的代价是 agent 改了文件却不留恢复点
（不可逆）；runner 排队的下游是**并行度**——无 action 的 fs 调用必然被 schema 拒掉
（`vfs-tools.ts:360-362` action 是必填 enum），为一次注定失败的调用排队是纯损失。
**把"安全侧的保守"和"性能侧的保守"分别对准各自的下游**，这比强行统一更正确。

## D-7 输出整形的守卫顺序是按"形状互斥"排的

`format-tool-output.ts:352-406` 的判定顺序对应一张真实的互斥表，不是随手排：

- `isReadOutput` 要求 path+content+totalLines+returnedLines+truncated **五字段全中**（`:30-38`）。
- `isGrepOutput` 显式排除 chat_grep：靠 `messageId`/`seq`/`hidden` 三个 key **存在即否决**（`:89-91`），
  且空 matches 时还要排除 entries/paths 形态（`:79-81`）。
- `isGlobOutput` 显式排除 entries/matches（`:124-132`）。
- `isCurlOutput` 要求 url+finalUrl+status+body+truncated 五字段，作者在 `:242-248`
  明写「现有工具输出均无 url 字段，不会误撞 read/grep/glob/fs 形状」。
- fs ls 用最弱的守卫（`entries && total`，`:152-154`），但它排在 read 之后，且 fs 输出
  不含 read 的五字段，顺序即互斥保证。

`resolveToolResultOk` 用 `Error:` 前缀兜底推断（`:41-49`）也是自洽的：
`formatToolErrorForLlm`（`:438`）**永远**产出 `Error: ` 前缀，新数据两侧一致；
`formatToolResultContentForDisplay`（`:466-476`）再对存量 JSON 行做一次兜底解析。
这叫"新旧两条路径都要照顾"，不叫"没做判别"。

## D-8 落盘（overflow-sink）是三选项里唯一不丢信息的，且降级方向按工具风险分岔

curl/search 的输出（网页正文、搜索 JSON）实践上经常 >50KB。三个选项：截断（丢）/
报错（浪费往返）/落盘（多一次 read）。选第三个的本质是把**内容**与**引用**分离：tool_result
只带路径，模型自己决定要不要花一次 read。文件名规范 `/tmp/{tool}-{yyyyMMdd}-{rand4}.{ext}`
与扩展名映射（`overflow-sink.ts:55-77`）都写明出处（SPEC web-search-tool Step 5）。

**降级方向不同是刻意的**，这一点常被当 bug 报：curl 落盘失败→回**字节截断**
（`curl-tool.ts:495-528`，正文已在手，且有 `truncateToByteBudget` 这条退路）；
search 落盘失败→回**完整输出**（`search-tool.ts:268-281`，正常结果约 15KB，
落盘失败与超预算双罕见，截断反而丢搜索所得）。两处的 try/catch 都是明确的
`console.debug` + 降级，不是静默吞。

配套动作复用 write 的两件（file_cache upsert + `/tmp` 目录规则补齐）也是显式声明
（`overflow-sink.ts:91-101`），不是巧合。

## D-9 "无 SSRF / 无确认门"是用户拍板的已知限制，不是疏漏

`curl-tool.ts:24-26` 明写：「不做确认门 / 域名白名单 / SSRF 私网拦截（用户拍板：简单搞、
参考 curl；协议白名单之外的限制列为 known limitation，见 spec 偏离记录）」；
`search/types.ts:15-16` 同口径。**在本机位看来这是可辩护的**：这是本地应用里的本地 agent，
不是服务端处理不可信 URL 的代理——不存在跨租户受害面，把 SSRF 清单当漏洞报需要先证明
受害面存在。

同时该做的防护一条没少：协议白名单在 schema 层手写 `superRefine` 而不用
`z.string().url()`（`curl-tool.ts:258-278`，注释说明 `file://`/`data:` 要在 schema 层
就拒）；CRLF 注入在 header 名正则 + 值换行双检（`:70`、`:295-320`）；content-length
预检防巨响应内存峰值（`:436-450`）；密钥脱敏覆盖全部错误出口且**先脱敏后截断**
（`types.ts:210-220`）。**风险是被接受的、有边界的，不是无意识的。**

## D-10 `description: (ctx) => string` 是被逼出来的唯一合形式，不是过度设计

三个工具（task/skill/agent）必须把"本回合有哪些子代理/技能/agent 可用"写进给 LLM 的
description，而数据来源是异步 API：`agentRegistry.list()` 返回 Promise
（`builtin-tool-context.ts:110-114` 明确写了「lambda 是同步求值不能现查」）。两条路都不行：
description 若是静态 `string`，只能装配时求值一次再塞进 registry 副本 → 需要复制 registry
并缓存字符串；若是 `Promise<string>`，`toolsFromRegistry` 每次都要等 IO，且 description
要进 provider 的 tool schema（`infra/llm-protocol/logic/tool-definitions.ts:17`）。

`(ctx) => string` + **装配期预算快照**（`callableAgents` / `effective` / `agents`）是同时
满足"description 与本回合状态一致"和"求值同步"的唯一形式。代价"回合内变更不即时反映"
在三处工具的 description 里都明写了——**被写下来的取舍不是遗漏**。

## D-11 引擎适配器把超时/错误范式收敛到 `types.ts` 是为了保住一条不变量

`engineTimeoutError` / `engineApiErrorMessage` / `redactSecret` 五引擎共用
（`types.ts:210-236`），保证"每个引擎的错误消息都先脱敏再截断 300"不会被某个引擎的
复制粘贴破坏。duckduckgo 用正则解析 HTML 看着"脏"，但原因写清了：RN/Hermes 无 DOM、
linkedom 不可用，class token 精确匹配是为了避免 `result__url` 误伤（`duckduckgo.ts:12-16`）。
它还在"有块但全无有效 title/url"时抛 invalid response（`:227-231`），而"有结果但全被
domainFilter 滤掉"回正常空数组——**把「改版/反爬」和「正常无结果」区分开，让串行链能
正确降级**，这个区分是对的。

## D-12 概括：本机位主张"这个域不该在优化批次里被动"

注册器、预算三档、守卫顺序、path policy 结构、description 契约——这五处在
**功能上都是正确的，且各自的"看起来冗余"都有成文或实测的反例**。建议它们进入
「只读观察」而非「优化待办」。我方真正会签字修改的只有下面的 P2/P3 清单。

---

# 二、让步清单（我方承认为真问题，含优先级）

## F-w9-tool-adv-1 | **P2** | `logic/tool-path-policy.ts:20-33` + `:43-58`

```
const rec = input as Record<string, unknown>;
for (const key of PATH_FIELDS) {
  const v = rec[key];
  if (typeof v === "string" && v.length > 0) paths.push(v);
}
```

描述：策略作用在 **zod 解析后的原始字符串** 上（`tool-runner.ts:100` 传的是
`parsedIn.data`，而 `write` 的 `path` 声明是 `z.string().min(1)`，无 transform），
**不做任何归一化**。实测（tsx 跑真实模块）：

| 路径 | 前缀 | 结果 |
|---|---|---|
| `/src/a.md` | `src/` | **false**（假阴性：VFS 逻辑路径恒以 `/` 开头，`builtin-tool-context.ts:186-189` 文档给的例子 `"src/"` 永远匹配不上） |
| `src/../etc/passwd` | `src/` | **true**（假阳性：`..` 段不阻断） |
| `srcs/a.md` | `src` | false（这点是对的，不是裸 `startsWith`） |
| `src\a.md` | `src/` | true（双分隔符容忍，符合 Windows 复用口径） |

建议：把归一化挪进 `checkToolPathPolicy`——先 `resolveLogicalPath`（write 入口已经这么
做了，`vfs-tools.ts:255`）再判定前缀，并显式拒 `..` 段。**在修好之前给 `allowedPaths`
加一条注记：这是"打开即错"的字段**，因为它现在是 `BuiltinToolContext` 上的公开可选
字段，任何装配点手滑填一个非 undefined 值就会得到一个既漏（绝对路径）又溢（`..`）的
假安全网。这是 P2 而非 P1 的唯一理由是目前生产三处全写死 undefined。

置信：confirmed（实测复现）。

## F-w9-tool-adv-2 | **P2** | `logic/fs-command.ts:154-183` + `:191-199`

```
/** `rm` 未带 `-r` 时，若目标是目录则自动递归删除（兼容 Agent 常见用法）。 */
async function rmRecursiveWhenTargetIsDirectory(vfs, path, recursive) {
```

描述：`fs rm` 不传 `recursive` 时，工具自己先 `vfs.read(path)` 探、失败再 `vfs.list(path)`
探，判定是目录就**自动递归删除整棵树**。三处代价：
①没有二次确认；②探测与 `vfs.delete` 之间存在 TOCTOU 窗口（probe 后目录被替换为文件
则按 recursive 删、或反之）；③目标不存在时多打两次 IO 才走到 delete。
tool description（`vfs-tools.ts:346`）已如实披露该行为，所以这是**已披露的默认行为**，
不是隐瞒的 bug。我方让步在于：默认动作应该是保守的那一个。
建议：要么改成 `rm` 遇目录时报错、要求模型显式补 `recursive: true`（一次额外往返换
数据安全）；要么保持现状但在 `summarizeToolSuccess` 的 `fs` 分支（`build-tool-result-block.ts:100-107`）
对 `rm` 单独回显"已递归删除 N 项"，让用户在 UI 上看得见。**这属产品决策，我方不单方面
拍板，但要求进 backlog。**

置信：confirmed（行为）/ intentional（披露部分）。

## F-w9-tool-adv-3 | **P2** | `logic/tool-output-limits.ts:170-178`

```
truncated = true;
const remaining = maxBytes - bytesUsed - separatorBytes;
if (remaining > 0) {
  const prefix = sliceUtf8BytePrefix(line, remaining);
  if (prefix.length > 0) { result.push(prefix); lastLinePartial = true; }
}
```

描述：末行**部分保留**时只 push 了 prefix，**没有把 prefix 的字节数累加进 `bytesUsed`**
就 break 了，于是返回值里的 `bytesUsed` 低报。实测（tsx 跑真实模块）：

```
capUtf8BytesFill(["abc"], 2)
  → { lines: ["ab"], truncated: true, bytesUsed: 0, lastLinePartial: true }
// 实际用了 2 字节，声称 0 字节
```

当前**无实际影响**：`read` 只消费 `.lines` 与 `.truncated`（`vfs-tools.ts:191-196`），
`fs ls` / skill 走的是另一个函数。测试也只断言 `bytesUsed <= TOOL_OUTPUT_MAX_BYTES`
（`test/tool/tool-output-limits.test.ts:51`，此例 0 ≤ 上限照样过），没有断言精确值。
但这是一个**被导出的公共纯函数的返回值在说谎**，未来任何调用方拿 `bytesUsed` 做
"还剩多少预算"的计算都会得到错误答案。
建议：`result.push(prefix)` 后补 `bytesUsed += utf8ByteLength(prefix)`，并加一条
精确值断言的测试。

置信：confirmed（实测复现）。

## F-w9-tool-adv-4 | **P3** | `logic/format-tool-output.ts:392-404`

```
if (keys.length === 1 && typeof rec.version === "number") return "ok";
if (keys.length === 2 && typeof rec.version === "number" && typeof rec.replacements === "number") return "ok";
if (keys.length === 1 && rec.ok === true) return "ok";
```

描述：三条**不看 tool 名**的兜底启发式。当前安全，因为前七条守卫已覆盖全部 11 个工具
的输出形状；但它是纯形状匹配——将来任何新工具若返回裸 `{version: n}`（比如某个
"读配置"工具），其真实内容会被静默渲染成 `ok`，模型完全看不到。
建议：至少把 `meta?.toolName` 传进 `formatToolOutputForLlm` 并对这三支做名字白名单
（`write`/`edit`/`fs`），或在注释里写明"新增工具时必须先跑一遍本函数"。

置信：suspected（当前无实害，是未来维护陷阱）。

## F-w9-tool-adv-5 | **P3** | `logic/tool-output-limits.ts:19-30`

```
line: text.slice(0, maxLen) + TOOL_OUTPUT_LINE_TRUNCATED_SUFFIX,
```

描述：截断后**追加 34 字符后缀**，行实际长度 2034 > 声明的 2000 上限。实测：

```
truncateLine("x".repeat(5000)).line.length === 2034   （TOOL_OUTPUT_MAX_LINE_LENGTH = 2000）
```

文档口径（`curl-tool.ts`/`vfs-tools.ts:469` 的 "最多 100 条 / 50KB"）与实现略有出入，
且这 34 字符会实打实进 grep excerpt 与 skill read 的字节预算。
建议：改成 `text.slice(0, maxLen - suffix.length) + suffix`，让 `maxLen` 真正是硬上限。

置信：confirmed（实测）。

## F-w9-tool-adv-6 | **P3** | `logic/tool-output-limits.ts:14-16` + `:67-77`/`:205-215`

```
function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}
```

描述：每次调用新建一个 `TextEncoder`，而它在 `capUtf8Bytes` 的**逐行循环**和
`capMatchList` 的**逐条循环**里每轮各 new 一次（100 条 grep 匹配 = 100 次构造）。
对照：`curl-tool.ts:173-183` 的同名函数是**块式增量 + 单 encoder 复用**的成熟写法，
本模块反而没跟上。status.md 的 `core-infra-misc` 裁决已把「单次 encode 测长」列为
性能柱，说明这是本仓已认可的优化方向。
建议：模块级单例 `const ENCODER = new TextEncoder()`。

置信：confirmed（构造点可数）。

## F-w9-tool-adv-7 | **P3** | `logic/tool-path-policy.ts:17`

```
const PATH_FIELDS = ["path", "filePath", "from", "to"] as const;
```

描述：glob 的 `options.cwd`、grep 的 `options.pathPrefix`/`pathGlob`/`pattern` 都不在
抽取范围内，即**只读工具的检索范围不受白名单约束**。对写路径（write/edit/fs 的
path/from/to）已全覆盖，写安全上够用；但若将来把 `allowedPaths` 的语义从"写闸门"
扩展成"可见性闸门"，这三个字段必须一并纳入。skill 工具的 `path` 是技能域相对路径、
不属同一命名空间，**不该**纳入（纳入反而会误杀）。
建议：注释里写清"只覆盖写路径字段"，避免下一位维护者误以为已全量覆盖。

置信：confirmed。

## F-w9-tool-adv-8 | **P3** | `logic/tool-registry.ts:32-34`、`:50-52`

描述：`unregister()` / `clear()` 全仓反查**只有 `test/tool/tool-registry.test.ts:58`
一处调用**，生产无消费方。`clear` 已标 `@internal ... for tests only`，`unregister` 没有。
建议：给 `unregister` 补同样的 `@internal` 或删除；留着不构成风险，但会让
"死代码扫描"类工具反复报同一处。

置信：confirmed（实测反查）。

## F-w9-tool-adv-9 | **P3** | `logic/format-tool-output.ts:54`

```
"Last line was cut at the 50KB byte budget; its tail is not resumable (continue from the next line)."
```

描述：提示文案把 `50KB` 写死成字面量，与 `TOOL_OUTPUT_MAX_BYTES` 常量脱钩。改常量不改
文案 → 漂移。同一段还有 `"Output truncated."` 等若干硬编码英文串（与本仓中英混排的风格
一致，不算问题）。建议：改用 `` `${TOOL_OUTPUT_MAX_BYTES / 1024}KB` ``（`overflow-sink.ts:105-107`
已经是这么写的，有现成先例）。

置信：confirmed。

## F-w9-tool-adv-10 | **P3** | `logic/tool-output-limits.ts:190-215`

```
export function capMatchList<T>(items, maxItems = TOOL_OUTPUT_MAX_MATCHES, formatItem): {...}
...
  if (bytesUsed + separatorBytes + lineBytes > TOOL_OUTPUT_MAX_BYTES) {   // :209 硬编码
```

描述：`maxItems` 可传参（glob/grep/agent-list 都显式传 `TOOL_OUTPUT_MAX_MATCHES`，
等于没可配），而字节预算**直接硬编码常量、无参数**，两个上限不对称。且实测显示字节段
在真实负载下压过条数段（100×2000 字符 → 只留 25 条），于是「条数档 100」这个对外
承诺的数字实际上很少是真正的瓶颈。
建议：加 `maxBytes` 参数（默认仍是 `TOOL_OUTPUT_MAX_BYTES`），并在 grep 的 description
（现写"最多 100 条 / 50KB"，`vfs-tools.ts:469`）里保持双口径说明即可。

置信：confirmed（实测）。

## F-w9-tool-adv-11 | **P3** | `logic/tool-output-limits.ts:130`

```
return text.slice(0, end);
```

描述：`sliceUtf8BytePrefix` 的逐码位循环出口。走到这里的前提是"该块超预算"
（`used + chunkBytes > maxBytes`），而 chunkBytes 与逐码位累加同源同 encoder，
所以逐码位循环必然先命中 `used + charBytes > maxBytes` 返回——**这一行不可达**。
（对照 `curl-tool.ts:216` 同款结构的 `return text.slice(0, i + chunk.length)` 同理。）
属防御性死代码，无害。保留也行，我方让步列出的理由只是"别让覆盖率报告把它算成未测分支"。

置信：suspected（未构造反例证明可达）。

## F-w9-tool-adv-12 | **P3** | `builtin/vfs-tools.ts:57-58`、`:65-66` + `src/index.ts:198-199`

描述：`MUTATING_VFS_TOOL_NAMES` / `isMutatingVfsToolName` 已标 `@deprecated`，
仓内**已无任何内部消费方**（实测反查：仅 `vfs-tools.ts` 自身定义处 + `index.ts` 转出），
但仍从公共 barrel 导出。mobile/desktop 作为 workspace 外消费者，仓内反查看不到，
贸然删会破外部编译。
建议：先进 dead-backlog，标"下一个 major 删"，或加 `@deprecated since vX.Y`。

置信：suspected（外部消费面未穷尽核实）。

## F-w9-tool-adv-13 | **P3** | `logic/build-tool-result-block.ts:22`

```
import { TOOL_OUTPUT_MAX_BYTES } from "../logic/tool-output-limits.js";
```

描述：该文件本身就在 `logic/` 下，`"../logic/..."` 绕了一圈指回同目录。
纯观感问题，建议顺手改成 `"./tool-output-limits.js"`（零行为影响，故列 P3）。

置信：confirmed。

---

# 三、争议与存疑（不抹平）

1. **read 与 skill read 的字节截断语义分叉，我方判 intentional，但边界没被测到。**
   `tool-output-limits.ts:136-145` 明确写了"既有函数不动——fs ls / grep excerpt / skill
   路径仍用旧口径"，我方据此判 intentional。但 `skill-tool.ts:435-446` 的 `truncated` 判定
   用了**三条件**（`byteCapped.truncated || returnedLines < slice.length ||
   (lineNextOffset != null && returnedLines >= limit)`），而 read（`vfs-tools.ts:196`）用
   **两条件**。我方推演：skill read 走 `capUtf8Bytes`（整行丢弃），末行被丢弃时
   `nextOffset = offset + returnedLines` 仍指向该行，下一轮预算重置后能重读，逻辑成立。
   但 `lineNextOffset != null && returnedLines >= limit` 这个第三条件是 read 侧没有的，
   我方**没能构造出它相对两条件版本多拦住/少拦住哪个 case**。若裁定方要求统一，
   我方建议**先查 `test/tool/skill-tool*.test.ts` 是否锁了这条**再改。

2. **`allowedPaths` 何时能被打开，属产品/安全决策，不属代码质量。** 当前三处装配点写死
   undefined、类型是公开可选字段、没有任何 lint 或类型约束阻止第三方装配点填值。
   我方立场是"补归一化之前不开"，但这需要一次显式拍板（谁开、开了之后允许收多紧），
   不能由 CR 单方面定。若裁定方认为该字段应改为 `readonly allowedPaths?: never`（编译期
   锁死）直到实现补齐，我方**不抗辩**——那是比 TODO 更强的约束。

3. **`fs rm` 自动递归是否要改，属产品决策**（见 F-2）。我方给两个方案但不排序。

4. **`skill load` 的 `alreadyReferenced` 共享方向 A 依赖 `ctx.skills.referencedNames`
   由 agent-runner 每步 prepare 后回填**（`builtin-tool-context.ts:99-104`）。
   该回填点在 `service/agent/` 域外，本机位只读到接口契约，**无法确认回填时序是否真的
   覆盖到每一步**。标 `suspected` 交由 core-agent 域核实，不在本报告下结论。

5. **探针缺失的一处**：`Tool.outputSchema` 可选（`model/tool.ts:32-38`），只有
   `ToolRunner.call` 在存在时才校验（`tool-runner.ts:108-114`）。11 个内置工具里
   curl/skill/agent 用了 `z.discriminatedUnion` / `z.union`，而 `fs` 用
   `z.union([{ok:literal true}, {...}])` —— `z.literal(true)` 在 zod 4 下对
   `{ok: true, ...}` 的非严格对象是否放行，取决于 stripUnknown 行为。我方**没有实跑
   zod 版本下的这条校验**（需构造一次 ToolRunner.call 才能确认），标 `suspected`。
   影响面小（fs 自己的 run 只返回两种形状之一），但若 zod 4 严格化后这条会变成
   运行时 FAILED，建议 W6 顺手验一次。
