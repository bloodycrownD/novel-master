# D1-11：L11 文档与代码漂移

> 角度横扫报告（readonly）。覆盖仓库内所有「声称描述当前代码」的文档与实际代码状态的一致性。
> 依据：`docs/review/guides/lens-L11-doc-drift.md` + `docs/review/phase0/D0-2-docs-index.md`。
> 主要输入：`docs/monorepo.md`、`packages/core/ARCHITECTURE.md`、`README.md`、`CHANGELOG.md`、`AGENTS.md`、`examples/` 全量、`apps/cli/package.json`、根 `package.json`、移除型 Iterations 的 spec。

## 元信息

- 角度：L11 文档与代码漂移
- 仓库扫描范围：上述文档 + 各 `package.json` 的 scripts/exports/workspaces + 三个 example yaml 对应的 zod schema
- 严重度参考：S/A/B/C（见指导文档 §严重度参考）
- 关键交叉文件：`docs/review/phase0/D0-2-docs-index.md`（151 Iterations 摇摆度归类）、`docs/review/phase1-lens/D1-03-architecture.md`（L3 已就 facade 与 documented exception 给出结论）

---

## 结论

诶～这个角度扫下来，仓库里**文档可信度的最大坑就在 `docs/monorepo.md`**，而且不是一两条小误，是整张表的承诺几乎全错——脚本不存在、导出清单少 19 条还多列了 1 条不存在的、布局表把一个真实存在的 `apps/desktop` 直接漏掉、却凭空捏了一个 `scripts/vfs-test-sync` 包。这份文档是新人入门第一站，按它跑 `npm run vfs:watch` 立刻报错，按它找 `./front-matter` export 也找不到，伤害非常直接，所以这一条得整体判 A，不是分散成 B。

第二圈是 examples/。`examples/README.md` 自称是「纯 HTML/CSS/JS 的 UI 原型」、还挂着「🔄 待实现」的功能对比表——但项目早就用 RN + Electron 真刀真枪实现了，这份原型已经成了陈年幻影，留着只会让人误以为它还是当前 UI 的参考实现。三个 example yaml 里更严重的是 `events.yaml`：它写的是 `schemaVersion: 1` 加 `{ mode, actions: [...] }` 的旧结构，而当前 `events-config.schema.ts` 是 strict schema、只接受 `schemaVersion: 2`、action 节点必须是 `{ "hide-message": {...} }` 这种单键形式——直接拿这个 yaml 喂给现在的 parser 必然抛错。`agents.yaml` 和 `compaction-conditions.yaml` 倒是对得上 schema 的，没漂移。

第三圈是 L3 已经摸到的「两层 facade」事实与文档措辞的错位。`docs/monorepo.md` 第 65 行还在说「子路径 export 只有 5 个、避免从根 `index.ts` 拉全量桶」，这种描述对应的是单层 facade 时代；而现在 core 已经是 `src/index.ts`（基础设施）+ 13 个 `src/public/<ctx>.ts`（领域语境）的两层结构，subpath export 实际 24 条。`packages/core/ARCHITECTURE.md` 那张分层图本身没错，但里面的 documented exceptions 第 2 条引用的 `domain/compaction/action/default-compaction-action.ts` 早就随着 `compaction` 改名 `compaction-conditions` 一起消失了——这条 L3 已经标过，这里从「文档完整性」角度补充确认。最后还有一类很隐蔽但很广的漂移：仓库里大量历史 spec 和 README/ARCHITECTURE 里的内部链接指向 `.apm/kb/docs/...`，而 `.apm/` 已经从 git 跟踪里移除了（最近一次提交就是「移除 git 对 .apm/ 的跟踪」），新人 clone 下来这些链接全是死链，得自己猜到 `docs/...` 才能找到对应文件。

CHANGELOG 与代码状态这一块倒还好：1.4.15 说「CLI 降级为本地测试用途」，但 `apps/cli/package.json` 仍然保留 `bin: { novel-master, nm }`、根 `package.json` 仍然有 `link:cli` 脚本——这看起来矛盾，但其实是「CLI 工具链没拆掉、只是不再作为对外发布产品」的语义降级，措辞模糊但不算硬漂移，判 C 级提示即可。`AGENTS.md` 这边不描述结构、只描述人格风格，跟代码结构对不上号这件事本身不构成漂移。

