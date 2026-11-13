---
date: 2026-11-13 15:20
title: web-search-curl 收口：v3 双端配置页 + CR 四轮 + settings i18n + v1.5.49 发布
keywords: web-search-curl, 搜索工具, v3, params-only, 认证三态, testEngine 退役, settings i18n, CR 第 4 轮, v1.5.49, tdbc-driver-rn
abstract: 搜擎模板与配置页定形 v3（内置只读、认证三态、schema params-only、testEngine 整链退役），CR 第 4 轮 29 条 must-fix 落地并收敛；settings 域 153 条文案双语化；取消信号通用化随 v1.5.49 发布，同批摘除死驱动依赖。
---

# web-search-curl 开发完成（dev-ready）

迭代：`docs/Iterations/web-search-curl/`（PRD + spec 三轮审查定稿）
分支：`feat/web-search-curl`（worktree `D:\worktree\web-search-curl`，base `9d912b6af`）

## 交付 commit（4 个）

- `9d912b6af` PRD + spec
- `855f6efa6` feat 主体：模板执行器 + 六出厂模板（bocha/tavily/brave/searxng/deepseek/zhipu）+ DDG 唯一代码兜底；四适配器退役；新 KKV 五键（enabledEngines/engineOrderV2/customEngines/presetOverrides/baseUrl 归并）；工具面 `query/engine(string)/maxResults/params` 自由透传 + 装配期 engineSnapshot 拼描述；双端配置页动态列表 + 开关 + 三分支详情 + curl 导入 + 草稿直测；存量不迁移
- `7956bea00` catalog 文案 + PRD 去「复制」+ iteration-state 六条偏离声明 + 16 节点 done
- `15d5fb5de` nm-code-style 收口（signatures 18 修 + inline 20 处置：真内联 9/keep-local 7/结构收敛 4——mobile/desktop 各引入 `writeOp` 单状态 + `runWrite` 模板收敛三处互斥写操作）

## 验证矩阵（终态全绿）

core 3386 / desktop 738 / mobile 2355 全量 0 fail；三端 typecheck 绿；renderer typecheck 基线本身 349 红为仓内既有债（Step6 用「搜索文件 0 错」增量判据通过）；check-style 四 UI 文件 PASS（7 处 KEEP_LOCAL 豁免有理由注释）；prettier/eslint 干净。未做：双端真机/桌面手动回归（spec Step 9 qa:manual_user，合并后用户验收）。

## 工作流执行情况（dwfrun-84b0689c→33e560ee→4a00d710→60f34c5c 四轮）

CreateWorkflow 12-phase 拓扑编排（Step1-5 core 串行每步 gate → Step6/7 双端并行 + core 功能小检 → 测试三分片并行 → 三端全测修绿 → 风格门 → 终检+文档 → 自动 commit），2h14m、50 步、1.6 亿 token。三轮事故均为环境/脚本形态坑（spawn ENOENT、循环内同名 agent、npm 多余 run），已记项目记忆 #237/#239。

**遗留脚本设计缺陷**：Step8b 三端未绿把 `allOk` 打掉后，Step8c 风格门整波被 `if (allOk)` 短路——但三端红随后被终检波修绿，风格门却没机会跑，终态 blocker 报告与真实残留错位（blocker 里 3 条已绿、真残留的风格反而不在门的输出里）。教训：**验收门之间不要用「上游全绿才跑下游」的短路链，门红只记 blocker、修复循环无条件跑**，终态由主代理复核裁定。本次真实收尾由两个并行子代理完成（风格 38 处 + 文案/声明）。

## 复核要点

workflow 终态 report 的 blocker 是过程快照非终态——主代理逐条到 worktree 实测复核（跑测试、grep 落点）后 5 条 blocker 中 4 条已闭合，仅风格+文案为真残留。

## 2026-11-14 补记：v2 透传改造 + CR 三轮收敛（e2e 后）

