---
date: 2026-10-01
---

# task-attach-unref（移除 read/skill 引用化 + task 工具双参数）技术规格（SPEC）

## 需求来源

用户口述（2026-10-01 本会话，无 prd.md）。完整决策链见 `docs/apm/memory/20260927-worktree-123-verify-guide.md` 2026-10-01 各轮：

1. 真库归因（tmp/nm-real-20261001.db，61.78MB / user_version 17）：read 回显 40.66MB 中 **96.2% 来自子会话**（383 子 vs 16 主），全库精确重复 86.0% 几乎全在子会话之间——「每个 task 子代理开荒重读同一批文件」是存储爆炸主体。
2. 用户拍板：移除 v1.5.29 的 read/skill 引用化（contentRef / SkillResultRef，工程位置不合适），**反向回迁后台任务**、一切处理干净为准。
3. 迁移简化拍板：不做精确 wire 重放，回填 `{path, content}` JSON 即可——LLM 见格式偏差会重试/自行换算，无代码消费方解析行号格式（搜索只匹配 text 块、UI 卡片读 summary、token 计数只要全文）。
4. task 工具加两参数减少子会话 read：`sessionId`（续用子会话）、`fileAttachment`（路径列表，与主会话附件同链路挂 `<action name="userAttach">`）。
5. S0 语义拍板（用户）：alreadyReferenced 去重是合理设计——**「加载过全量的话，不用二次加载」**。

探索报告：`cache/explore-1-unref-chain.md`（E1 引用化全链 37 文件）、`cache/explore-2-task-subsession.md`（E2 task/子会话 40 文件）、`cache/explore-3-attachment-chain.md`（E3 附件链 62 文件）、`cache/explore-4-maintenance-tests.md`（E4 回迁基建与测试约束 45 文件）。

### 探索结论的关键修正（主代理代码抽查，覆盖 E3 报告口径）

`evaluateFileDisplay`（`workplace-eval.ts`）：head/tail 优先集合（`computeHeadTailIndices`）内的文件一律 `"full"`；默认目录规则 `headCount: 0, tailCount: 1000` → **默认配置下规则可见文件几乎全部以前缀全文注入**（真库 file_cache 主会话引用侧明文 0.40MB 佐证）。因此：

- 默认配置下 S0 吞附件**符合**「已加载全量」的用户口径（E3 的「默认 header 只展示 front matter」未计入 tail 集合，结论过悲观）；
- 真实缺口仅在**显式配置** `fillPolicy: "header"/"filename"/"hidden"` 且文件落在 fill 分支（超出 head/tail 集合）的目录——此时未加载全量却仍吞附件；
- 本 spec 的 S0 对齐（见 C3）只修这个缺口，默认配置行为零变化。
- 另注：真库（user_version 17 = v1.5.25 形态）的 96.2% 归因产生于「子会话尚无 workplace 前缀」的旧 regime；v1.5.26 起 general 子代理已注入父工作区前缀（规则可见文件默认全文），重复读的一部分已被前置缓解。本迭代的三线优化（移除机制 + 续用 + 显式交付）在此基础上继续收敛。

## 设计目标

| # | 目标 | 验收口径 |
|---|---|---|
| G1 | read/skill tool_result 写侧回退为全文存储（read 带 6 位行号 `formatReadOutput`，skill 走原输出），不再产生 contentRef、不再 +1 | 新消息 `content_json` 无 `contentRef` 键；执行 read 前后 ref_count 不变 |
| G2 | 提示词链路对存量 contentRef 行走「极简兜底 hydrate」：按 `(entryId, version)` 取 revision 明文 → 内存态填 `{path, content}` JSON；取不到落错误占位 JSON + warn | 存量行拼提示词得到含正文的 JSON；`content_json` 不被写回 |
| G3 | 反向回迁后台任务：谓词扫含引用块的行 → 回填 JSON 全文 → 对源 revision 按 `aggregateReadRefs` 口径 −1（与写回同事务）→ KKV 完成标记；幂等续跑、假阳性行收敛、坏行落占位 | 谓词归零 + 标记置位（**例外**：解压兄弟任务 KKV 标记未置时允许 deferred 不置标记、warn 记数——D19）；ref_count 精确对账（每 pair 恰 −1，无泄漏无双减） |
| G4 | task `sessionId` 参数：null 新建；非空续用**当前父会话的**子会话（归属校验 + 并发硬互斥 + 三态错误文案） | 续用不新建会话、同 id 追加 user msg；三态各有引导文案；同 step 并发同 id 一成一败 |
| G5 | task `fileAttachment` 参数：路径列表物化为 `source:"attach"` 附件挂子会话首条 user msg，与主会话完全同链路（content:null 落库、view-time hydrate、alreadyReferenced 去重） | **预算内**路径挂附件（`attachments_json` 形态合法；提示词出现 userAttach action XML）；超限路径按 D11 降级进 prompt 尾注（T-TA3）；UI chips 自动渲染 |
| G6 | S0 入集条件对齐「仅 full 填充」：attach 去重 seen 初值只吃 full 档；**workplace 省略判定不动共享 seen，叠加双读 `workplaceSeen`（初值=全部可见 path，缺省回落 `seenPaths`）**——既防 header/filename 内容被前缀+附件重复注入，又保住 attach 抢先 seen 与历史 workplace 抑制后续 attach 的既有语义 | header/filename 路径 attachment 得全文；full 条目行为不变；workplace 历史附件仍按现状省略（T-S04）；T-PD3 / T-PD4 / T-PD8 / T-SR6 原语义全保留 |