**总评**：这份仓库的源码纪律很强（L3 已确认），但文档纪律明显落后于代码演进——尤其是 monorepo.md 和 ARCHITECTURE.md 的局部条目，几乎每改一次大架构都没回填文档。这种漂移会反向污染其他 9 个角度：L1/L4/L6 等如果拿 Iterations 的 spec 或 monorepo.md 当锚点，需要先看本报告的「spec 信任度降级清单」打折扣。

---

## 文档漂移清单

| 文档 | 位置 | 文档声明 | 实际状态 | 严重度 |
|------|------|----------|----------|--------|
| `docs/monorepo.md` | L20-22 | `npm run vfs:watch` / `vfs:push` / `vfs:pull` / `vfs:sync` 可用 | 根 `package.json` 的 scripts 里**全部不存在**（只有 build/dev/test/lint/link:cli/mobile:*/desktop:*） | A |
| `docs/monorepo.md` | L55 | 「同步脚本：`npm run vfs:watch`」 | 同上，脚本不存在 | A |
| `docs/monorepo.md` | L11 | `scripts/vfs-test-sync` 是 `@novel-master/vfs-test-sync` 包 | `scripts/` 下只有 4 个 `.mjs` 文件，**无此目录、无此包**；root `workspaces` 也只声明 `packages/*` + `apps/*` | A |
| `docs/monorepo.md` | 布局表 L5-11 | 列 5 个 workspace：core / tdbc-driver-* / cli / mobile / vfs-test-sync | 实际 14 个 workspace：少列了 `apps/desktop`、`packages/cloud-sync-driver-s3`、`packages/sksp-{android,mac,windows}`、`packages/tdbc-conformance`、`packages/tokenizer-driver-{node,rn}`，多列了不存在的 `scripts/vfs-test-sync` | A |
| `docs/monorepo.md` | L65 | core 子路径 export 只有 5 个：`./tdbc` `./sksp` `./nmtp` `./front-matter` `./kkv` | `packages/core/package.json` 实际 **24 条 exports** | A |
| `docs/monorepo.md` | L65 | 包含 `./front-matter` export | 实际不存在该子路径（core package.json、src/public/ 都没有） | A |
| `docs/monorepo.md` | L65 | 未提及 `./agent` `./chat` `./compaction` `./events` `./prompt` `./provider` `./regex` `./message-checkpoint` `./session-fs` `./vfs` `./workplace` `./format` `./feature-flags` `./session-kkv` `./config-forms[/...]` 等 | 上述子路径实际都存在并对外暴露 | A（清单错误：缺漏） |
| `docs/monorepo.md` | L65 | 「避免从根 `index.ts` 拉全量桶」描述单层 facade | 实际是两层 facade：`src/index.ts`（基础设施）+ 13 个 `src/public/<ctx>.ts`（领域语境 barrel）—— L3 已确认 | B（描述过时） |
| `docs/monorepo.md` | L66 | Repository 实现目标目录迁移约定（`domain/*/repositories/impl` → `infra/*/repositories`） | 当前 `domain/*/repositories/impl/sqlite-*.repository.ts` 仍是默认摆放（agent/provider/chat 等都有），迁移未发生；ARCHITECTURE.md 反而把这种摆放列为 documented exception | B（描述过时/约定未执行） |
| `docs/monorepo.md` | L77-80 | 迭代文档路径为 `.apm/kb/docs/Iterations/<名称>/prd.md`、`spec.md`；`.apm/` 为本地工作区 | Iterations 文档实际已迁入 `docs/Iterations/`（git 跟踪）；`.apm/` 已从 git 移除，新 clone 不存在 `.apm/kb/docs/` | B（路径失效） |
| `docs/monorepo.md` | L9 | `apps/cli` 提供 `novel-master` / `nm`（`npm link`） | 与代码一致（bin 仍在），但与 CHANGELOG 1.4.15「CLI 降级为本地测试用途」语义模糊——见下条 | C（措辞模糊） |
| `README.md` | L99 | 「内部文档：[`.apm/kb/docs/monorepo.md`](.apm/kb/docs/monorepo.md)」 | `.apm/kb/docs/monorepo.md` 不存在；实际文件在 `docs/monorepo.md` | B（链接失效） |
| `packages/core/ARCHITECTURE.md` | L3-4 | 引用 `.apm/kb/docs/Iterations/core-package-structure/{spec,prd}.md` | 实际文件在 `docs/Iterations/core-package-structure/`；`.apm/` 路径不存在 | B（链接失效） |
| `packages/core/ARCHITECTURE.md` | documented exceptions 第 2 条（L59） | `domain/compaction/action/default-compaction-action.ts` 可 import `infra/prompt-template`、`infra/date-format` | 文件不存在：整个 `domain/compaction/` 已改名 `domain/compaction-conditions/`，新目录下无任何文件 import 这两个 infra 模块——L3 已确认这是历史残留 | B（描述过时） |
| `examples/README.md` | L1-3, L79-94 | 自称「移动端/桌面端 UI 原型，纯 HTML/CSS/JS 实现」；功能对比表标「服务商管理 / 压缩策略 / 正则配置 🔄 待实现」 | 实际产品已用 RN（mobile）+ Electron（desktop）实现，provider/compaction/regex 域在 core 与 apps 中均已落地；原型已陈年过时 | A（描述过时 + 示例失效） |
| `examples/events.yaml` | 全文 | `schemaVersion: 1`；结构为 `events.<name>: { mode: parallel, actions: [{ type: hide-message, params: {...} }] }` | 当前 `events-config.schema.ts` 为 **strict**、要求 `schemaVersion: z.literal(2)`；action 节点必须是单键形式 `{ "hide-message": { "start-depth": 6 } }`，且顶层没有 `mode` 字段——直接喂给 parser 会因 strict + literal 双重失败 | A（示例失效） |
| `examples/agents.yaml` | 全文 | `schemaVersion: 1`；多 agent bundle，writer/summarizer 各带 prompts.persist/dynamic | 与 `apps/cli/src/agent/schemas/agents-bundle.schema.ts` + core 的 `promptsDocumentSchema` 一致，可正常解析 | —（无漂移） |
| `examples/compaction-conditions.yaml` | 全文 | `schemaVersion: 3`；`enabled: true`；`tokenRatio: 0.8`；`visible-floor: 20` | 与 `compaction-conditions.schema.ts` 一致（schema 同时接受 kebab/camel visible-floor，tokenRatio ≤ 1 ✓） | —（无漂移） |
| `CHANGELOG.md` | 1.4.15「变更」 | 「CLI 降级为本地测试用途」 | `apps/cli/package.json` 仍声明 `bin`，根 `package.json` 仍有 `link:cli`——CLI 工具链没拆，只是对外定位变了，措辞容易让人误以为 bin 已删 | C（措辞模糊） |
| `README.md` | L12-21（截图） | `assets/desktop.png` / `assets/mobile.png` 展示当前 UI | 截图最后修改 2026-06-07；CHANGELOG 显示 1.4.15（08-03）大改会话详情页、1.4.16（08-04）新增聊天记录查询——近两个月 UI 大改后截图未更新 | B（截图过期） |
| `AGENTS.md` | 全文 | 仅描述回复风格，不描述代码结构 | 与代码结构无关，不构成漂移 | —（不适用） |
| Iterations `vfs-zip-native-compression/spec.md` | 全文 | 以「新增 native ZIP 打包」的实现语气描述（增加 buildZip 注入、Mobile 用原生 ZIP 替代 fflate） | 该功能已被 `remove-mobile-vfs-zip-native` 完整移除（fflate STORE 为唯一实现）；spec 未追加「已撤销」标注 | B（spec 仍以实现语气描述已移除功能） |

