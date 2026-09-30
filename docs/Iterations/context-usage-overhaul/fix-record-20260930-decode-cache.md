# 解压产物进程内缓存（统一层）修复记录 — 2026-09-30

## 用户口径（原话摘要）

> 「我觉得最简单的方式就是内存缓存解压后结果，本来计算耗时就在解压这一块，实时上你现在做的这些缓存都不如简单的把 msg 缓存到内存中，而且本来就需要展示这些可见消息，放内存也不是什么大问题。」
>
> 补充：「可见 msg 这些数据使用的地方非常多，不只是我们 token 用，还有消息发送/消息展示之类的，都是这个，我理解完全可以做成统一层，而不是简单的一个补丁。」

即：不要按消费方各打一个补丁，要在 core 里做**一条统一层**——凡「压缩落库、读时解压」的正文，解压产物（不是整条 payload、不是解析后的对象）按内容身份收进进程内 LRU，所有读口共享。

## 落地

新增 `packages/core/src/infra/content-cache/logic/decoded-content-cache.ts`（唯一一层），三个读链接入：

| 读链 | 位置 | 键 | 收益 |
| --- | --- | --- | --- |
| vfs content-store | `sqlite-vfs-content-store.ts` get/getMany | 明文 sha256（现成 content_hash） | 文件预览 / 工具读盘 / 树复制 / 冷组装回填 |
| session-kkv file_cache | `sqlite-session-kkv.repository.ts` getFileCacheEntry/getMany | 同一把 sha256 键 | workplace 组装（每次进会话都把整批文件正文再解压一遍） |
| chat_message 正文 | `message-content-codec.ts` decodeMessageContent | message id | token 组装 / 转录展示 / 发送前奏 / 用量弹窗工具计数 |

### 为什么是一个池子（统一层的关键）

`vfs_content_blob` 与 `session_file_cache_blob` 的 `content_hash` 都是 `hashContent(明文)`＝sha256(UTF-8(明文))（同一把纯函数、同一个函数、同一段字节）。所以**同一份文件正文在两套存储里天然同键**：一份内存条目同时喂 vfs 读链与 file_cache 读链，跨会话、跨文件域共享。这是「同一份数据被反复解压」这件事在架构层的收敛点，不是补丁。

### 失效纪律

- **内容池零失效**：键是内容的密码学哈希 ⇒ value 是 key 的函数，同键必同值，不存在陈旧窗口。（用户要的「内容寻址最稳」。）
- **消息池**：chat_message 没有内容哈希列，只能以主键为身份 + 写入点显式失效。`updateContent` 是「同 id 换正文」的唯一写口（必须 forget，带测试）；`insert/batchInsert/delete` 顺手防御性失效（id 全仓 `randomUUID()`、从不复用，删除其实不必失效，让 id 明确时清掉只是省预算）。后台压缩搬运与 blob 归一任务只换字节形态、正文不变，无需失效。
- **整库替换**（备份导入 / 云同步 pull）：`close 连接 → 覆盖库文件 → 重新 open + bootstrap`，同一 id 在库里换了正文、内存里还是旧的——**独立复验抓出的真洞**。收口挂 `bootstrapNovelMaster` 入口清池（双端拿到库句柄的必经之路），一处覆盖所有换库路径。

### 内存上界

双上界（条数 + 字符数）LRU：内容池 8M 字符 / 1024 条，消息池 4M 字符 / 4096 条。单条超过整池预算不收录（收录即把别的条目全逐出去、下次读自己又被逐出，纯抖动）；同键写入超预算值会清掉旧值（宁可退化成一次 miss，也不留陈旧值）。

## 验收

**测试**：新增 4 个测试文件 19 例（池单测 / 三条读链集成），core 全量 3050 例仅 2 例已知时区基线。手法是「**投毒 + 反向锁**」：把库里 blob 行换成解压必失败的字节——读到原正文就只可能来自内存；再清池复读必失败/必抛，证明上一次确实是内存命中而不是巧合。会话 file_cache 另用 SQL 计数连接钉住「全命中时连 blob 表查询都不发」。

