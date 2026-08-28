---
date: 2026-08-28
---

# vfs-revision-unique-conflict-fix 迭代 cr-func-all 只读检查

## 请求

对 worktree `.woktree/vfs-revision-unique-conflict-fix`（分支 feat/vfs-revision-unique-conflict-fix，基于 main@3ce296b）做 readonly 功能检查（节点 cr-func-all）：步骤矩阵 Step1-6 + blocking 测试闭合、verify 证据可信度抽查、spec_deviations 判定；重点核对三处实现细节（applyContentHashUpdate 乐观锁、批量 MAX 无 N+1、repair 空 catch 移除后健康库判定）。

## 结论

func-ready: yes（附 1 个 cosmetic must-fix）。

- 三处重点核对全部通过：`applyContentHashUpdate` 两个分支均显式 `head_version = #{nextVersion}`，乐观锁 WHERE `head_version = #{expectedVersion}` 与 `changes===0` 判定原样；`appendDeletedRevisionsForSubtree` 用 `findMaxVersionsForEntries`（IN 分块 + GROUP BY）一次取齐，无 N+1；`readSequenceBoundaries` 去 catch 后空结果集经 `?? 0` 兜底，全新库（sqlite_sequence 无行）seq=0/needed=0 判健康，异常上抛由 registry 保守判需修复。
- 矩阵闭合：Step1-6 全落地；T-V1/V2/V3/V4/V5/V7 实跑通过（含断言强度核对：version 精确值 + ref 配对数值 + entry 删除）；T-V6 经 vfs 套件 273/273 + message-checkpoint 三个 rollback 文件 17/17 抽查重跑确认。
- 提交链实际顺序：ada985b docs → 6044d2a repo → 36f13e1 repair → 1b2af8a bootstrap → dd67d69 service → 42b1365 测试 → 087e365 T-V3 修复。
- 自报波及核实为合规 spec_deviations（vfs.service/vfs-batch-io 裸 inner 维持 head+1、CopyVfsTreeOptions.revisions 可选、repo 测试适配）。
- must-fix（low）：`packages/core/test/vfs/bootstrap.test.ts` L11 import 行尾双分号 `";;"`，lint 级笔误。
- Step 7（CHANGELOG）未做，由主代理后续处理，非阻塞。

## 跟进（同日）

must-fix 已由用户修复：提交 a518c0c「style(test): 清理 bootstrap 测试多余分号」。git diff 核对仅 1 insertion / 1 deletion（L11 `;;` → `;`），无语义变化；文件内无其他双分号；用户重跑该文件 3/3 通过。func-ready 维持 yes。