---

## spec 信任度降级清单（交给 phase3）

| Iteration / 文档 | spec 过期程度 | 对其他角度的影响 | 建议 |
|------------------|---------------|------------------|------|
| `vfs-zip-native-compression/spec.md` | 高——以「feature 引入」语气描述一个已被 `remove-mobile-vfs-zip-native` 整体撤销的能力 | L1/L2/L6 若引这条 spec 推断「当前 VFS 还存在 native buildZip 注入点」会全错；实际只剩 fflate STORE 一条路径 | 引用时降权；以 `remove-mobile-vfs-zip-native/spec.md` 为准 |
| `docs/monorepo.md` 整体 | 高——脚本/export/布局表系统性错误 | L3/L8 拿它当 monorepo 结构锚点会被误导（特别是 export 数量、facade 层数）；L5/L6 拿 vfs 脚本当并发/同步流程锚点会扑空 | **不建议作为任何角度的结构锚点**；优先以 root `package.json` + `packages/core/package.json` + L3 报告为准 |
| `examples/events.yaml` | 高——schema 版本与结构都已过期 | L1/L4 若拿它当 events-config 样例验证 schema 行为会直接抛错 | 降权；以 `packages/core/src/domain/events-config/model/events-config.schema.ts` 与 `default-events.ts` 为准 |
| `packages/core/ARCHITECTURE.md` 第 2 条 documented exception | 中——单条失效，其余七条 L3 已逐条核对仍有效 | L3 引用 documented exceptions 时跳过本条即可；不影响其余分层结论 | 仅本条降权 |
| `README.md` 内部文档链接（L99） | 中——链接指向已不存在的 `.apm/` 路径 | L1-L8 顺着链接找文档会失败 | 跟踪时改走 `docs/...` |
| `remove-mobile-vfs-zip-native/spec.md` | 低——明确以「移除」语气书写，作为历史记录无误 | L1/L4 可正常引用 | 不降权 |
| `message-rollback-remove-session-log/spec.md` | 低——以「移除 session log + 重设计 rollback」语气书写，与代码现状一致（`session_execute_batch.message_id` 仍在、SessionLog 已删） | L4 可正常引用 | 不降权 |