**非目标**：不动 skillAttach（`$技能名`，attachment 层）；不做**主会话** attach 的体积闸（现状无闸，本版不动；task `fileAttachment` 侧的体积预算见 D11）；不做子会话压缩开关调整；不删 parse 白名单 / ref-count 挂点 / desktop 占位分支（属清理版，见「后续清理轮」）；不动 schema（无 DDL、不 bump BOOT_VERSION）。

## 总体方案

三线并行、一个版本（v1.5.30）交付功能面：

- **A 线（unref 回退）**：产 ref 与 +1 是一个原子单元，同批摘除（`build-tool-result-block` 产块分支 + `vfs-tools` read 分支 `refAnchored`/`adjustRevisionRefCount` + `skill-tool` `anchorSkillResultRef` + `resolveReadRefCountChannel` 通道）。hydrate 模块重写为极简兜底。**parse 白名单、五路径 −1 挂点、repair 三类期望值本版保留**——回迁完成前它们是存量行的正确性保障（摘 parse = 空 tool_result 静默发给 LLM）。
- **B 线（回迁任务）**：`infra/db-maintenance/impl/message-ref-unref.ts`，逐项照 `message-content-decompression.ts` 骨架（谓词三处同条件 / 批 100 / 单行短事务 / 批间让步 / 零进展护栏 3 批 / 收尾不变量 / KKV 两段式 / 入口 LIMIT 1 自愈探针带 failedIds / 不挂 VACUUM / 不建部分索引）。
- **C 线（task 双参数 + S0 对齐）**：`subagent-tool.ts` 两参数 → `RunChildAgentOptions` 透传 → 子会话首条 user msg 物化附件（新公共出口 `attachmentsFromPaths`，name 覆写见 D9/D10，预算制降级见 D11）→ `AgentSession.append` 端口扩 attachments 字段（3 个实现类 + 测试内联实现）；`abortRegistry` 加 `tryRegister` claim 做并发硬互斥（落点见 D5）；S0 对齐 = **attach seen 初值收窄 + workplace 侧双读**——`assembleWorkplaceDisplay` 的 `prefixPaths` 条件化为仅 `entry.status === "full"` 入集（attach 去重 seen 初值），**新增返回 `visiblePaths`**（全部规则可见 path，旧语义；两处早退字面量同步补 `visiblePaths: []`）喂 `prepare-user-messages-for-prompt` 新可选入参 `workplaceSeenPaths`；prepare 入口 `workplaceSeen = createPromptPathSeenSet(runtime.workplaceSeenPaths ?? runtime.seenPaths)`（**缺省回落 seenPaths，旧调用方零变化**），`hydrateWorkplaceWithSeen` 判定改 `seen.has(x) || workplaceSeen.has(x)` 且**保留原有 `seen.add`**（共享 seen 的运行期语义完全不动），三处消费方（`agent-runner.ts:453` / desktop·mobile 的 `session-prompt-input.service.ts:122/142`）同步传双字段。

**版本节奏（删干净的终态路径）**：v1.5.30 = 上述全部 + 读兼容保留；清理版（v1.5.31+，另立迭代）= 删兜底 hydrate / parse 白名单 / ref-count 三类残件 / desktop 占位分支，**回迁任务保留作跳版安全网**（1.5.29 直升清理版的用户靠任务兜底）；回迁任务本体按 V1' 节奏退役。

## 关键方案决策（推荐值，确认轮可改）