**方向反转**（用户 CR 中途指令）：v1 的「模板 + 响应字段映射」体系被判过度设计——引擎唯一目的是**构造请求 + 隐藏 AK**，响应直接透给 agent 自己读。坍缩终态：
- 模板五字段：name/method/url/headers（{{apiKey}} 唯一特殊处理，SKSP 现读）/**defaultBody（可选**，留空 agent 传 params）+paramHint
- 响应：递归找最长对象数组 → 50KB 内 JSON 文本直出（string[] 不算、空数组=成功、平局取先）；无数组=降级第三判据（接住 bocha 200+code 401 业务码失败）
- 删除：resultPath/fieldMap(title/url/snippet 候选)/answerPath/envelope 整族、UI 响应映射区、高级折叠、POST body 必填校验
- TestEngineSuccess → {preview(前2条JSON), resultCount?, truncated}；工具卡片摘要文本形态「引擎 · 响应文本」

**CR 三轮账**（每轮 5 审查者互盲同 wave）：
- R1：1 P1（预置有覆盖时测试按钮测出厂模板而非覆盖）+ ~27 P2 → W1-W6 六波修复（436b924c5），顺带透传 spec 落盘
- R2：1 P1（头名正则宽于 RFC7230 tchar，undici TypeError 绕过 engineFailed 通道）+ 12 P2（摘要文本分支缺失=双审查者独立撞出、mobile 零改动假成功、帮助一字差、文档 v1 残留）→ 5 波修复（e6ffe24fb）
- R3 收敛轮：13/13 闭合、三端全绿、verdict ready

**commit 总账**（feat/web-search-curl，base 9d912b6af）：855f6efa6 主体 → 7956bea00 catalog/PRD/偏离 → 15d5fb5de 风格收口 → 436b924c5 CR-R1 → 5f9438d0e v2 透传 → e6ffe24fb CR-R2。终态测试：core 3404 / desktop 745 / mobile 2366 全绿。

**经验**：
- 双端镜像文案（帮助弹窗/catalog 描述）由并行 agent 各自改写必漂移——收口时主代理必须逐字 diff；文案测试锁要锁整句片段而非关键词（本轮一字差逃过双端所有测试锁，靠人工 review 抓回）
- e2e adb 输入通道（华为拼音 9 键→切英文 IME 仍快发丢字）不可靠，长表单键盘输入链路测不了，靠 jest 单测兜底；真机 e2e 核心面（列表默认态/帮助/DDG 只读/bocha 详情+错误脱敏/保存/401/curl 解析预填）全过
- RFC 7230 头名 tchar 正则：`/^[A-Za-z0-9!#$%&'*+\-.^_`|~]+$/`（工单初稿漏 `_`，agent 按 RFC 完整集实现正确）——undici Headers 对 `[]",;()<>?@=\{}` 全抛 TypeError

## 2026-11-13 补记：v3 定形 + CR 第 4 轮 + settings i18n + v1.5.49 发布

**v3 五处反转**（用户在 CR 期间逐条指出，均落为拍板并写进 cr-fix-spec 顶部）：
- **内置引擎不可改名**（照内置服务商 UI）：名称/端点/参数说明出厂只读，用户只填 API Key；SearXNG 唯一例外（URL 即实例地址，可编辑）
- **认证从 headers 宏改三态下拉**：`Authorization: Bearer` / 自定义头名 / 无认证——`{{apiKey}}` 只留执行器内部，UI 不再手写宏；curl 导入自动识别 Bearer 与 `X-API-Key` 形态
- **schema 收口 `search(engine?, params)`**：搜索词按 `q`/`query`/`search_query` 三键探测（trim 空白跳过 + typeof 守卫），条数 `count`/`max_results`/`maxResults`；`paramHint` 限长整道拆除（用户：「谁让你限制 500 字的？解除」）
- **testEngine 整链退役**（双端测试搜索按钮 + core store 方法 + desktop IPC 五层）：省配额；顺带消解 v3 引入的「GET 无 `{{query}}` 模板 testEngine 必失败」P1
- **桌面端收 v3**（此前只改 mobile，CR 登记为 P1 双端分叉）：删 defaultBody 编辑、注入方式快捷选择、宏校验、测试搜索；预置模板字段全锁 → 覆盖不再被整键替换丢掉

**CR 第 4 轮**（补审 `e6ffe24fb..HEAD` 51 文件 +4872/−6044；5 域 + global 互盲、3 轮）：R1 38 条 → 29 条 must-fix（P0=0 / P1=8 / P2=21）+ 4 条 P3。CR 只产 fix-spec、修复由独立工作流落实（29 条全处置、门首轮全绿）；回归复核 5 域 1 ready、4 域残留 8 处卫生项，主代理逐条清掉（死 key 5 个撤到三方 148/148/148、`skill-read-truncation.ts` 悬空注释、`spec.md` engineBaseUrls 失真行、用例标题、两处头注、`engineHint` keep-local 理由）。

**settings 域 i18n**（`f34ffcbff`）：`SETTINGS_MESSAGE_KEYS` 153 条 + `settings.{zh-CN,en-US}.json` 双语真源 + `./settings` 包导出（含 allowlist 快照锁）+ 双端 translator，213 处替换。**坑：`createTranslator` 对裸字符串直通返回**——`settingsTranslator("key")` 会把 key 渲进 UI，必须 descriptor 形态 `{key}`（首轮 12 个测试红）；模块级译文常量还会在 import 期冻结 locale，本次统一改调用期求值。

**收尾清理**：`tdbc-driver-rn`（peerDep `react-native-quick-sqlite`）全仓零 import、仅剩 4 处死角引用 → 整包摘除 + `npm install` −14 包；同批清 mobile 构建缓存约 6.2G（app/build 4.8G + .cxx 1.2G + .appium/.gradle）。

**v1.5.49 发布**（`033a64a77`）：desktop/mobile `package.json` 与 `build.gradle` fallback 三方一致 1.5.49，CHANGELOG 把 Unreleased 整理成本版并补取消信号/卡片摘要/锁定小字/双语真源/死驱动五条；tag `v1.5.49` 推送触发 CI（Android APK / Windows NSIS / macOS DMG）。门：三端 typecheck 0、三端全量测试全绿、check-style signatures/inline/methods PASS、`prettier --print-width 200` 干净、desktop 与 mobile 构建 0。

**backlog**：`params.count ?? params.max_results` 在 count 为字符串时短路 `??` 链（`max_results` 轮不到、落默认 5）；已用测试锁现状，改 typeof 感知回落属另一条实现条目。
