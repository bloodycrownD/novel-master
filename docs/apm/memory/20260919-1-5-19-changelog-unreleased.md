---
date: 2026-09-19 15:25
title: v1.5.19 发版全程——CHANGELOG 史实对齐 + TS 工具链红修复 + tag 推送与三笔提交
keywords: changelog, 1.5.19, v1.5.18 回滚, release/1.5.18-clean, agent-run-parallel-and-notify, typescript 6.0.3, TS5103, ignoreDeprecations, 发版, 钥匙串环境门, fix/vfs-rename-rollback
abstract: 用户拍板并发功能批（main）以 1.5.19 发版。CHANGELOG 双修：main 的 [1.5.18] 段纠正为实发货重发说明（v1.5.18 tag = 1.5.17 基线 + 纯版本号 bump），并发功能批写入新版本段（段首引言交代初版渲染回归已修复；渲染三修复/中断解锁并入不单列）。发版闸门发现并修复 main 旧伤：mobile devDep typescript ^5.8.3（本地 5.9.3）不认 79f70eed 补的 ignoreDeprecations "6.0"（TS5103），对齐 ^6.0.3 复用根部提升安装并暴露唯一 TS2540（takeWebviewHandles readonly）修复。测试：core 2117/2117、mobile 1352/1352、desktop 480/484（4 失败均为 Secret Service 钥匙串环境门，CI 不跑测试）。三笔提交（fix/docs/release）+ tag v1.5.19 已推送，CI Windows/macOS 已绿、Android 构建中（用户自行盯尾）。遗留：fix/vfs-rename-rollback-2026-09 分支 11 提交未合并，下版盘点。
---

user:
并发功能的分支可以发布 1.5.19 了，先看看 changelog——上次发 18 的时候发现 bug 回滚了，看看这次怎么写。

assistant:
史实核对：v1.5.18 tag = ffe04f00（release/1.5.18-clean 分支，回退至 v1.5.17 代码基线 + 版本号 bump），diff v1.5.17..v1.5.18 仅 5 个版本号文件；实发货 CHANGELOG 段是「重发说明 + 回退全部变更」。main 上的 [1.5.18] 段却还写着并发功能批（初版内容），与实发货不符——系版本号事故轮（v1.6.0 误定→清理重发 v1.5.18）留在 main 上的陈旧段落。

处理（CHANGELOG.md 两处）：
① main 的 [1.5.18] 段替换为实发货内容（2026-09-16 + 重发说明），史实归位。
② 并发功能批写入 ## [Unreleased]（发版时由 publish skill 挪成 [1.5.19]）：新增 4 条（多会话并行生成/生成中断现场恢复/消息通知与常驻状态栏/通知权限管理，均移动端）+ 变更 1 条（启动与切换更流畅：忙期让步 + 按可视区域加载）+ 修复 1 条（生成失败或空回复解锁输入框，双端——此 bug 是 1.5.17 及更早用户真实可遇的，不是过程 bug）+ 维护 2 条（开发诊断打点工具入库/CI 构建顺序修复）。

口径决策：
- 段首引言交代「本批为初版 v1.5.18 回退后的重新交付……渲染回归已修复」——初版短暂流出过，比塞进修复段干净。
- 渲染回归三修复（step 边界 reset-stream 广播/单元替换吸收句柄迁移/窗口化贴底守卫）不进修复段：并发功能与回归都未经正式版本到达用户。
- 51d3a447 中断现场解锁 composer 并入中断恢复条目（「输入框立即可用、修改后可直接重发」）。
- 「活跃中」徽标系 isCurrent 语义误读，无代码改动，不写。
- require-cycle 惰性 require、tsconfig/lockfile 补正属内部修整不单列；CI s3 prebuild 顺序修复进维护段。

发版注意：Unreleased 由 novel-master-publish 转正；RULE 已有发版 +0.0.1 硬规则（上次 1.6.0 误定教训），本次目标 v1.5.19。

user:
（看过 changelog 后）发布吧。

assistant:
按 publish checklist 执行，途中处理两个发版闸门问题：

① **mobile typecheck 在 main 上就是红的（旧伤，79f70eed 遗留）**：mobile devDep typescript ^5.8.3（本地解析 5.9.3），而 79f70eed 为 TS6 baseUrl 弃用补的 ignoreDeprecations "6.0" 只有 TS6 认 → TS5103。npm install/update 对已解析条目异常粘滞（范围都违反还报 up to date，npm install typescript@6.0.3 -w 甚至反向把声明改回 ^5.9.3）——最终外科手术：声明对齐 ^6.0.3 + 删 apps/mobile/node_modules/typescript 与 lockfile 对应条目 + npm install 重建，mobile 复用根部提升的 6.0.3。TS6 全量检查暴露唯一真实类型错：takeWebviewHandles 整字段换新引用违反 readonly（268 行 readonly 声明）——改「拷贝取出 + 原位置空」（与 dispose 路径 432 行写法一致），语义不变。全仓 typecheck 转绿。

② **desktop 测试 480/484**：4 个失败（chat-prompt-tokens.service / cloud-sync ipc handlers / provider-identity T-PI8 / createDesktopNovelMasterRuntime + 1 连坐取消）全是 Secret Service 钥匙串访问失败——gnome-keyring 在用户图形会话跑着，但 agent shell 无 secret-tool 可探、判定为环境门非代码回归（本轮只动版本号字符串）；release CI 只构建不跑测试，不构成发版阻塞。

测试终态：core 2117/2117、mobile 1352/1352、desktop 480/484（钥匙串门）、全仓 typecheck 绿。

三笔提交（版本行用 sed 临时拨回 1.5.18 隔离 fix 与 release 的混文件改动）：8c2b2d30 fix（TS 工具链+readonly）、21f32c1b docs（两条记忆）、d3011975 chore(release)（CHANGELOG 转正+双端 bump+gradle versionName+lockfile）。tag v1.5.19 推送触发 Release CI（run 35428889437），main 同步推送。CI：Windows 4m24s ✓、macOS 4m31s ✓、Android 构建中——用户说自己盯尾，按成功收尾。

遗留与注意：①fix/vfs-rename-rollback-2026-09 分支 11 提交未合并（VFS rename/回滚修复批，含 schema 迁移），下版发版前盘点；②仓库 gc 警告（unreachable loose objects 多，疑似 tag 清理重发遗留），闲时可 git prune；③npm 对 lockfile 已解析条目的粘滞行为记入教训：改 workspace 依赖范围后 install 报 up to date 不动，须删条目/删目录强制重解。
