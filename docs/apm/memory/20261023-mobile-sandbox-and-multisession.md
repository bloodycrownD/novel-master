# 2026-10-23 沙箱引入评估 × 多会话资源占用（rikkahub 对照）

## 类型与定位
- 类型：**brainstorm 第三轮**（用户：产品定位就是本地 agent，不拆分进程；看到 rikkahub 用了沙箱，想引入但担心手机端重、多会话内存与存储开销）
- 两个 readonly 子代理（Explore 模式无法落盘，报告正文只在对话里；本文件是结论沉淀）
- 前两轮：`20261023-mobile-stack-exploration.md`（换栈）、`20261023-mobile-rewrite-from-scratch.md`（从零重写）

## 一、rikkahub 的「沙箱」是什么（关键事实）

- **形态**：proot + 完整 Linux rootfs，不是 Android 内核级沙箱。`workspace` 模块 7 个 Kotlin 文件共 1,455 行 + 预编译 Termux proot 二进制。
- **rootfs 来源**：运行时下载，默认 `ubuntu-base-24.04.3-base-arm64.tar.gz`（cdimage 页面标注 **28M**），可自定义 URL；支持 tar.gz / tar.xz；解压后体积仓库内无记录（未验证，Ubuntu base 解压约 80–100MB 量级）。
- **运行模型**：`ProotShellRunner` **每条命令拉起一个 proot 进程**（`ProcessBuilder` + `destroyForcibly`），非常驻；默认超时 30s，可传 1–600s；stdout/stderr 各 128KB 截断。
- **交互终端**：`WorkspaceTerminalSession` 每个 tab 是**一个常驻 proot 进程 + Termux PTY**（`libtermux.so`），由 AppScope 持有，离开页面不销毁，只关 tab 或进程退出才结束。
- **隔离强度（重要）**：`--root-id` 只伪造 `getuid()=0`，进程仍是 app 自己的 UID；无 `--change-id`、无 namespace/cgroup/seccomp；所有 `-b` 绑定**都是 rw，没有只读挂载**；`/dev /proc /sys` 由宿主透传。`/upload`、`/builtin_skills` 的「只读」只是系统提示词约束 + 写审批白名单（`/workspace`、`/tmp`、`/skills` 之外强制弹审批），不是拒绝执行。
- **绑定路径**：`/workspace`（files 区）、`/skills`、`/builtin_skills`、`/tool_outputs`、`/upload`；不绑 `/sdcard`、`/storage`、其它 app 目录。
- **多 workspace**：每个 workspace 一份**独立完整 rootfs**，无共享层/无 dedupe/无 overlay；**无数量上限、无体积配额、无 LRU 回收**（`lastAccessAt` 从不更新）。存储压力线性叠加 = N × 解压后 rootfs。
- **绑定粒度**：workspace 绑在 **assistant** 上（`Assistant.workspaceId`），不是会话；会话只有 `workspaceCwd`。同一 assistant 下所有聊天共享一份 rootfs。
- **APK 增量**：proot 二进制 587,208 B（arm64 285,888 + x86_64 301,320），改名 `libproot_exec.so`/`libproot_loader.so` 放 jniLibs + `useLegacyPackaging=true`，以绕开 Android 10+ W^X。
- **QuickJS 不是沙箱替代**：`eval_javascript` 无文件、无 fetch、无 DOM，64MB 内存/10s/1MB 结果上限；另一处 `CustomJsSearchService` 注入 OkHttp fetch 供自定义搜索脚本（30s/64MB）。与 proot 并存不互斥。
- **agent 工具面**：workspace_read_file / write_file / edit_file / shell（shell 默认要审批），加上 memory/search/scrape/recent_chats/conversation_search/use_skill/eval_javascript/time/clipboard/tts/ask_user/screen_time/calendar/chart/MCP。**agent 没有 list/glob/grep 工具，这些只能走 shell**。`shellStatus != READY` 时四个 workspace 工具全部不创建（含纯读）。
- **结论**：proot 换来的是「agent 能装软件、跑任意 CLI」，不是安全性。产品文案里的 "sandboxed proot rootfs" 属宽松用法。

## 二、novel-master 现状：已经是逻辑沙箱，且无执行面

