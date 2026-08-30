---
date: 2026-08-30 12:00
title: apps/mobile 代码评审（重复代码/组件抽象/ts-tsx 混用）产出 fix-spec
keywords: mobile, CR, code-review-loop, 重复代码, 组件抽象, ts/tsx, fix-spec, 子代理上下文纪律
abstract: 对 apps/mobile 全量 CR 两轮循环（第 1 轮七 scope + 第 3 轮五专项，均含 review-full 校验），产出 29 条 P1 + 59 条 P2 共 88 条的 fix-spec；覆盖重复代码/组件抽象/ts-tsx（实际全对）、错误处理、工程门禁、安全、测试结构、分层命名。另沉淀经验：子代理搜索必须限定范围，否则上下文超限报 Prompt exceeds max length。
---

user:
对 apps/mobile 进行 CR，重点检查重复代码、组件抽象、ts/tsx 混合等。走 code-review-loop。

assistant:
按 code-review-loop 编排：拆 7 个 scope（comp-chat、comp-misc、comp-rest、screens、web、services、infra）并行派 readonly 子代理评审，主代理只汇总合并。结论：无 P0；ts/tsx 后缀全仓实际完全正确（预检怀疑的「.ts 含 JSX」全是泛型误报、两个疑似无 JSX 的 .tsx 是跨行写法漏检），真正的问题在重复代码与组件抽象。合并跨 scope 重复项后经两批 spec-fix 落盘 docs/Iterations/mobile-cr-dedup-abstraction/cr-fix-spec.md（19 P1 + 45 P2），review-full 校验通过，fix-spec-ready。P1 要点：db/connection.ts bootstrap 失败泄漏连接、rich-content RN 渲染链 5 文件死代码（可卸 react-native-render-html）、弹窗骨架 16 处复制（ModalShell 收敛）、六个列表屏三重样板、Android 键盘裁切 4 份复制、web 三域 post/applyTheme/双通道监听三份平行、prettier 基建失效（fmt-1）等。

user:
search 工具很容易超上下文，因为返回太多内容了。

assistant:
确实——comp-chat 和 services 两个子代理就是这么挂的（报「Prompt exceeds max length」，重试同会话也失败）。对策：把大 scope 切小（comp-chat 45 文件拆成 chat 31 + 其余 14）、派发指令里写明上下文纪律：禁止全仓 grep、搜索必须限定目录且 regex 精确、大文件按行号区间读、终端输出截断。换新会话 + 纪律后两个 scope 一次跑通。后续所有子代理派发都应默认带这套纪律。

user:
你回忆下看到的代码，除了我说的几个方面（重复代码/组件抽象/ts-tsx 混用），还有哪些方面存在问题、需要 CR？

assistant:
基于七份 scope 报告归纳出八个额外问题面：①错误处理与资源生命周期薄弱（静默吞错、fire-and-forget 持久化、定时器/连接/缓存泄漏，建议单独一轮 B 维专项）；②测试结构性失衡（components/chat 31 文件零测试、code-editor 域零测试且不在类型检查内，测试集中 stream 侧）；③工程门禁三道全有洞（prettier 配置缺失致 format:check 失效、lint warning 未卡、tsconfig include 漏 code-editor）；④分层与依赖方向（service 反向依赖 components、storage/services 边界模糊、ui 基础层未被复用）；⑤命名与目录语义（.service.ts 后缀双轨、两个 webview-host 撞名、NEAR_BOTTOM 双名）；⑥死代码常态化（约 12 处，缺 knip 类工具化治理）；⑦注释与实现漂移（多处失实注释误导）；⑧安全面未系统查（sanitize-html allowVulnerableTags、WebView innerHTML 注入面）。另有未覆盖盲区：e2e、android/ios 原生侧、构建配置、依赖版本健康。

user:
继续 CR。