| # | 决策 | 推荐 | 依据 |
|---|---|---|---|
| D1 | read/skill 输出与 outputSchema 的引用三件套（entryId/version/contentHash） | **本版删**（新输出不再含；存量 hydrate 从 contentRef 读键，不依赖新输出） | 删干净口径 |
| D2 | 续用时归属校验口径 | **直接父**（主装配点填 scope.sessionId、子装配点填 childSessionId；现约束 depth≥2 无 task，两口径当前等价，直接父语义更严谨） | E2 4.4-1 |
| D3 | 续用时 `subagentName` | **仍必填**（schema 简单 + def 合法性校验；description 说明「实际身份以子会话历史为准」） | E2 4.1-6 |
| D4 | 子会话 prompt 的 `@path` 扫描 | **不扫**（fileAttachment 显式传递，避免双机制） | E2 4.4-3 |
| D5 | 并发硬互斥实现 | `AgentAbortRegistry` 加 `tryRegister(sessionId, controller): boolean`（has 则拒，不覆盖）。**claim 落点 = `runChildAgent` 内 L1187 的 register 原地改 tryRegister**——该行在 L1262-1264 `session.append` 之前，claim 失败抛 ToolError 直接返回、**不留孤儿 user 消息**；task 层 `isSessionRunActive` 只作前置引导检查（软闸）；端口 `agent-abort-registry.port.ts` 的「覆盖是预期行为」注释同步登记新语义 | E2 5.1 + R1 P1-2 |
| D6 | CLI 无 abortRegistry | **CLI 补注入**（成本极低）；互斥判定闭包 `runtime.abortRegistry?.has(id) ?? true`（缺 registry 保守拒绝续用）——三端补注入后该分支只服务测试 mock / 旧装配，生产路径不命中 | E2 5.2 + R1 P2-3 |
| D7 | 续用历史软闸 | 子会话消息数 > **300** 时拒绝续用、引导新开（子会话永不压缩，历史线性增长需止损阀） | E2 5.3 |
| D8 | 错误三态文案 | 不存在 / 不属于当前会话 / 活跃中 分别给文案，均引导「去掉 sessionId 新开」 | E2 5.4 |
| D9 | 附件物化形态 | **合规新写入**：`action:"userAttach"` + `name = attachmentStorageName(storePath)` + `content:null`。**不可用 `attachFromPath` 的 basename name**——带 action 的 zod refine 硬要求 `name === attachmentStorageName(path)`，而 `messages.append` 走 `messageAttachmentsSchema.parse`（硬 parse 非 safeParse），照抄 basename 会 100% 抛错、子会话首条 user msg 落库炸掉 | E3 4 + R1 P0-2 |
| D10 | 路径列表出口 | 新增公共 `attachmentsFromPaths(paths)`：复用 `attachFromPath` 的**路径规范化部分**（`isPromptDirTokenPath` / `normalizePromptStorePath` / `tryNormalizePromptSeenPath` / image·binary 启发式 / type 分派）+ `mergeAttachmentsByPath` 去重；**name 一律覆写为 `attachmentStorageName(storePath)`、显式补 `action:"userAttach"`**；不导出私有函数本体 | E3 5.3 + R1 P0-2 |
| D11 | fileAttachment 预算制软闸 | **超限不报错、优雅降级**（2026-10-01 用户三轮改口）：条数 ≤ **20** 且 text 形态累计 ≤ **10 万 token 当量**——预算单位 = **明文当量字符，默认 100_000**（中文语料 1 字 ≈ 1 token ⇒ ≈ 10 万 token ≈ 300KB UTF-8 明文；英文按 ÷3.35 字符/token 约 3 万 token，CJK 优先的保守取向。常量可调；确认轮改值须同步 Step 11、T-TA3 与 Context Bundle）——**分配顺序 = `mergeAttachmentsByPath` 去重后的顺序**（重复声明不重复占名额），预算内文件正常挂附件全量加载；任一预算耗尽后的剩余路径**不挂附件**，由 task 层在传给子会话的 prompt 尾部拼「超预算路径清单 + 提示可用 read 与 offset/limit 分段读取」，子代理自行决定读取。**计量口径**：统一折算明文当量字符——inline 档 `size`（字符数）直接计入、blob 档 `size`（压缩字节数）×4 折算（4× 压缩比先例 `character-card-limits.ts`）；保守近似，允许实际注入量略超预算（精确计数需 O(全文) 读盘，与本迭代「省子会话 read」初衷相悖不取）；**image/binary 与目录不计字节——须按附件 type 显式跳过（image/binary 的 `findContentSize` 并非 null）；返回 null（目录 / 不存在）按 0 计，两者都仍占条数名额**。硬错误仅保留元素非法（空串） | 用户拍板（20 条 + 10 万 token 当量 + 降级不报错） |
| D12 | 回迁谓词 | `'"contentRef"'`（带引号键形态，JSON.stringify 转义论证过不会误命中正文）**+** 解析后无引用块的行归 `failedIds`（warn + 单独计数），双保险保收敛 | E4 5.1 |
| D13 | 部分索引 | **不建**（省「每条消息写一次全串 LIKE/instr 求值」；回迁一次性、存量行预计≈0，分批全扫可接受；取舍显式登记） | E4 5.5 |
| D14 | 存储页状态行 | **静默迁移**（无 UI 状态行，省 7 文件；存量行预计≈0、用户无感知；CHANGELOG 披露即可） | E4 4.4 |
| D15 | −1 与写回事务 | 单行「写回 content_json + ref_count −1」同一 `conn.transaction`，`tx` 句柄喂 repository（防 AsyncMutex 不可重入）；`delta<0` 命不中 no-op 时记 warn 区分坏行 | E4 5.3 |
| D16 | T-RR10 parity 口径 | 「逐字节 parity」断言**撤除**（兜底形态本就不逐字节等值）；改为「新写行 wire=全文直出、存量行=JSON 包」两态断言 | E1 风险4、E4 5.2 |
| D17 | REPO_MISSING 可观测性 | 兜底 hydrate 取不到 revision → 错误占位 JSON + `console.warn`（保留装配缺口信号） | E1 风险3 |
| D18 | KKV 命名 | module `nm-message-ref-unref`、key `unrefDone`（camelCase 惯例） | E4 4.1 |
| D19 | 回迁 × 压缩行交叠 | unref 谓词加 `AND content_blob IS NULL`（不碰压缩行、不走 decodeMessageContent——与解压兄弟任务抢同一行得不偿失）；**收尾否决条件仅一条：解压任务 KKV 标记（`nm-message-decompress/decompressDone`）未置**。不以「仍有压缩行」作否决——解压任务自身判据允许坏行残留稳态（leftover ≤ failedKeys 即置标记），双条件会永久锁死 unrefDone 与清理轮闸门；残留压缩行仅 warn 记 deferred 计数 | R1 P0-3 + R2 P1-1 |

## 最终项目结构

