---
date: 2026-08-20
title: write/mkdir 新目录默认启用目录规则（impl-write-default-rule）
keywords: workplace_dir_rule, rule_off, 默认规则, write 工具, fs mkdir, BuiltinToolContext, run-agent-turn
abstract: agent 的 write 与 fs mkdir 创建新目录时目录规则默认启用：BuiltinToolContext 新增可选 workplace（Pick<WorkplaceService>），vfs-tools 新增 ensureDirRulesForNewPath 对目录链逐层查无行才补 setDirRule（已有行含 rule_off 不覆盖、吞错不影响主流程），run-agent-turn 主/子 agent 两处 toolCtx 注入 session scope workplace。测试覆盖嵌套新路径各层 on、rule_off 不覆盖、mkdir 补规则。
---

user:
节点 impl-write-default-rule：agent 的 write 工具与 fs 工具 mkdir 创建新目录时，目录规则默认启用（现状无 workplace_dir_rule 行被判 rule_off）。只改 packages/core。

assistant:
按探索结论落地四步：① BuiltinToolContext 加可选字段 `workplace?: Pick<WorkplaceService, "setDirRule" | "getDirRule">`，未注入跳过、向后兼容（d8685b7）；② vfs-tools 新增 `ensureDirRulesForNewPath(ctx, dirLogicalPath)`——对目录链（write 取父目录链、mkdir 含自身，均跳过根）逐层 getDirRule，仅无行时 setDirRule({logicalPath})（缺省即默认启用），已有行含显式 rule_off 不覆盖；整体 try/catch 吞错，不让 write/mkdir 失败（18fbb81）；③ run-agent-turn 主 agent 按 scope.sessionId、子 agent 按根父会话（与子 agent 的 vfs 同归属，共享父工作区）注入 session scope workplace（65bbbd0）；④ test/tool/vfs-tools.test.ts 补三条测试，另加真实 workplace 服务集成验证（d207a4b）。

user:
实现细节有什么坑？

assistant:
两个：一是 write 的目录链要取文件父目录（文件本身不是目录，setDirRule 落在文件路径上会留脏行），helper 因此接收"目录路径"语义——write 侧传 parentDirOfLogicalPath(logicalPath)，mkdir 侧传自身；二是真实 VFS 的 mkdir 不递归，集成测试里得先建 /m 再建 /m/n，第一版直接 mkdir 嵌套路径挂在 NOT_FOUND 上了。验证：tool/workplace/vfs/service-agent 相关 587 测试全过 + core typecheck 干净。