assistant:
（第 3 轮专项，五个并行 readonly 节点：b2-errors/gates/sec/tests/arch，全部带上下文纪律一次跑通。）新增 25 条：错误处理 6 条（4 P1：四处列表 reload 吞错伪装空态、两个 Picker select 无错误处理、ChatConfigScreen 四开关乐观更新吞持久化失败、批量删除会话/项目失败卡死批选模式）、门禁 5 条（CI 三门禁全 continue-on-error、lint 298 warning 无上限、死脚本、gradlew.bat、e2e 无 typecheck 入口）、安全 2 条（sec/D-1 P1：三个 WebView 无导航拦截，外部链接可整页接管并伪造桥消息触发 rollback；sec/D-2：releaseUrl 无域名校验）、测试结构 7 条（死命名空转测试、cloud-sync-config.store 329 行零覆盖、源码正则断言测试 15 个、vfs-operations 被 mock 零真实覆盖等）、分层命名 5 条（arch/C-1 P1：AppHeader 反向依赖成环、注释失实、导入风格双轨、目录语义）。两批 spec-fix 追加 + review-full 复核后 fix-spec-ready，共 29 P1 + 59 P2 = 88 条。勘误：「components/chat 零测试」口径错——实测 34 个测试文件引用 chat、覆盖约 21/31 源文件（第 1 轮 comp-chat 评审员只看了目录内未看全局 __tests__）。经验于后续：b2/B-6 与 services/C-6 同文件需串行执行；gates/G-4 与 tests/G-7 合并排期。

user:
[impl-sec-d1] 给三个 WebView（ChatTranscriptWebView/CodeEditorWebView/RichDocumentWebView）按 sec/D-1 加导航守卫，勿 git commit，只改三个文件。

assistant:
三处统一加 onShouldStartLoadWithRequest（包目录前缀 getXxxPackageDirUri() 放行、http/https 外跳 Linking.openURL+静默 catch、其余 false）、originWhitelist 由 ['*'] 收紧为 ['file://']、iOS onOpenWindow preventDefault+外跳。关键考据：react-native-webview 13.16.1 的 originWhitelist 在 JS 层（WebViewShared.createOnShouldStartLoadWithRequest）做 origin 前缀正则匹配，失败时库自己 Linking 外跳且不进用户回调，about:blank 自动进白名单；extractOrigin 会把 file:///android_asset/... 归一为 file://，收紧不影响首载；iOS 文档语义是首载不触发该回调，Android 无锁路径 true 会重发 loadUrl（与默认行为一致）。根入口未导出 ShouldStartLoadRequest/WebViewOpenWindowEvent，回调参数用结构化类型。验证：tsc 全仓仅 sanitize-rich-html.ts 报错（并行波次未完成的中间态，非本节点文件，三个目标文件零错误）；webview-uri-load + 两个批注测试共 16 用例全过。约束遵循：未 commit，未动其他未提交改动。

user:
节点 spec-fix-r3：第 3 轮五个专项评审（错误处理/门禁/安全/测试结构/分层命名）产出 25 条新 must-fix（10 P1 + 14 P2 + 1 条并入既有），追加进 cr-fix-spec.md。只改文档。

assistant:
完成 spec-fix-r3 落盘：元信息更新（review_round→3、dag_version→5、状态 draft 待 review-full 复核、评审来源追加第 3 轮五个 readonly 专项节点 b2-errors/gates/sec/tests/arch）；P1 追加 10 条（19→29）：b2/B-1~B-4（列表 reload 吞错、Picker select 无错误处理、ChatConfig 开关乐观更新、批量删除失败卡批选）、gates/G-1~G-2（CI 三门禁全 continue-on-error、lint 无 max-warnings）、tests/G-1~G-2（yaml-encode 测试空转、cloud-sync-config.store 零覆盖）、sec/D-1（WebView 无导航拦截可伪造桥消息）、arch/C-1（AppHeader 反向依赖具体屏）；P2 追加 14 条（45→59）：b2/B-5~B-6、gates/G-3~G-5、sec/D-2、tests/G-3~G-7、arch/C-2~C-5；另修订 services/C-1 测试路径勘误、comp-misc/C-1 追加孤儿 fixture（吸收原 tests/G-4）、Open questions 追加安全/门禁/结构规则/测试/勘误五组新拍板项、合并后 QA 追加 sec/D-1 回归项。

user:
节点：spec-fix-decisions。用户已确认 Open questions 30 条全部按评审建议拍板，把决议回写 cr-fix-spec.md：修订 11 处既有条目、新增 11 条 P2、Open questions 章改写为决议记录、更新元信息。只改文档。

