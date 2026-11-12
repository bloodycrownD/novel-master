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
