---
createdAt: '2026-07-29 21:38:22'
updatedAt: '2026-08-08 20:40:43'
---
﻿## 背景

「agent-mode-refactor」迭代（docs/Iterations/agent-mode-refactor/）：把子代理系统从全局名单（KKV subagentNames）重构为 AgentDefinition.mode 字段。SPEC 路径 docs/Iterations/agent-mode-refactor/spec.md，PRD docs/Iterations/agent-mode-refactor/prd.md。分支 feat/merge-subagent，base_sha 37dcd56c。编排状态见 docs/Iterations/agent-mode-refactor/.iteration-state.yaml。

## 目的

按 spec 完成 7 phase / 32 step 的实现，达 dev-ready（spec 范围内实现与功能小检完成）。

## 现状

代码层面 dev-ready，所有自动化步骤闭合（Step 1-31），仅剩 Step 32（三端 build，qa: manual_user）等用户手测验收。

11 个 commit 链（37dcd56c base → da1d8da6 head）：model→core-tool→test-fix→persist+form→desktop+mobile→test-doc→fix(import-export mode 映射遗漏)。dag_version 2（test-doc 后发现 import-export.ts 缺 mode 映射，重编排插入 fix）。

验证全绿：core build ✅、core test 1777/1765 pass/12 fail(全 pre-existing)、CLI e2e 5/5、agents-bundle 9/9、desktop tsc+vite ✅、mobile tsc+jest ✅、T-C1 零残留 ✅。blocking 测试 T-T1/T-T2/T-T3/T-T4/T-C1/T-C4/T-G1/T-P1 全部通过。

3 个 spec_deviations 均已修复（SD-1 AgentDefinitionEditorForm 补 mode 缺省值；SD-2 import-export 补 mode 映射；SD-3 import 跳过 general + CLI list 改用 list()）。
