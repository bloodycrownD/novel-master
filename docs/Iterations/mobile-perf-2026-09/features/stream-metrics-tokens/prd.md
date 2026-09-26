---
date: 2026-09-23
dependency: []
---

# 会话指标条 token 化改造 PRD（feature ④）

## 背景

会话页流式指标条现状为「生成中 · 12.3s · 正文 1,234 字 · 思考 567 字 · 89 字/秒」：正文与思考分开显示、按字符计数（delta.length）、速率为全程平均（totalChars/elapsed）。用户拍板：合并为「输出」、单位 token（t）、速率 t/s、且速率必须是**实时**速率（平均速率是缺陷）。token 源优先用协议 usage，usage 不可得用 tokenizer 兜底。

## 目标

指标条显示「生成中 · elapsed · 输出 N t · M t/s」：token 数尽量真实（usage 优先）、速率反映当前窗口速度（2~3s 量级）、双端一致。

## 现状约束（探索实证）

- anthropic（message_delta 流中多次累计 output_tokens）与 gemini（每块 usageMetadata 累计）的流中 usage 数据已在 parser state、只差 emit；openai 协议仅最后一块带 usage（三方网关可能全程不给）。
- ~~真同步 tokenizer 只有 heuristic（len/3.35，英文口径中文低估约半）；真 tokenizer 异步 prompt 级 API，逐 delta 不可行。~~ → **2026-09-26 更新**：`js-tiktoken` 是 mobile 既有依赖（纯 JS，Metro 已重定向 shim，离线可用、零新增包体），逐 delta 的**尾窗增量**真 BPE 计数可行（实测中文长文误差 +0.31%、单次 push 稳态峰值 <1ms），实时估算已升级；原生桥 tokenizer-driver-rn 仍是异步 prompt 级，本轮不动（见 spec 第 5 节）。

## 核心需求

1. 新增流中 usage 事件（anthropic/gemini 流中累计、openai 流尾终值）；
2. token 计数 usage 优先、heuristic 增量兜底、usage/done 到达时校正；
   - **2026-09-26 补充（用户拍板）**：校正语义定为「**usage 基线 + 增量偏移**」——usage 到达时把真值设为基线，此后 delta 的增量继续叠加（真值后不再停止回写）；速率采样在「source 翻转」与「窗口折叠后的首个新样本」两个校正点重 seed，保证多步 run（工具 step 静默 + 后续文本）终态仍有速率段。
   - **2026-09-26 补充（用户拍板）**：实时估算从 `chars/3.35` 升级为 **js-tiktoken 尾窗增量**（纯中文/纯英文的误差各降一个量级）；估算器不注入时走旧启发式路径（**未收到 usage 前与旧口径严格一致；usage 到达后按「基线 + 增量」口径**，见 spec 第 3 节；`tokenSource` 字段语义与 DB 列不动）。
3. 速率改实时（时间窗口制，慢速流不冻结、高速流不抖动）；
4. 双端数据链改造（mobile unit 投影 / desktop hook 直连 IPC，共用 core 格式与速率纯函数）；
5. 中断现场恢复（run_state 持久化 token 口径）。

## 验收标准

- AC-1：anthropic/gemini 模型生成中实时显示接近真实的 t 与 t/s；openai 模型流中显示 heuristic 估值、流尾跳正为 usage 终值；全程无 usage 网关不中断显示；
- AC-2：速率窗口内反映当前速度（暂停输出时速率回落趋零，恢复输出回升），非全程平均；
- AC-3：双端指标条文案一致；既有指标条/流式测试适配后全绿。