```
packages/core/src/
  domain/tool/builtin/subagent-tool.ts              # C：sessionId + fileAttachment 两参数、护栏、三态文案
  domain/tool/builtin/builtin-tool-context.ts       # A：摘 adjustRevisionRefCount；C：BuiltinToolSubagentContext + parentSessionId/isSessionRunActive、RunChildAgentOptions + attachments
  domain/tool/builtin/vfs-tools.ts                  # A：read 分支摘 refAnchored/+1/输出三件套
  domain/tool/builtin/skill-tool.ts                 # A：摘 anchorSkillResultRef 与输出三件套
  domain/tool/logic/build-tool-result-block.ts      # A：删 resolveRead/SkillResultRefFromOutcome，成功分支恒全文
  domain/tool/logic/format-tool-output.ts           # A：解除冻结契约注释
  domain/tool/logic/skill-read-truncation.ts        # A：仅改文件头措辞
  service/agent/create-agent-abort-registry.ts      # C：tryRegister claim 实现（端口 service/agent/agent-abort-registry.port.ts 同步登记新语义）
  domain/agent/session/agent-session.port.ts        # C：append options + attachments
  domain/agent/session/impl/in-memory-agent-session.ts        # C：跟随补字段
  service/agent/impl/chat-agent-session.ts          # C：append 透传 attachments
  service/agent/impl/ephemeral-overlay-agent-session.ts       # C：补字段（不静默丢）
  service/agent/logic/run-agent-turn.ts             # A：删通道；C：runChildAgent 物化附件 + 装配点新闭包
  service/chat/impl/message.service.ts              # 不改（−1 挂点保留）
  domain/chat/logic/hydrate-tool-results-for-prompt.ts  # A：重写为极简兜底
  domain/chat/logic/scan-at-path-attachments.ts     # C：新增 attachmentsFromPaths（规范化复用 + name 覆写 + action 补齐，D9/D10）
  domain/chat/logic/prepare-user-messages-for-prompt.ts  # C：workplaceSeenPaths 拆集合（attach seen 与 workplace 省略分离）
  service/workplace/assemble-workplace-display.ts   # C：prefixPaths 条件化（仅 full）
  infra/db-maintenance/impl/message-ref-unref.ts    # B：新建任务本体
  infra/db-maintenance/index.ts + src/index.ts      # B：导出（allowlist 快照同步）
packages/core/test/service/agent/read-ref-production-smoke.test.ts  # A：改写保留（P1-4）；亦为 AgentSession 端口扩散的测试内联实现点
apps/desktop/src/main/services/message-ref-unref.service.ts  # B：新建调度
apps/desktop/src/main/main.ts                       # B：一行挂接
apps/mobile/src/services/message-ref-unref.service.ts        # B：新建调度
apps/mobile/src/runtime/novel-master-context.tsx    # B：一行挂接
apps/cli/src/runtime.ts                             # B：内联 await
```

## 变更点清单

### A 线（unref 写侧回退 + 极简兜底）

按 E1 三分法的「① 本版」执行：`build-tool-result-block.ts`（删 L66-110 / L135-235 及 L456-458 调用，成功分支恒 `{ content: formatToolOutputForLlm(outcome.output) }`）、`vfs-tools.ts`（删 L229-247 refAnchored + L259-267 三件套 + outputSchema 三字段）、`skill-tool.ts`（删 SkillRefAnchor/anchorSkillResultRef L235-280 + 两分支调用 + 输出 spread）、`builtin-tool-context.ts` adjustRevisionRefCount、`run-agent-turn.ts` `resolveReadRefCountChannel` L201-223 + toolCtx 注入 L900/L915-920/L1274（**保留 runtime.revisionRepo**——兜底 hydrate 用）、`assemble-agent-runner-deps.ts`/`agent-runner.ts`/`create-agent-runner.ts` 通道摘除、`hydrate-tool-results-for-prompt.ts` 大改（删三个 replay + memo + hash 比对；`hydrateReadResultBlock` 改 JSON 兜底；`ReadResultHydrateError` 降级普通 Error）、`format-tool-output.ts` 解冻、`content-block.ts` 注释改「存量兼容 + 过渡期」。

**② 本版保留**（回迁完成前读路径必需，清理版再删）：`content-block.ts` 三类型、`parse-message-content.ts` 白名单（L113-277）、兜底 hydrate 骨架、`findByEntryAndVersion`/`findMetaByEntryAndVersion`、`revision-ref-count.ts` 全套口径函数、repair 三类期望值、五路径 −1 + fork/copy +1 挂点、desktop `ipc-types` contentRef + `messageBodyTextWithReadRefPlaceholder`、mobile `message-blocks-read-ref.test.ts`。

**A 线补遗**：① `build-tool-result-block.ts` 的删除面比行号清单略大——含 `isRecord` helper（L112-114）、`ReadResultRef`/`SkillResultRef` import（L12-15）、`content` 变量的成功分支消费点（L436 定义、L470/L489-491 使用）与 L488 注释；② `vfs-tools.ts` L229-247 为「注释 + hasRefAnchor（L237-240）+ refAnchored（L241）+ 同步 +1（L242-247）」整段；③ `test/service/agent/read-ref-production-smoke.test.ts` 属「**改写保留**」——通道推导断言随 Step 2 删、contentRef 落库断言改「全文直出无 contentRef」、parity 断言按 D16 撤除（该文件不在 T-RR/T-SR 编号组，不显式列名必漏改）。