**变异验证（8 条，全部按预期变红）**：file_cache 命中分支、vfs 命中分支、消息缓存查找、消息池 forget 整体、只拆 insert 的失效、只拆 updateContent 的失效、bootstrap 清池钩子、压缩保守系数（存量红用例重写后补验）。

**真实库 A/B**（`RECOVERY-db-20260929-1122.db`，最重会话 1032 条 / 正文 3.09MB；同库同脚本，冷读＝首读，热读＝同进程二读）：

| 读链 | 基线（无本层） | 本层 | 说明 |
| --- | --- | --- | --- |
| 全会话 listBySession | 冷 268ms / 热 254ms | 冷 278ms / 热 **37ms** | 1032 行全量解压 |
| 可见消息 listBySession | 冷 38ms / 热 30ms | 冷 39ms / 热 **10ms** | 80 条可见 |
| file_cache getMany | 冷 16ms / 热 14ms | 冷 16ms / 热 **1ms** | 36 键 / 0.14MB，冷热读值逐字节一致 |
| vfs content getMany | 冷 45ms / 热 41ms | 冷 53ms / 热 **0ms** | 40 键 / 0.97MB 压缩字节 |

（基线列取自 git stash 掉改动后的同脚本同库实测。）真机 Hermes 上纯 JS inflate 是数倍放大，热读省下的是同一笔钱。

**独立复验（只读子代理）**：六节逐条核过「内容池零失效是否成立 / 消息池失效是否够 / 命中是否真省功 / 边界判读 / 测试牙齿 / 集成面遗漏」。抓出并已修：整库替换的陈旧洞；补了三条测试缺口（超预算覆盖分支、vfs 全命中零 SQL、整库替换场景）。另记两条未改的观察：`ensureBlob` 在 fallbackPlain 与入参 hash 不匹配时会返回另一个 hash（vfs 树复制的理论缺口，非本层引入）；命中后仍逐条 `serializeFileCachePayload`（JSON.stringify，比 inflate 便宜一个量级）。

**顺手修两处存量红（上一轮遗留，非本轮引入，均已用 stash 归因复核）**：
1. `public-workplace-allowlist.json` 快照缺 `WorkplaceAssemblyAbortedError`（上一轮加导出漏更快照）；
2. `token-ratio-trigger` 的「保守阈值」用例注入通道失效——估算读数自 2026-09-30 起改「单趟 CJK 感知字符折算」、不再经 `registry.heuristic.countText`，用例往计数器塞 75000 已无效（断言恒假）。改为用真实语料（45_122 汉字 ≈ 74_000 token，落在 68_000/80_000 区间中部）注入，并复验了「拆掉保守系数即变红」。

**三条用例的观测面切换**（内存层的语义后果，刻意且有记录）：`contentStore.get` 在 blob 行被回收后、同进程内仍能从内存返回（内容由 hash 保证正确）；`blob-gc` / `rollback-ref-count` / `vfs-tree-copy-batch` 原先拿「读必抛」当「行已删」的观测面，现改为「直查 `vfs_content_blob` 行数」+「清池冷态读必抛」两段断言——原意图（行被回收 / 源侧明文不可回退时失败回滚）保留，冷态的完整性契约不变。

## 待办 / 后续候选

- 命中后仍逐条 `JSON.stringify` 重组 payload（workplace 批量读）——要消掉需把整条 payload 也缓存，但那要处理 mtime 现拼语义（现测试刻意锁住「mtime 每次从 entry 行拿」）。
- `ensureBlob` hash 不匹配理论缺口（vfs 树复制；非本层引入）。
- 真机复验：本轮纯 JS 侧（core），Metro 重载即可；预期「每次进会话/切换会话」的 build 段显著变短、run 期间 chip 刷新不再重付解压。
