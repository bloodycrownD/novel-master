---
date: 2026-09-28
dependency: iterations/context-usage-overhaul/prd.md
---

# fallback-caliber-align（兜底对齐与实现收敛）PRD

## 背景

承接迭代总纲（`docs/Iterations/context-usage-overhaul/prd.md`）范围第 5、6 条。现状三个问题：① Android Kotlin 原生桥失败时 resolve「字符折算 ceil(len/3.35) + counterKind=家族名」（谎报 + 中文低估八成）；② node 驱动 WEB/SP 家族词表加载失败退 cl100k 后 counterKind 仍报家族名（谎报）；③ 编码表缓存实际有四处独立实现（node 驱动 model:/enc: 双命名空间、RN 驱动、mobile shim、desktop renderer estimator 自建单例），同进程可重复建表（mobile 双表路径实锤）。谎报的危害通路：压缩触发器仅当 `counterKind === "heuristic"` 时乘 0.85 安全系数，家族名谎报 = 拿 cl100k 近似值卡精确阈值。

另含一条顺带升级：RN 驱动 `countTiktoken` 因包装粒度粗恒报 heuristic（GPT 家族在 mobile 永远显示近似档），升级为对齐 node 精确档，为标签体系「双端 gpt = 一致」铺路。

## 目标（含成功指标）

1. counterKind 全链路诚实：任何未用上家族词表精确计数的路径报 `heuristic`，不再谎报家族名。
2. Android 原生失败兜底数值口径与 JS 一致（cl100k，非字符折算）。
3. 编码表缓存收敛为单一实现路径：core registry + 各端构造器注入；每进程内同一编码至多构造一次，预热保留，shim 退役。
4. GPT 家族 mobile 侧升级真值计数（counterKind=tiktoken、estimated=false），双端口径一致。

## 范围

### 包含范围

- node 驱动 WEB/SP 失败分支 counterKind 降级修复
- Kotlin 失败路径改 reject 契约（删折算兜底），JS 走现成 fallbackCount 分支
- core 新增 encoding-registry（容器 + 键规范 + 生命周期），node/rn 驱动、desktop renderer estimator、双端预热接驳；mobile shim 退役
- RN countTiktoken 升级（表源、分块保护、OpenAI 包装对齐、去 free()、报真值）
- OQ#6（失败缓存不重试 → 整进程退化）按「失败缓存 + 5 分钟 TTL 重试」处理

### 不包含范围

- 不补 Android 侧 sentencepiece `.model` 资产（SP 家族修后恒走 JS cl100k 兜底，方向更准；补资产另行立项）
- 不改压缩阈值 0.85 联动语义与 token-ratio.trigger
- 不动实时速率链路行为（仅共享编码表实现）

## 核心需求

1. 谎报修复后，`estimated=true` 的返回值 counterKind 必为 `heuristic`（api 例外：恒 false）。
2. Kotlin 桥失败语义显式化（reject），JS 侧以现有 `countPromptViaNative → null → fallbackCount` 路径承接；不新增隐式失败标记。
3. registry 只按编码名单键空间（`enc:<name>`），model→encoding 解析留在上游；失败缓存 null + TTL 5 分钟重试；共享句柄绝不 free；测试钩子保留「清缓存 / 换构造器」分离。
4. countTiktoken 升级后数值与 node 精确档同口径（含 per-message overhead），encode 走 ≤64 字符分块保护。

## 验收标准

- Given node 驱动 WEB 家族词表加载失败，Then 返回 `counterKind="heuristic"` + `estimated=true`。
- Given Android 原生桥失败（资产缺失/编码异常），Then 计数走 JS cl100k 分块兜底，counterKind 报 heuristic，数值非 `ceil(len/3.35)`。
- Given 同一进程两条路径（流式估算与 prompt 计数）使用同一编码且已预热，Then 构造计数 =1。
- Given mobile GPT 家族模型本地计数（cl100k/o200k 覆盖域内的模型，如 gpt-4o / gpt-4 系），Then `counterKind="tiktoken"`、`estimated=false`，与 desktop 数值同口径；p50k/gpt2 家族（老 gpt-3.5 系）在 RN 恒走 cl100k 兜底并诚实报 heuristic（两表覆盖边界，spec 边界声明）。（12K 病态串 ≤1s 的性能验收由 message-token-cache feature 的分块落地后统一锁定，本 feature 阶段整串路径不含该断言。）
- 既有测试回归：node/rn 驱动测试、双端 estimator 测试（构造计数断言）、Kotlin parity 测试不回退。
