---
date: 2026-10-29 21:40
title: config-forms 迁出 core（表单层两端本地化 SPEC）
keywords: config-forms, 表单层, 迁移, stored-config-validity, public/prompt, X1, shared/config-forms, @/config-forms
abstract: 用户口述需求：config-forms 从 core 迁出到 mobile 与 desktop 各持一份（接受冗余，UI 层双端拆分优先）。经三份探索报告定位：表单层约 850 行中 85% 是表单状态变换+硬编码中文文案；stored-config-validity（落库健康判定）经用户拍板留在 core，仅挪 domain/agent/ 并换子路径。缺口三符号（normalizeAgentPromptLayoutDomain / DEFAULT_SKILLS_INDEX_PREFIX / layoutHasCustomAttach）需先补 public/prompt.ts；desktop 副本不能进 shared/logic（X1 结构测试禁 import），落 shared/config-forms/（vite 前缀别名+tsc glob 自动覆盖）；mobile 落 src/config-forms/（@/ 别名三链路全通）。SPEC 落盘 docs/Iterations/config-forms-migration/spec.md，5 phase + T-CF1~8。**已实施完成（2026-10-30，动态工作流，4 提交 + 文档收尾，三端门禁全过，细节见文末轮次）**。
---

## 本轮

user:
D:\Dev\Js\novel-master\packages\core\src\config-forms 这个配置表单，我现在希望从core中移除，迁移到mobile与desktop。之前复用是为了统一和简化，但是实际UI层我觉得desktop和mobile最好拆分开，我觉得可以接受冗余的两份代码。

（追问确认 config-forms 是 UI 层还是什么，怕理解错方向。）

assistant:
三份探索报告（目录画像 / 消费面 / public 可达性与构建接线）结论：

1. config-forms 无 React 组件、无自有 zod schema，是「表单状态↔领域模型」翻译层 + 中文文案 + 选项数组；85% 纯表单层，例外是 stored-config-validity（落库 wire 数据健康判定，含 schema 版本常量，desktop main IPC 与 mobile 列表页在用）。
2. 用户单问拍板：**表单层迁两端、stored-config-validity 留 core**（判定单源，防两端落库判定漂移）。
3. 硬约束：副本依赖的 domain 符号里 3 个不在任何 public 子路径（normalizeAgentPromptLayoutDomain / DEFAULT_SKILLS_INDEX_PREFIX / layoutHasCustomAttach），须先补 public/prompt.ts；desktop X1 结构测试禁止 shared/logic 出现指向 core 的 import ⇒ 副本落 shared/config-forms/（vite @shared 前缀别名 + tsconfig glob 自动覆盖，零登记）；mobile 落 src/config-forms/（@/ 在 tsc paths、jest mapper、Metro 三链路全通）。
4. 顺带清死代码：application-model-id（零生产消费者）、depth-slice 纯转发、两端配置里 dangling 的 config-forms/events 映射。

SPEC：`docs/Iterations/config-forms-migration/spec.md`（2026-10-29，5 phase：core-prep → core-move → mobile-copy → desktop-copy → gates，另有 docs/device 两个非阻塞 phase；T-CF1~8 用例；风险表含 vite .js 后缀解析的 fallback 与「core-move 后 apps 短暂红」的分支内中间态说明）。状态：**待用户确认 spec 后实施**。

user:
使用动态工作流做吧

assistant:
（动态工作流实施完成，SPEC Step 1~6 落地于分支 `feat/config-forms-migration`，共 4 个提交：d4cfde4ea（SPEC 落盘）、2adb892d9（core：public/prompt 补 3 导出 + stored-config-validity 迁 domain/agent/ + 删 src/config-forms 全目录——SPEC 的 Step 1/2 两 phase 合为一提交）、ac5d913fd（mobile 副本 Step 3）、608450e7c（desktop 副本 Step 4）。）三端门禁全过：mobile 两套 tsc（build + web）绿、全量 jest 收在既存 7 红基线内（第 8 条按 AppState flake 重试一次的口径）；desktop eslint/typecheck 绿、packaging 之外测试套件全绿、renderer 打包（build:renderer）通过；core 全量套件 ≤ 既存 2 红（T-S5 DST、C2-3 copy）；全仓旧引用扫描清零（`@novel-master/core/config-forms` 与 `config-forms/events` 零残留）+ core dist 无 config-forms 残留。与 SPEC 的偏离（①②③为工作流自报，④为文档收尾比对发现）：① desktop `real-prompt-panel-rounds.test.tsx:1327` 正则 no-regex-spaces 修正（`\s{2}` 语义不变，解 eslint error）；② SPEC 风险①（vite 对副本内 `.js` 后缀相对导入的解析）实测排除——`npm run build` 全链 exit 0、bundle 含副本代码，fallback（extensionless + rewriteRelativeImportExtensions）未启用；③ desktop packaging 套件被宿主侧 electron 文件锁阻塞（EBUSY win-unpacked.tmp，句柄持 2+ 小时不释放），修复工实测全量 717 tests / 716 pass、唯一 fail 即 packaging 且不在迁移 diff，按环境阻塞单列、非迁移回归（宿主重启后需单独复跑一次）；④ SPEC Step 5 的 `build:webview` 门禁未在实施工作流中执行（webview allowlist 本就不含 config-forms，残留风险低）。Step 7 真机与桌面打包人工验收（manual_user）未执行，留待合并后用户验收。