### B 线（回迁任务）

骨架照 `message-content-decompression.ts`：谓词 = `content_json` 含 `'"contentRef"'` **且 `content_blob IS NULL`**（D19；三处同条件：主循环 SELECT / 入口探针 / 收尾 COUNT）；行级动作 = parse 出引用块（复用 parse 层）→ 逐块按 `(entryId, version)` `findByEntryAndVersion` 取明文（`contentStore.get(contentHash)`，hash 不匹配按可取回填并 warn）→ 内存组装 `{path, content}` JSON 写回 `content`（kind:"skill" 同款，`files` 等派生字段弃置）→ `aggregateReadRefs`（消息内 pair 去重、消息间累加）批量 −1 → 单行短事务（写回与 −1 同事务，UPDATE WHERE 带谓词幂等）；解析无引用块的假阳性行 → warn + failedIds（D12）；revision/blob 缺失与 status=deleted → 错误占位 JSON + failedIds；**收尾否决仅一条：解压兄弟任务的 KKV 标记未置（D19 单条件；压缩行残留只 warn 记 deferred、不作否决）；deferred 与 stalled 同款停手**——本进程 warn 记数后 return、下个冷启动按 KKV 重试，**不可把 deferred 当 `sleep(0)` 续轮**（先例调度循环只有 done/stalled 两个停手出口，deferred 落在「永不 done 也不 stalled」象限会变成永不退出的忙循环）；三端调度 + 守卫（`isXxxAgentActive`/`isXxxDbMaintenanceBusy`/`isCloudSyncBusy`）照先例；不挂 VACUUM、不建部分索引（D13）、无状态行（D14）。

### C 线（task 双参数 + S0 对齐）

接线 7 处（E3 §4）：subagent-tool 入参 → `RunChildAgentOptions.attachments` → `attachmentsFromPaths` 物化（name 覆写 D9/D10）→ run-agent-turn L1260-1264 子会话首条 user msg append 带 attachments → `AgentSession.append` 端口 + 3 实现类 + 测试内联实现。护栏：`BuiltinToolSubagentContext` 加 `parentSessionId` + `isSessionRunActive`；`tryRegister` claim（D5 落点 runChildAgent L1187）。S0：`assemble-workplace-display.ts` L170 `prefixPaths.push` 条件化 `entry.status === "full"` + 新增 `visiblePaths` 返回字段（L49-52 注释同步改、两处早退字面量补 `visiblePaths: []`），`prepare-user-messages-for-prompt` 增可选 `workplaceSeenPaths` 入参——初值 `workplaceSeen = createPromptPathSeenSet(runtime.workplaceSeenPaths ?? runtime.seenPaths)`（缺省回落 `seenPaths`，旧调用方与 T-PD8 零变化），`hydrateWorkplaceWithSeen` 判定改 `seen.has(x) || workplaceSeen.has(x)` 且**保留 `seen.add`**（attach 抢先 seen 与历史 workplace 抑制后续 attach 的既有语义不动），三处 seenPaths 消费方同步传双字段。description 精简增补两三句（详细引导靠 ToolError 文案，E2 5.8）。

## 详细实现步骤

