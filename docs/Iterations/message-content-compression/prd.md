---
date: 2026-09-22
dependency: []
---

# 消息正文压缩存储 PRD（骨架，待细化）

## 背景

storage-cache-dedup-and-cleanup 迭代后，用户实测库（523MB）清理收敛到约 105MB，构成实测：`chat_message.content_json` 明文 JSON **73.1MB**（5309 条，占 chat_message 表 94%）、`message_checkpoint_file` 13.1MB（10 万行引用）、`vfs_content_blob` 8.8MB（已压缩）、file_cache 重填后约 4MB、索引杂项约 6MB。消息正文是剩余体量中唯一未压缩的大头。

## 目标（含成功指标）

`chat_message.content_json` 改为 zlib 压缩存储（对齐 `vfs_content_blob` 的编码模式），消息读写语义零变化。同规模库全库体积从约 105MB 收敛到 **50MB 量级**（中文 JSON 压缩比预估 3~4:1）。

## 用户与场景

重度长会话用户（长篇小说生成、大量 tool 调用往返）：消息正文随会话数线性累积，是清理功能之后的最大存储项。

## 范围

### 包含范围
- content_json 压缩存储（新列/新表形态 SPEC 定）+ 读写路径透明过 codec（desktop/mobile/cli 三端消费方零感知）
- 存量数据迁移（73MB 逐条搬运，非清空重填——消息是用户数据本体，不可再生）

### 不包含范围
- raw_json 清理（实测仅 1.3MB，无收益）
- message_checkpoint_file 引用行结构优化（收益小）
- 消息保留/裁剪策略（动语义，另议）

## 核心需求（3-7 条）

1. content_json 压缩落库，get/insert/update 语义与现状逐字节等价；
2. 存量迁移不可丢数据：跨启动可重入、分批不阻塞启动（vfs-content-blob-zlib 先例；**本次为必须搬运型迁移，"空占位登记"禁令与分批纪律强制适用**）；
3. 性能护栏：单条消息读写经 codec 的延迟不劣化到可感知（SPEC 定阈值）；
4. 迁移期间新旧形态可混存自愈（对齐 file_cache 迁移经验）。

## 验收标准（骨架）

- AC-1：同规模真实库迁移后 content_json 存储压缩至 1/3 以下，消息内容逐条还原一致；
- AC-2：迁移中断可重入，重启后收敛，零消息丢失；
- AC-3：既有全部消息读写相关测试零断言修改通过；
- AC-4：三端（desktop/mobile/cli）回归通过。

## 风险与待确认项

- 存量迁移是"真搬运"：跨 boot 进度持久化框架需设计（storage-cache-dedup 迭代绕开了它，本次绕不开——这是最大技术风险）；
- chat_message 读写路径消费方盘点（SPEC 阶段探索）；
- 压缩级别与性能权衡。