---

## 发现清单

### A `docs/monorepo.md` 系统性失真

- 位置：`docs/monorepo.md` 全文（L5-80）
- 问题：根脚本表（L20-22）、布局表（L5-11）、core exports（L65）三处声明与代码三处不符——`vfs:watch/push/pull/sync` 全部不存在；`scripts/vfs-test-sync` 包不存在；`./front-matter` export 不存在；实际 24 条 export 文档只列 5 条；`apps/desktop` 等多个真实 workspace 漏列。
- 依据：根 `package.json`（仅 build/dev/test/lint/format:check/test:core:fast/check:*/clean/link:cli/mobile:*/desktop:*）；`scripts/` 实际目录列表（仅 4 个 .mjs）；`packages/core/package.json` exports（24 条，无 `./front-matter`）；`apps/` 与 `packages/` 实际目录（共 14 个 workspace）。
- 建议：不改代码。建议在 fix-spec 阶段把 monorepo.md 整张表重写——脚本表删除 vfs:* 四行、布局表补齐 `apps/desktop` 与各 driver/sksp/cloud-sync/tokenizer 包并删除虚构的 `scripts/vfs-test-sync` 行、exports 改为「24 条 subpath，详见 packages/core/package.json」并删除 `./front-matter`。短期至少在文件顶部加一行「本文档可能落后于代码，以 package.json 为准」。
- 涉及角度：L3 / L8 / L6（vfs 同步脚本相关）

### A `examples/events.yaml` 与当前 schema 不兼容

- 位置：`examples/events.yaml` 全文
- 问题：`schemaVersion: 1` 与 strict schema 的 `z.literal(2)` 冲突；结构 `{ mode: parallel, actions: [{ type, params }] }` 与 strict schema 期望的 `{ events: { <name>: [{ "hide-message": {...} }] } }` 冲突。直接 `eventsConfigSchema.parse(yaml)` 会同时报 literal 与 strict 两种 issue。
- 依据：`packages/core/src/domain/events-config/model/events-config.schema.ts` L151-171（`schemaVersion: z.literal(2)` + `.strict()`）；L99-148（`parseActionNode` 期望单键对象）。
- 建议：把 yaml 重写为 `schemaVersion: 2`，事件体改成直接的 action 数组（如 `session.compaction.requested: [{ "hide-message": { "start-depth": 6 } }]`），删除 `mode` 字段。
- 涉及角度：L1（数据模型）/ L4（events 触发链）

