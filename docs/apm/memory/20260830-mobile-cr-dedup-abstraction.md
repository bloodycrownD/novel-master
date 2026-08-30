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
节点 spec-fix-r3：第 3 轮五个专项评审（错误处理/门禁/安全/测试结构/分层命名）产出 25 条新 must-fix（10 P1 + 14 P2 + 1 条并入既有），追加进 cr-fix-spec.md。只改文档。

assistant:
完成 spec-fix-r3 落盘：元信息更新（review_round→3、dag_version→5、状态 draft 待 review-full 复核、评审来源追加第 3 轮五个 readonly 专项节点 b2-errors/gates/sec/tests/arch）；P1 追加 10 条（19→29）：b2/B-1~B-4（列表 reload 吞错、Picker select 无错误处理、ChatConfig 开关乐观更新、批量删除失败卡批选）、gates/G-1~G-2（CI 三门禁全 continue-on-error、lint 无 max-warnings）、tests/G-1~G-2（yaml-encode 测试空转、cloud-sync-config.store 零覆盖）、sec/D-1（WebView 无导航拦截可伪造桥消息）、arch/C-1（AppHeader 反向依赖具体屏）；P2 追加 14 条（45→59）：b2/B-5~B-6、gates/G-3~G-5、sec/D-2、tests/G-3~G-7、arch/C-2~C-5；另修订 services/C-1 测试路径勘误、comp-misc/C-1 追加孤儿 fixture（吸收原 tests/G-4）、Open questions 追加安全/门禁/结构规则/测试/勘误五组新拍板项、合并后 QA 追加 sec/D-1 回归项。

user:
节点：spec-fix-decisions。用户已确认 Open questions 30 条全部按评审建议拍板，把决议回写 cr-fix-spec.md：修订 11 处既有条目、新增 11 条 P2、Open questions 章改写为决议记录、更新元信息。只改文档。

assistant:
完成决议回写：①既有修订 13 处——comp-misc/B-2 升 P1（CSS 属性白名单 + 恶意 style 验收，从 P2 章节物理挪入 P1 章节才能被 grep 计数）；comp-misc/C-1 追加 RichContentBody 保留边界；comp-rest/C-8 定直接删；screens/C-11 AGENT_LOCK_TOAST 有意分化+挪 chat-agent-meta；screens/C-12 定直接换 ManageHeader；services/C-1 删除已确认（2026-08-30）；web/C-orch-1 追加 bridge.ts 目录套单文件统一；web/C-orch-2 拍板条件式写入+CSS 兜底（var(--bg,#fff)）；web/A-1 拍板 tsconfig.webview-boot.json 退役；sec/D-1 验收追加 allowFileAccessFromFileURLs 收紧评估；infra/C-2 appUiKeys 拍板删；fmt-1/arch/C-4 导入风格定 B；arch/C-5 三方向确定。②新增 11 条 oq* P2（oq5/oq12/oq13/oq14/oq15/oq17/oq18/oq21/oq23/oq3/oq7）追加在 arch/C-5 后。③Open questions 整章替换为「已拍板决议（2026-08-30）」：30 条逐条决议 + 4 项单独立项 + 31 条勘误保留。④元信息 dag_version→7、状态 fix-spec-ready（待确认开工）、P1=30/P2=69、QA 追加 2 条、K 节追加 1 条。grep 验证 P1=30、P2=69 全对。经验：严重度升级的条目要物理挪章节，否则标题计数与章节计数对不上。