- Step 1 — phase-unref-writeback — blocking: yes — qa: auto：A 线写侧回退（build-tool-result-block / vfs-tools / skill-tool 的产块与 +1 同批摘除 + outputSchema 三字段删，D1）
- Step 2 — phase-unref-writeback — blocking: yes — qa: auto：adjustRevisionRefCount 通道全链摘除（builtin-tool-context / run-agent-turn resolveReadRefCountChannel / 装配三件套；保留 revisionRepo）
- Step 3 — phase-unref-hydrate — blocking: yes — qa: auto：hydrate-tool-results 重写为极简兜底（JSON 包 + 错误占位 + warn，D17；保留「hydrate 早于孤儿拍平」顺序注释）
- Step 4 — phase-unref-hydrate — blocking: yes — qa: auto：unref 测试改写（**按文件列名不按编号**——`read-tool-result-ref` / `hydrate-tool-results` / `read-ref-count` / `read-ref-safety` / `read-ref-prompt-parity`（T-RR1~13 编号干净可沿用）+ `skill-result-ref.test.ts`（**T-SR 编号与 smart-sort 等特性撞号，禁止按编号检索**）；删逐字节 parity（D16）/ hash fail-fast / memo 用例，新增兜底形态用例；**含 `read-ref-production-smoke.test.ts` 改写**——通道断言随 Step 2 删、contentRef 落库断言改「全文直出无 contentRef」、parity 断言撤除）
- Step 5 — phase-migration — blocking: yes — qa: auto：回迁任务本体 `message-ref-unref.ts`（骨架 + 谓词 D12 + D19（`content_blob IS NULL` + 收尾否决仅「解压 KKV 标记未置」单条件）+ 同事务 D15 + KKV D18 + 探针 + failedIds 收敛；`MessageRefUnrefRunResult` 显式含 `deferred: boolean`（与 `stalled` 并列，停手语义进类型））
- Step 6 — phase-migration — blocking: yes — qa: auto：三端调度接线（desktop service + main.ts / mobile service + context / cli runtime，含 CLI 补注入 abortRegistry 的 D6 顺带核实）；**deferred 与 stalled 同款停手**——warn 后 return 等下个冷启动，禁 `sleep(0)` 续轮
- Step 7 — phase-migration — blocking: yes — qa: auto：回迁测试组（round-trip / ref_count 对账 / 同事务中断重跑 / 假阳性收敛 / 断点续跑 / 坏行占位 / 探针排除）
- Step 8 — phase-task-sessionid — blocking: yes — qa: auto：`tryRegister` claim（端口 `agent-abort-registry.port.ts` + 工厂 `create-agent-abort-registry.ts` 两文件，覆盖语义注释登记）+ registry 单测（不覆盖既有 controller）
- Step 9 — phase-task-sessionid — blocking: yes — qa: auto：task `sessionId` 参数（归属校验 D2 + 三态文案 D8 + 互斥 D5 + subagentName 必填 D3 + 历史软闸 D7 + description 精简；CLI `runtime.abortRegistry` 补注入见 D6——Step 6 顺带核实）
- Step 10 — phase-task-attach — blocking: yes — qa: auto：`attachmentsFromPaths` 公共出口（D10：复用规范化、name 覆写）+ `AgentSession.append` attachments 端口扩展（3 实现类 + 测试内联实现，ephemeral 不丢）；**本 Step 出口条件含全仓 typecheck**（结构化实现 AgentSession 的对象字面量一处不漏，不押到 Step 14）
- Step 11 — phase-task-attach — blocking: yes — qa: auto：task `fileAttachment` 参数（物化 D9 + 预算制软闸 D11：`BuiltinToolSubagentContext` 增内容尺寸查询闭包（装配点 `run-agent-turn.ts:1247` 已有 `runtime.sessionVfs(...)`，绑 `vfs.findContentSize` 即可）；**先物化去重、再按 `mergeAttachmentsByPath` 去重后顺序**分配「20 条 + 100_000 明文当量字符（≈10 万 CJK token）」双预算（inline 计字符、blob 压缩字节 ×4 折算、null 按 0 计、**image/binary 与目录按附件 type 显式跳过不计字节**），预算内挂附件、超限路径拼 prompt 尾注（含 read/offset/limit 提示）；透传 + 子会话首条 user msg 落库）
- Step 12 — phase-s0-align — blocking: yes — qa: auto：S0 双读改造（prefixPaths 仅 full 入集 + visiblePaths/workplaceSeenPaths 并入双读判定 + 缺省回落 seenPaths）+ 回归（header 配置目录 attach 得全文 / full 目录仍 alreadyReferenced / workplace 历史附件仍省略（T-S04）/ **T-PD3 / T-PD4 / T-PD8 / T-SR6 四条共享 seen 语义用例原样通过** / assemble 侧既有 `prefixPaths` 断言（5 处）保持绿 + 两处早退补 `visiblePaths: []`）
- Step 13 — phase-docs — blocking: no — qa: manual_user：CHANGELOG（1.5.30 段，勿照抄 v1.5.28 双 `### 变更` 瑕疵）+ RULE.md 术语更新（read 引用条目改写为历史概念 + task 双参数 + S0 口径）+ 存储体积披露（回迁后 content_json 回增，量级≈存量 ref 行、预计≈0）
- Step 14 — phase-verify — blocking: yes — qa: auto：全量验证（core `npm test` 含 globstar / desktop 收集器双引号 glob + `--test-concurrency=2` / mobile `--maxWorkers=2` / 三端 typecheck / `main-entry-allowlist.json` 快照 / 改动过 dist 的包重建后跑依赖 app 测试）
- Step 15 — phase-verify — blocking: no — qa: manual_user：真机验收（task 续用连续两轮 + fileAttachment 挂 chips + 老会话复制投影从 `[read ref: path]` 变化确认）

依赖关系：Step 1+2 必须同批合入（产 ref 与 +1 原子）；Step 3 依赖 1；Step 5 依赖 3（复用兜底取数逻辑）；Step 9 依赖 8；Step 11 依赖 10；A/B 与 C 线（8-12）可并行开发。

## 测试策略

### 测试用例

**unref 线（改写既有 + 新增）**

- T-UA1 — blocking: yes — Step1/2：read 新结果存全文（6 位行号）且 `content_json` 无 `contentRef` 键；skill load/read 同款（牙齿：实现改回产 ref 即红）
- T-UA2 — blocking: yes — Step2：read/skill 执行前后 revision `ref_count` 不变（新增 +1 摘除断言）
- T-UA3 — blocking: yes — Step3：兜底 hydrate——存量 ref 行 → `{path, content}` JSON 含 revision 明文、内存态、`content_json` 不写回；kind:"skill" 同款（files 字段弃置）
- T-UA4 — blocking: yes — Step3：revision/blob 缺失 → 错误占位 JSON + warn（REPO_MISSING 信号保留）
- T-UA5 — blocking: yes — Step1-3：存量 ref 行删除路径仍正确 −1（五路径抽查 delete / truncate-tail / deleteSessionTree）；新写全文行删除零 ref 调整
- T-UA6 — blocking: yes — Step3：孤儿拍平顺序（hydrate 先于 normalizeOrphan，空 content 不被拍成 `[tool_result]`）

**回迁线（新建 `packages/core/test/infra/message-ref-unref.test.ts`）**