### A `examples/README.md` 已成陈年幻影

- 位置：`examples/README.md` 全文
- 问题：自称「纯 HTML/CSS/JS UI 原型」、功能对比表把 provider/compaction/regex 标为「🔄 待实现」，但实际产品已用 RN + Electron 实现，三块功能在 core 中均有 schema 与 service。
- 依据：`packages/core/src/domain/provider/`、`domain/compaction-conditions/`、`domain/regex/` 均已落地；`apps/mobile`、`apps/desktop` 是真实实现而非原型。
- 建议：要么整体归档到 `examples/_archive/prototype-html/` 并在 README 顶部声明「历史原型，不再代表当前 UI」，要么直接删除以免误导。功能对比表至少要把 provider/compaction/regex 的「🔄」改成「✅（在 apps 中实现）」。
- 涉及角度：L6（跨端一致性）/ L7（若有人拿原型当测试基线）

### B `packages/core/ARCHITECTURE.md` documented exception 第 2 条失效

- 位置：`packages/core/ARCHITECTURE.md` L59
- 问题：引用 `domain/compaction/action/default-compaction-action.ts`——该路径不存在；`domain/compaction/` 整体已改名 `domain/compaction-conditions/`，新目录下没有 action 子目录，也没有任何文件 import `infra/prompt-template` 或 `infra/date-format`。
- 依据：`packages/core/src/domain/` 实际目录列表（只有 `compaction-conditions`，无 `compaction`）；L3 报告已确认。
- 建议：删除该条例外，或改写为指向当前真实存在的 import 关系（如有）。
- 涉及角度：L3（架构）

### B 内部文档链接批量指向已移除的 `.apm/kb/docs/`

- 位置：`README.md` L99、`packages/core/ARCHITECTURE.md` L3-4、`docs/monorepo.md` L77-80（以及大量 Iterations spec 顶部的 PRD 相对链接，未逐一核对）
- 问题：仓库最近一次提交「移除 git 对 `.apm/` 的跟踪，补充 docs/ 其余文件」之后，`.apm/kb/docs/` 在新 clone 上不存在，但仍有文档把迭代/monorepo 文档路径写成 `.apm/kb/docs/...`。实际文件现在 `docs/...`。
- 依据：本地验证 `Test-Path .apm\kb\docs\monorepo.md` = MISSING，`Test-Path docs\monorepo.md` = EXISTS；同结果适用于 `Iterations/core-package-structure/spec.md`。
- 建议：把所有 `.apm/kb/docs/` 引用替换为 `docs/`。这是一次性 mechanical replace，可在 fix-spec 阶段一并处理。
- 涉及角度：所有 L1-L8（拿文档当锚点时都会被死链绊到）

### B `vfs-zip-native-compression/spec.md` 仍以实现语气描述已移除功能

- 位置：`docs/Iterations/vfs-zip-native-compression/spec.md` 全文
- 问题：spec 详细描述「Core 增加可插拔 buildZip 注入」「Mobile 用原生 ZIP 替代 fflate」的实现步骤，但该能力已被 `remove-mobile-vfs-zip-native` 完整撤销（fflate STORE 为唯一打包实现，注入点删除）。spec 头部没有「已撤销 / 被某迭代取代」的标注。
- 依据：`remove-mobile-vfs-zip-native/spec.md` 明确「唯一打包实现为 buildVfsZip（fflate STORE）」；`vfs-zip-io.service.ts` 实际已无 buildZip 字段。
- 建议：在该 spec 头部加一行 `> ⚠️ 本迭代已被 remove-mobile-vfs-zip-native 整体撤销，保留作历史记录`，避免其他角度误读。其他「引入后被移除」的迭代可对照 D0-2 摇摆度表逐一筛查（本角度未逐一核对全部 151 个）。
- 涉及角度：L1 / L2 / L6（vfs 模块）

### B `README.md` 截图落后于近两次大 UI 迭代