- **agent 工具面零执行能力**：`domain/tool` 与 `service/agent` 全量搜索 `node:fs`/`child_process`/`eval(`/`new Function`/`spawn`/`execSync` **零命中**。`fs` 工具是结构化命令（ls/rm/rmdir/mv/cp/mkdir），描述明写「执行单条文件系统命令（非 shell）」。工具清单共 11 个：read/write/edit/fs/glob/grep/task/skill/agent/curl/search。
- **真实文件系统只出现在用户触发的应用层**（导入导出、备份、文档选择），不在 agent 接口里。
- **隔离 = DB 内一列 `scope_key` 前缀**，五种 scope：`global` / `project:{pid}` / `session:{pid}:{sid}` / `global:meta` / `project:{pid}:meta`。
- **物理层全库内容寻址去重**：`vfs_content_blob.content_hash` 全局主键、**无 scope 列**、zlib、`ref_count` + 3 个触发器维护；`session_file_cache_blob` 同构。所以多会话重复只在**元数据**（vfs_entry / vfs_revision / session_kkv_entry / message_checkpoint），正文只存一份。
- **GC 是全库视图**：`content_hash NOT IN (entry ∪ revision)` 单库子查询。
- **建会话即整树复制模板**（entry + head revision），正文不复制；子会话**不建自己的 VFS scope**，直接指父会话工作区（这是「每会话一容器」的硬冲突点）。
- **已知缺口**：`allowedPaths` 三端运行时全部硬写 `undefined`（恒放行），且有三处缺口——不解 `..`、漏 `glob.cwd`/`grep.pathPrefix`、`filePath` 无工具声明。

## 三、实测体积数据（只摘录，不造数）

| 数据 | 数值 | 出处 |
|---|---|---|
| 用户备份库（清理前） | 523MB | `docs/Iterations/storage-cache-dedup-and-cleanup/prd.md:10` |
| 其中 file_cache | 415MB / 21,198 行 / 299 唯一内容 / 320 会话 / 平均重复 71 次 / 去重后 4MB | 同上 |
| 清理后全库 | 约 105MB | `docs/Iterations/message-content-compression/prd.md:10` |
| 其中 chat_message 明文 | 73.1MB / 5,309 条 | 同上 |
| 其中 message_checkpoint_file | 13.1MB / 100,276 行 | 同上 |
| 其中 vfs_content_blob | 8.8MB（已压缩） | 同上 |
| 真机主库（某轮） | 76MB / 5,350 消息 / 100,276 checkpoint 行 | `docs/Iterations/binary-blob-and-vfs-pack/spec.md:387` |
| 真实库指纹 | 126MB / revisionCount=6633 | `docs/apm/RULE.md:81` |
| 单会话整库平均体积 | **无实测** | — |

## 四、多会话内存现状

- 有界：settled 流单元 LRU **8**；`settledProjections`/`idleMessageViews` 各 **500**；`contentBodyPool` 约 **16MB**；`token-chunk-cache` **10 万条**；richHtml/滚动缓存各 500。
- **无界**：活跃 run 单元不占槽不淘汰；**跨会话并发 run 无全局上限**（全仓 grep `MAX_CONCURRENT` 等零命中）；`promptWholeCache.buckets` 每会话 32 条但会话桶数量无上限（`clearSession` 生产零调用）。
- **切会话不释放**：只摘句柄，单元靠 settled 宽限 + LRU 8 回收；只有 `dispose` 或 `forgetSession` 强制清空。
- 每并发 run 在 core + mobile 里至少并存：streamRegistry 整段 text/thinking、每 step 全量可见消息数组、提示词 messages 数组、单元 partial 两段、run_state 全量快照、ingress/apply 缓冲。
- 多会话并行是正式产品能力（`agent-run-parallel-and-notify/prd.md:16`）。
- 内存峰值**无实测数据**（设计口径只有「全会话明文 ×1」）。

## 五、结论

