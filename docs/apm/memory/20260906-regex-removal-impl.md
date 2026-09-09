---
date: 2026-09-06 19:49
title: 正则系统全量移除实现（regex-removal 迭代 impl 节点）
keywords: [regex-removal, 正则移除, SCHEMA_BOOT_VERSION, session-messages-loader, feature-optimizations-2026-09]
abstract: impl-regex-removal 子代理在 feat/regex-removal 分支按 spec Step 0-6 完成正则系统全量移除（core/desktop/mobile/CLI/CHANGELOG 五个提交，107 文件 -5734 行），四端测试全绿、CLI e2e 失败经混合基线对照确认为 #32 环境问题。
---

# 正则系统全量移除实现（regex-removal 迭代 impl 节点）

## user:

按 docs/Iterations/feature-optimizations-2026-09/features/regex-removal/spec.md 实现 Step 0-6：core（删域/服务/schema DROP+bump 11/agent 链路/persistent-state/导出）、desktop（12 IPC 通道/三视图/runtime）、mobile（六文件+新 loader 模块+四套件 mock 迁移）、CLI（命令族+消费段+helpers）、CHANGELOG。约束：勿误伤 depth/grep 工具/mention 检测/examples 原型；KKV 残留键不清；T-CF1 删除；T-RX1 schema 三场景挂 test/bootstrap/；分逻辑块提交；全绿才返回。

## assistant:

完成六个提交（9fce7c83 core-scheme、c1f48b36 core-tests、713d4907 desktop、68e2f633 mobile、b735395b cli、a6bd3168 changelog），107 文件 +221/-5734。

- Step 0：git worktree list 确认 regex-system-reference（b442d397）已检出。
- core：删 20 文件；NOVEL_MASTER_SCHEMA_STATEMENTS 移除 REGEX 建表、加 DROP TABLE IF EXISTS（先 rule 后 group，防未来 FK 顺序问题）、SCHEMA_BOOT_VERSION 10→11；agent 六文件摘除（activeRegexGroupId/applyLlmRegexChannelToVisible/after_regex_channel checkpoint/regexConfig 依赖）；persistent-state 三方法+键常量删除；package.json ./regex 导出、index、ui-labels、format 收敛；dist 已重建。
- core 测试：T-CF1 整块删除；新增 test/bootstrap/regex-table-drop.test.ts 覆盖 T-RX1 三场景（v10 存量清表/全新库无表/备份回退再清，user_version=11）；1810/1810 全绿（一次出现 1 flaky 重跑即绿）。test/domain/regex/regex-rule-update-depth.test.ts 虽未在 spec 文件清单显式列出，但同属 regex 域测试（domain/regex 删除后必编译红），一并删除。
- desktop：109/109 + typecheck 绿（构建产物 smoke 测试需先跑 build:icons/preload/renderer/main，worktree 初次全挂属环境缺失产物）。
- mobile：新建 services/session-messages-loader.ts（list/Tail/Page 三函数去 ForDisplay 后缀直调 runtime.messages）；181 套件/1079 用例 + typecheck 绿（webview-dist 缺产物需先 npm run build:webview）。
- CLI：typecheck 绿；88 用例 62 过、26 失败全部为 #32 记录的环境问题（「新建会话失败：workspace 未配置 Agent」「migration 日志混入 stdout」），做过基线 core+基线源码+CLI 改动的混合对照确认同败，失败信息无一涉及 regex；CLI 无集中 help，删分发注册即不可达（regex 落到 main.ts 既有 Hello 兜底分支）。
- 勿误伤验证：domain/depth、vfs-tools grep 正则模式、normalize-orphan-tool-results-for-llm 注释、examples 原型全部原样保留。
- 环境备注：worktree 新检出需重建全部依赖包 dist（tdbc×4/tokenizer×2/cloud-sync/sksp×4 + core），否则 core/desktop/mobile/CLI 测试大面积 ERR_MODULE_NOT_FOUND；此前记忆只列了 tdbc/core/tokenizer-driver-node，sksp 系列也要。

## user:

（本次为单轮委托任务，无后续追问）