- 位置：`README.md` L12-21；`assets/desktop.png` / `assets/mobile.png`
- 问题：截图最后修改 2026-06-07；CHANGELOG 显示 1.4.15（08-03 会话详情页 QQ 式重构 + 单聊级 agent/model 配置）和 1.4.16（08-04 聊天记录查询）是近两次明显改 UI 的迭代——截图早了近两个月。
- 依据：`git log -1 -- assets/desktop.png assets/mobile.png` = 2026-06-07；CHANGELOG 1.4.15/1.4.16 日期与内容。
- 建议：在 1.4.17 或下一次发版前重拍桌面端与移动端截图（须包含会话详情页与聊天记录查询入口）。
- 涉及角度：L6（跨端 UI 一致性，截图作为「应该长这样」的锚点已不可信）

### C CHANGELOG「CLI 降级」措辞与 bin 仍在的事实存在张力

- 位置：`CHANGELOG.md` 1.4.15「变更」段；`apps/cli/package.json` L6-9
- 问题：CHANGELOG 写「CLI 降级为本地测试用途」，但 `apps/cli/package.json` 仍声明 `bin: { novel-master, nm }`，根 `package.json` 仍有 `link:cli`——新人读 CHANGELOG 会以为 bin 删了。
- 依据：上述两文件。
- 建议：在 CHANGELOG 该条后补一句「（`nm` 全局命令仍可用，但不再作为对外发布产品）」，或在 monorepo.md 标注 CLI 的当前定位。
- 涉及角度：L8（API 稳定性，CLI 表面是否还承诺）

---

## 覆盖声明

查了：`docs/monorepo.md` 全文逐行、`README.md` 全文、`packages/core/ARCHITECTURE.md` 全文、`AGENTS.md` 全文、`examples/` 下 README + 三个 yaml + 目录结构、根 `package.json` + `packages/core/package.json` + `apps/cli/package.json` 的 scripts/exports/bin、`packages/core/src/domain/events-config/model/events-config.schema.ts`、`packages/core/src/domain/compaction-conditions/model/compaction-conditions.schema.ts`、`apps/cli/src/agent/schemas/agents-bundle.schema.ts`、`packages/core/src/domain/agent/model/agent-definition.schema.ts`（用于核对三个 example yaml 是否仍能解析）、移除型迭代 `remove-mobile-vfs-zip-native` 与 `message-rollback-remove-session-log` 的 spec 全文、`vfs-zip-native-compression/spec.md` 头部、`CHANGELOG.md` 1.4.01-1.4.17 段、`assets/` 截图的 git 最后修改时间。

没查：151 个 Iterations spec 的逐一核对（只抽查了指导文档点名的 3 个 + 1 个被撤销的）——`docs/Iterations/` 下可能还有其他「被后续迭代取代但 spec 未标注」的情况，建议在 phase2 切片深挖时由切片子代理顺手标记；`examples/mobile/` 与 `examples/desktop/` 内的 HTML/CSS/JS 原型代码本身（只看了顶层 README，因为漂移判定已经足够）；`docs/review/` 自身的文档（不属于本仓库「描述当前代码」的文档范畴）。

---

## 待交叉的线索

- **与 L3 的互补**：L3 已经从架构角度判了 documented exception 第 2 条失效与两层 facade 事实；本报告从「文档完整性」补充——这两条都应进入 phase3 的冲突矩阵，避免其他角度继续按过期描述推断。
- **与 L8 的互补**：L8 看 index.ts 的导出表面，本报告看文档对导出的描述——`docs/monorepo.md` 列 5 个而实际 24 个这条，建议 L8 在判 API 稳定性时直接以 `packages/core/package.json` exports 为准，跳过 monorepo.md。
- **与 L1/L4 的冲突预期**：如果 L1 或 L4 在 events-config 相关判定中引用了 `examples/events.yaml` 作为「正常样例」，需要降权——这份 yaml 现在跑不动。
- **可能升级到 S 的污染效应**：本角度本身无 S 级，但 monorepo.md 的系统性失真会在 phase3 交叉阶段放大——任何「按文档跑命令」类的发现都需要回填校验。