- T-UM1 — blocking: yes — Step5：round-trip（回填 JSON 全等、谓词归零、KKV 置位）
- T-UM2 — blocking: yes — Step5：ref_count 精确对账——每 pair 恰 −1（aggregateReadRefs 口径：消息内 pair 去重、消息间累加；一消息两块同 pair 不多减）
- T-UM3 — blocking: yes — Step5：同事务性——注入 −1 失败断言写回也回滚；中断重跑无泄漏无双减
- T-UM4 — blocking: yes — Step5：假阳性收敛——正文含 `contentRef` 字面量行归 failedIds、任务收敛置标记、不 −1
- T-UM5 — blocking: yes — Step5：断点续跑（syncBudgetMs:0）/ 标记自愈（快照回灌）/ 入口探针 failedIds 排除（0/1/2 档）
- T-UM6 — blocking: yes — Step5：坏行**三**判别（revision 缺失 / blob 缺失 / status=deleted）→ 错误占位 + failedIds 排除；**hash 不匹配不算坏行**——按 B 线口径照常回填 + warn、不进 failedIds（与 D17/G2 的兜底收敛同口径，废除的 hydrate fail-fast 四码不复活）
- T-UM7 — blocking: yes — Step5：压缩行交叠——`content_blob IS NOT NULL` 且明文含 contentRef 的行不被本任务触碰；解压标记未置时任务**返回 `deferred=true` 且不置完成标记**（调度层据此停手，不 sleep(0) 续轮）；模拟解压完成（行解回明文 + KKV 标记）后该行被回迁、标记置位

**task-sessionId 线**

- T-TS1 — blocking: yes — Step9：续用——非空 sessionId 不新建会话、同 id 追加 user msg、result 的 subagentSessionId 同 id
- T-TS2 — blocking: yes — Step9：三态文案（不存在 / 非本会话子会话 / 跨 project / 活跃中）各自 ToolError 且引导去 sessionId 新开
- T-TS3 — blocking: yes — Step8/9：并发硬互斥——同 step 两 task 同 sessionId 一成一败；失败方文案引导；**claim 失败方不在子会话留下 user 消息**（D5 落点牙齿：tryRegister 在 session.append 之前）
- T-TS4 — blocking: yes — Step8：tryRegister 不覆盖既有 controller（registry 单测）
- T-TS5 — blocking: yes — Step9：历史软闸——消息数超限拒绝续用引导新开；depth≥2 摘除 task 不回归

**fileAttachment 线**

- T-TA1 — blocking: yes — Step10/11：物化形态（**预算内路径**）——子会话首条 user msg `attachments_json` 含 `source:"attach"` + `action:"userAttach"` + `name===attachmentStorageName(path)` + `content:null`；重复路径去重；**牙齿：name 写成 basename 即红（zod refine 硬抛，messages.append 走 parse 非 safeParse）**
- T-TA2 — blocking: yes — Step11：提示词（**预算内路径**）——子会话 prompt 出现 `<action name="userAttach">` 全文（非 S0 命中路径）；S0 命中（full 前缀已有）路径仍 alreadyReferenced
- T-TA3 — blocking: yes — Step11：预算制降级——预算内文件挂附件全量加载、超预算（条数或当量字符，含 blob×4 折算路径）文件**不挂附件**且子会话 prompt 尾部出现路径清单（含 read/offset/limit 分段读取提示）；image/binary 不计字节；空串元素 ToolError；**牙齿：改成全量挂载不降级即红**
- T-TA4 — blocking: yes — Step11：UI chips——**落 mobile**（子会话屏复用 ChatTranscriptWebView，chip 标签走 `row-logic.ts` 的 attachmentChipLabel）；desktop 无子会话渲染链，本版不覆盖
- T-INT1 — blocking: yes — Step9：同一子会话连续两次 run 的 UI in-flight 事件收口（E2 5.6 补测）

**S0 线**

- T-S01 — blocking: yes — Step12：`fillPolicy:"header"` 配置目录的文件 attach 得全文（不再被 S0 吞）
- T-S02 — blocking: yes — Step12：full 前缀已有路径 attach 仍 alreadyReferenced（默认配置行为不变）
- T-S03 — blocking: yes — Step12：T-PD3 原用例不动（seenPaths 显式注入语义保留）
- T-S04 — blocking: yes — Step12：显式 `fillPolicy:"header"` 目录的**历史 workplace 附件**（source:"workplace"）prepare 后仍 `content === ""`（省略语义不被 S0 改法破坏、不重复注入 header）

### 全量与假绿纪律

core 定向命令带 `--experimental-test-module-mocks --tsconfig tsconfig.test.json`；全量脚本确认 `-O globstar` 在位；desktop 收集器用双引号 glob（cmd 单引号假绿）；满负载性能护栏红先隔离复跑再判（`--maxWorkers=2` / `--test-concurrency=2`）；新导出同步 `main-entry-allowlist.json` 与 `tsconfig.test.json` paths；改 core 后重建 dist 再跑 app 测试。

## 风险与回滚方案