assistant:
完成决议回写：①既有修订 13 处——comp-misc/B-2 升 P1（CSS 属性白名单 + 恶意 style 验收，从 P2 章节物理挪入 P1 章节才能被 grep 计数）；comp-misc/C-1 追加 RichContentBody 保留边界；comp-rest/C-8 定直接删；screens/C-11 AGENT_LOCK_TOAST 有意分化+挪 chat-agent-meta；screens/C-12 定直接换 ManageHeader；services/C-1 删除已确认（2026-08-30）；web/C-orch-1 追加 bridge.ts 目录套单文件统一；web/C-orch-2 拍板条件式写入+CSS 兜底（var(--bg,#fff)）；web/A-1 拍板 tsconfig.webview-boot.json 退役；sec/D-1 验收追加 allowFileAccessFromFileURLs 收紧评估；infra/C-2 appUiKeys 拍板删；fmt-1/arch/C-4 导入风格定 B；arch/C-5 三方向确定。②新增 11 条 oq* P2（oq5/oq12/oq13/oq14/oq15/oq17/oq18/oq21/oq23/oq3/oq7）追加在 arch/C-5 后。③Open questions 整章替换为「已拍板决议（2026-08-30）」：30 条逐条决议 + 4 项单独立项 + 31 条勘误保留。④元信息 dag_version→7、状态 fix-spec-ready（待确认开工）、P1=30/P2=69、QA 追加 2 条、K 节追加 1 条。grep 验证 P1=30、P2=69 全对。经验：严重度升级的条目要物理挪章节，否则标题计数与章节计数对不上。

user:
（附 code-dev-loop skill）按第一批评审建议开工。

assistant:
进入 code-dev-loop：分支 cr/mobile-fix-wave1（基线 4ba1c73，含 fix-spec 文档提交）；第一批范围四条 P1：sec/D-1（WebView 导航守卫）、infra/B-1（bootstrap 连接泄漏）、b2/B-4（批删失败卡死）、comp-misc/B-2（sanitize CSS 白名单）。DAG v1：wave-0 四 impl 并行（文件不重叠）→ wave-1 verify → wave-2 cr-func。因同仓库并行，impl 子代理只改不提交，主代理按条目统一提交。用户自己的未提交改动（.vscode 删除、AGENTS.md 修改等）保留不动。

assistant:
（wave1 结果）dev-ready。实际 DAG：wave-0 四 impl 并行 → wave-1 两 fix 并行（onOpenWindow 类型修正——真实字段 targetUrl 且须深导入 react-native-webview/lib/WebViewTypes；补批删失败测试）→ wave-2 verify（拒了 1 条：filterInlineStyle 重序列化带空格致旧断言 color:red 失配，trivial 主代理修）→ re-verify 全量 165 套件/906 用例全绿 → wave-3 cr-func func-ready yes。提交链：20342a6/f095bcb/25daabc/e5f3524 四修复 + 54002dd/2fa8630 文档与断言。经验：①同仓库并行 impl 必须子代理只改不 commit，主代理按条目统一提交；②子代理「无测试文件」结论要抽查（impl-b2-b4 误报，实际 __tests__ 有大量样板）；③白名单默认全拒比黑名单更严且好维护；④验证日志属工作流状态，写 docs/.iteration-state.yaml 不进 apm memory；⑤子代理写记忆文件有误覆盖风险，主代理要抽查记忆完整性。合并后 QA 手工项：真机点链接外跳+伪造桥消息不触发 rollback、allowFileAccessFromFileURLs 收紧评估。

user:
节点：impl-infra-b1，类型：impl。修复 bootstrap 失败路径泄漏 SQLite 连接：open() 成功后 bootstrapNovelMaster 抛错时局部变量 c 持有的已打开连接随 throw 丢弃（conn 尚未赋值，closeMobileConnection 的 conn?.close() 关不到）——泄漏文件句柄与 WAL 锁，Android 重试多连接同库可能互锁。改法：bootstrap 的 catch 在 throw 前补 await c.close().catch(() => {})，open 的 catch 不需要；补测试断言 close 被调用且重试可重新 open。不执行 git commit/add，只改 connection.ts 与其测试。

assistant:
完成 infra/B-1：① apps/mobile/src/db/connection.ts 的 bootstrap catch 在打完 cause 链日志后、throw 前补 await c.close().catch(() => {})，配中文注释说明 conn 未赋值导致 closeMobileConnection 关不到、重试互锁风险、close 异常吞掉以免掩盖原始 bootstrap 错误。② apps/mobile/__tests__/connection.test.ts 新增 describe：mock @novel-master/core 的 open/bootstrapNovelMaster 与三个驱动注册模块，用例断言 bootstrap reject 时 leakingConn.close 被调 1 次，且 closeMobileConnection() 重置 initPromise 后重试能重新 open（mockOpen 共调 2 次）。关键发现：bootstrap 失败后 initPromise 仍缓存 rejected Promise，直接重调 getMobileConnection 不会重新 open，实际重试路径必须先 closeMobileConnection() 重置——首次写测试时直接重调断言失败即此原因。验证：npx jest __tests__/connection.test.ts 7/7 绿；npx tsc --noEmit -p tsconfig.build.json 通过。未做任何 git 操作。

user:
节点：impl-misc-b2。sanitize-rich-html 上 CSS 属性白名单（comp-misc/B-2 已升 P1），修失实注释。不执行 git commit/add，只改 sanitize-rich-html.ts 与其测试。

assistant:
完成 comp-misc/B-2：① sanitize-rich-html.ts 新增 ALLOWED_CSS_PROPERTIES 白名单（color/background/background-color/font-weight/font-style/font-size/text-decoration/text-align/text-indent/line-height/letter-spacing）+ splitStyleDeclarations 逐字符解析（跟踪引号与括号深度，url("a;b") 内分号不切分）+ 导出 filterInlineStyle（含 CSS 注释的声明整条丢——防注释拼凑属性名；含 url( 的丢——防外联）；挂进 sanitize-html 管道 transformTags['*']（parseStyleAttributes:false 不过滤 style，必须自己接管；transform 发生在属性白名单过滤前、拿到的是解码后原始值）。② 删除失实的「允许 style 标签」注释与死配置 allowVulnerableTags:true（实测它只是压制 allowedTags 含 script/style 的警告，本配置根本不含）。③ 测试：借 mock 替身捕获真实配置 + jest.requireActual('sanitize-html') 回放写真实行为用例（jest.config 的 transformIgnorePatterns 已放行 sanitize-html 全家，真实库可加载）——<style> 输入 escape 为实体字面量固定现状；恶意 position:fixed;inset:0;background:#fff 断 position/inset 剥、background 留；另 4 个 filterInlineStyle 纯函数用例。坑：块注释里写 `pos/**/ition` 示例会提前终结注释致 babel 解析炸（报错还错位到百行之外）；RN babel preset 下模板字符串报 Missing semicolon，换字符串拼接。验证：jest 15/15 绿；tsc 仅剩 3 个 onOpenWindow 既有错误（ChatTranscriptWebView/CodeEditorWebView/RichDocumentWebView，并行波次 sec/D-1 改的文件，非本节点引入）。未做任何 git 操作。

user:
节点：fix-b2-b4-test，类型：fix。补 wave-0 impl-b2-b4 漏掉的「批量删除中途失败」测试（该节点误报无测试文件）。覆盖三分支：全部成功 / 第二个 session delete reject / handleDeleteProjects 中途 reject。只新建测试文件，不改实现。

assistant:
完成 fix-b2-b4-test：新建 apps/mobile/__tests__/use-chat-tab-scope-batch-delete.test.ts（3 用例），沿用 use-chat-tab-message-actions-rollback.test.ts 的 TestRenderer + Harness hook 测试基建，mock 边界仅 runtime（sessions/projects.delete 等 + sessionVfs/workplace/projectVfs 桩——首跑就因缺这三个 VFS 方法报 runtime.sessionVfs is not a function，hook 顶层 useMemo 会调）与 chat-agent-meta/chat-prompt-tokens 两个服务；toastMessage、session-view-cache 用真实实现（后者有 clearAllSessionViewCaches 可重置，还能顺带断言已删会话视图缓存被清）。「第一个已删不复活」用 mock delete 维护 deletedSessionIds 数组断言：失败后仍为 ['s1'] 且 s3 未被尝试。真实 toastMessage 会产出「删除失败：db locked」，用 stringContaining 断言。验证：jest 3/3 绿；tsc build 配置 exit 0（该配置本就不含 __tests__，另用主 tsconfig grep 确认新文件 0 报错）。未改任何实现代码，未做 git 操作。实现侧无新发现缺陷，wave-0 的 try/catch+finally 语义与验收一致。
