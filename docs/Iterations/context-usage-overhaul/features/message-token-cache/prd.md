---
date: 2026-09-28
dependency: iterations/context-usage-overhaul/prd.md
---

# message-token-cache（消息级 token 缓存）PRD

## 背景

承接迭代总纲范围第 1、2、3 条。现状：本地计数每次都把全部可见消息 + workplace 前缀序列化成整段文本全量 encode——每 step 落库、run 结束、回滚、压缩/置位都重算一遍且无防抖；desktop 精确档一次性全量 encode 在长无标点中文串上命中 O(len²)（12K 字符实测 88~93 秒）。而压缩/置位只改变「可见消息集合」，消息内容与 token 数并没变。

技术前提（探索已实锤）：计数序列化是「段列表 join("\n")」结构，**消息段逐条独立**（只依赖消息自身 blocks + role）——消息级缓存粒度成立。WEB/SP 家族（node @agnai / Android 原生桥）为整串 encode，异步逐段调用不经济，只享会话级整串缓存。

## 目标（含成功指标）

1. 消灭无变更重复计算与压缩/置位后的全量重算：缓存全命中路径零 encode。成功指标：同会话无变更连续两次刷新，第二次零 tokenizer encode；压缩/置位后刷新，已缓存消息段零重算。
2. 全路径分块保护：desktop 精确档与 mobile GPT 家族的全量 encode 接入 ≤64 字符分块（12K 无空白中文 ≤1s）。
3. chip 刷新防抖合并：run 内多 step 不再逐 step 全量重算。

## 范围

### 包含范围

- core 句子级 token 缓存（两层：L1 会话级整串缓存 [全家族] + L2 固定切分块平面缓存 [JS 可分段路径]），键含计数器身份维度；块粒度 = 固定切分逻辑（句末符号优先 → 软边界 → 64 字符上限兜底）的纯函数产出，不依赖消息/段结构
- L2 持久化：每会话一条 KKV 记录存当前代块表，本地计数前载入作热层种子（用户拍板 2026-09-28，真实库验证后转正）
- 代际清理：保留最近 3 代（回滚/会话切换友好；「只留 1 代」在回滚场景必重算，实测库 hidden 占 63.9% 说明压缩/置位/回滚高频）
- node 精确档 encode 接分块包装（rn countTiktoken 的分块与表源改造在 fallback-caliber-align feature 内完成，本 feature 不重复触碰）
- 双端 chip 刷新读口的防抖 + 在途合并
- dynamic 段（时间宏展开文本）天然按内容 hash 进 L2，无需特判

### 不包含范围

- WEB/SP 家族的分段化（整串计数维持，只享 L1 整串缓存）
- 「usage 基线 + trailing」口径、API 值缓存（session-api-prompt-token-store）语义不动

## 核心需求

1. 切分器为纯函数（同文本任意时刻切出相同块序列，缓存正确性前提），行为由 golden 测试锁定；规则：句末符号（。！？!?；…\n 等）贪吃连续收尾 → 64 字符上限时回退最近软边界（标点/空白）→ 无软边界硬切。
2. 缓存语义：同块同计数器身份必同值；消息编辑/删除/回滚恢复靠内容 hash 天然失效；块计数加和与整串 encode 误差 ≤1%（真实库实测 -0.02% ~ +0.35%）；精确档分段后仍报原 counterKind/estimated。
3. 持久化：run 收尾/防抖后写当前代（整表覆盖写，无 GC 算法）；坏行/格式不符按 miss 静默忽略；会话删除随 KKV 级联清理。
4. 防抖不得引入新的首次同步建表路径。

## 验收标准

- Given 会话状态未变更，When 连续两次触发 chip 刷新，Then 第二次零 encode 且数值一致。
- Given 会话已有块缓存，When 压缩或置位后刷新，Then 仅新增可见部分增量计数，历史块零重算，数值与全量重算一致（误差 ≤1%）。
- Given 编辑一条消息少量字符，When 刷新，Then 仅变化邻域块重算（真实库实测模式：改 5 字 → 2 块 miss）。
- Given 重启应用且 API 值处于失效态，When 本地计数，Then 持久化种子载入后历史块命中（仅新内容现算）。
- Given 单条消息含 12K 无空白中文字符串，When 本地计数（desktop 精确档或 mobile GPT 家族），Then ≤1s。
- Given run 内连续多个 step 落库，Then chip 刷新合并为至多一次重算。
- 既有增量计数器护栏、resolve/serialize/invalidation 测试全绿。