1. **摘 +1 漏一半**（最高危）：产 ref 与 +1 必须原子摘除（Step 1+2 同批），T-UA2 锁死。
2. **ref_count 误减是不可恢复方向**（提前 GC 删活 revision）：−1 只走 `aggregateReadRefs` 口径 + 与写回同事务 + `batchAdjustRefCountWithDelta` no-op 记 warn；T-UM2/T-UM3 双锁。repair floor 只上调不下调，兜底防误删；**回迁期间 repair 若并发上调 floor、回迁 −1 会将其抵消——可接受**（floor 上调只针对偏低行，回迁 −1 对应真实引用消失）；回迁任务运行期不并发跑 repair（守卫复用）。
3. **谓词假阳性热循环**：D12 双保险（带引号键形态 + failedIds 收敛），T-UM4 锁死。
4. **回迁与用户删消息竞态**：单行短事务 + UPDATE WHERE 谓词幂等（先例纪律），删除路径的 −1 与回迁 −1 由谓词退出互斥。**压缩行交叠**（D19）：谓词排除 + 收尾否决仅「解压 KKV 标记未置」单条件（不以压缩行残留否决——解压判据允许坏行稳态，双条件会死锁清理轮闸门），T-UM7 锁死。
5. **顺序红线**：必须「回迁完成 → 清理版才删三类化」；本版不动 parse/挂点/期望值。
6. **并发 claim 竞态**：tryRegister 单点原子（Map.has+set 同步段），T-TS3/T-TS4 锁死。
7. **续用子会话 token 线性增长**：D7 软闸止损；description 提示模型「需最新内容时用 read 验证」防凭记忆答。
8. **过渡期 UI 断层**：回迁完成前复制/搜索投影仍是 `[read ref: path]` 占位——可接受过渡态，CHANGELOG 披露。
9. **体积回增**：回迁后 content_json 变大（同 v1.5.29 解压披露口径），量级≈存量 ref 行（预计≈0，v1.5.29 装机窗口极短）。
10. **回滚**：整迭代 feature 分支可回退；已回迁行变 legacy 全文行，v1.5.29 读路径双形态天然兼容（回滚到 1.5.29 安全）；回迁任务幂等可中断。开发按 worktree 纪律（未经验证代码不进 main 工作区）。

## 后续清理轮（v1.5.31+ 另立迭代，此处仅立账）

E1 三分法「③ 清理版」全表：`hydrate-tool-results-for-prompt.ts` 整文件、`content-block.ts` 三类型、`public/chat.ts` ReadResultRef 导出、parse 白名单与辅助、`revision-ref-count.ts` 全套 + repair 降回两类 + `createRevisionRefCountRepairOperation` conn? 参数、五路径 −1 + fork/copy +1 挂点、desktop contentRef DTO 与占位函数、T-RR/T-SR 全体测试 + **`read-ref-production-smoke.test.ts` 整文件删**（本版「改写保留」→ 清理版删，与 A 线补遗 ③ 成对闭环）、`findMetaByEntryAndVersion`（若本版后无生产消费方）。**回迁任务保留作跳版安全网**（1.5.29 直升清理版用户靠任务兜底），任务本体按 V1' 节奏（约 10 tag）退役。清理前外部确认：`SELECT COUNT(*) FROM chat_message WHERE content_json LIKE '%"contentRef"%'` 归零 + KKV `nm-message-ref-unref/unrefDone` 已置。

---

## Context Bundle

```yaml
iteration_name: task-attach-unref
requirement_path: 用户口述（2026-10-01 本会话；决策链 docs/apm/memory/20260927-worktree-123-verify-guide.md）
spec_path: docs/Iterations/task-attach-unref/spec.md
explore_summary: >
  E1：contentRef 全链 37 文件三分法（本版回退/保留/清理版删）；产 ref 与 +1 原子性红线。
  E2：task/子会话 40 文件——接入点 subagent-tool.ts:205 与 run-agent-turn.ts:1260-1264；
  abortRegistry 无条件覆盖竞态需 tryRegister；子会话永不压缩。
  E3：附件链 62 文件——落库/hydrate/UI 三段零改动，最小接线 7 处；attachFromPath 私有需出口；
  S0 交互结论经主代理抽查修正（默认 tail1000=full，缺口仅显式 header/filename 配置）。
  E4：回迁骨架照 message-content-decompression；谓词假阳性双保险；−1 同事务；
  不建部分索引；静默迁移无状态行。
impact_files: [subagent-tool.ts, builtin-tool-context.ts, vfs-tools.ts, skill-tool.ts, build-tool-result-block.ts, hydrate-tool-results-for-prompt.ts, run-agent-turn.ts, agent-session.port.ts, chat-agent-session.ts, scan-at-path-attachments.ts, prepare-user-messages-for-prompt.ts, assemble-workplace-display.ts, create-agent-abort-registry.ts, agent-abort-registry.port.ts, read-ref-production-smoke.test.ts, message-ref-unref.ts(新), db-maintenance/index.ts, 三端调度接线]
constraints: [产ref与+1同批摘除, −1走aggregateReadRefs+同事务, 谓词带引号+content_blob_IS_NULL+failedIds收敛+收尾否决仅解压KKV标记未置, 回迁完成前parse/挂点/期望值保留, tryRegister硬互斥(落点runChildAgent_L1187先于append), S0双读(prefixPaths仅full入attach-seen+workplaceSeen并入双读判定+缺省回落seenPaths+保留seen.add), name覆写attachmentStorageName, fileAttachment预算制降级(20条+10万token当量≈300KB超限拼prompt尾注不报错), depth≥2摘除task不变, 不动schema不bump BOOT_VERSION]
blocking_steps: [1,2,3,4,5,6,7,8,9,10,11,12,14]
```