1. **rikkahub 的沙箱不是安全沙箱，是「给 agent 一个完整 Linux 用户态」**。轻不轻不取决于"沙箱"，取决于要不要 Linux rootfs（28MB 包 / 约 80–100MB 解压 / 每次命令冷启动 proot）。
2. **novel-master 不需要 proot**：现有 agent 工具面零执行能力，VFS 是 DB 内逻辑树，安全性已高于 proot（agent 连真 FS 都碰不到）。真正的缺口是 `allowedPaths` 恒 undefined + 三处路径校验漏洞，这是低成本可补项，与沙箱无关。
3. **proot 与「每会话一个工作区」在存储上互斥**：DB 的 VFS 能做到「每会话一棵树 + 正文全库共享」是因为元数据与内容分离；rootfs 是真实文件树，Android 上没有 overlayfs 可用，无法去重 → 每会话一份 = N × 80–100MB，直接爆。若引入只能像 rikkahub 那样「绑在某一层共享一份」，那就打破了产品现有的每会话工作区语义。
4. **内存风险不在沙箱，在现有并发模型**：活跃 run 无上限、跨会话并发无上限、切会话不释放。这三条在引入任何沙箱之前就该收口。

## 六、追加轮（2026-10-23 晚）：proot 的版本管理 × rikkahub 的缺失

### 用户问题
- user: 「proot 如果要文件版本管理，是不是需要 git？话说 rikkahub 好像没有桌面端 claude 等类似应用的版本管理？」

### 版本管理的最小充分条件
- 不是 git，而是三件事：**内容寻址（去重）+ 快照（版本链）+ 锚点（能定位到"某条消息之前"）**。git 只是这套模型最成熟的实现。
- novel-master 的 VFS 已经是这套模型的 DB 实现：`vfs_content_blob`(sha256) ≈ git blob object；`vfs_revision` ≈ 版本链；`vfs_content_pack` + fossil-delta ≈ packfile/deltified objects；`message_checkpoint` ≈ ref，但比 git 的 ref 更适合对话场景（绑消息而非绑时间点）。
- 结论：现在不缺版本管理，缺的是把锚点语义扩展到文件系统的能力（如果真的上 proot）。

### 用真 git 的代价（proot 场景）
- ubuntu-base 默认**不带 git**，要 apt install 或塞 static build。
- 每次 checkpoint 起两次进程（proot + git）；手机冷启动远慢于桌面（Cline 是桌面，进程启动成本可忽略）。
- `.git` 暴露给 agent → 可 `rm -rf .git`、可乱 checkout，需只读挂载或在 proot 外操作（后者又要处理路径映射）。
- 时机难题：每次工具调用后 commit（Cline 做法，对象爆炸但粒度最细）vs 每轮结束（省但粗）——与现有 checkpoint 时机问题同构。
- **失去三样**：①消息级精确锚点（git commit 是树快照，不绑消息，映射仍需存 DB）②跨会话引用计数（git 只能 gc）③单事务原子性（git 与 DB 写入无法原子；现状删会话是同事务删 messages/fs/kkv/run_state/vfs）。

### 桌面端同类应用（有据可查，web 检索）
- **Cline**：shadow Git repository，独立于项目 git，**每次工具调用后 commit**，存于 VS Code global storage；依赖 simple-git（即 git CLI）。出处 docs.cline.bot/core-workflows/checkpoints。
- **Zoocode / Codebolt**：同样 shadow repo + simple-git，checkpoint = shadow repo 里的一个 commit。
- 共同结构原因：**它们的 agent 直接操作真实文件系统，所以必须借 git**。novel-master 的 agent 操作 DB 行，有事务/触发器/内容寻址，不需要进程。

### rikkahub 有没有版本管理：没有
- DB 实体表只有 9 张：Conversation / Favorite / Folder / GenMedia / ManagedFile / MediaCreation / Memory / MessageNode / Workspace。**无 checkpoint / revision / version 任何一张表**。
- `ChatMessageContextCheckpoint.kt` 是纯 Compose UI 组件（上下文 checkpoint 折叠卡片），非文件状态。
- 有 diff 展示（`DiffView.kt`、`WorkspaceTools` 的 edit_file 返回 unified diff）——只是"显示改了什么"，不是"能退回去"。
- 有整库备份（S3 / WebDAV / 本地），属另一维度。
- **结构性原因**：workspace 绑在 assistant 上、一份 rootfs 服务所有会话，所以"某会话某消息时的文件状态"在其数据模型里不存在——**没有隔离就没有锚点**。不是疏忽，是共享型 workspace 的必然结果。
