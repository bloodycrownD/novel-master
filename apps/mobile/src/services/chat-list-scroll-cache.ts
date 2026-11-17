/**
 * v1 chat list scroll cache 的兼容入口（key 命名空间与「按项目清理」）。
 *
 * 历史上这里还存着 legacy RN FlatList 的滚动快照（offsetY 是「距底部距离」），
 * 但 v1 的唯一写入者 `MessageList` 已随 chat-webview-unify Step 8 退役删除，
 * 快照本体只剩 `chat-transcript-scroll-cache`（v2，前向 DOM 语义）一份。
 *
 * `useChatTabStream` 仍从这里取 key、`useChatTabScope` 仍从这里调用按项目
 * 清理——两处都直接复用 v2 的实现：本文件不再持有独立的 cache 实例，也不再
 * 重复定义 `scrollCacheKey`（签名审计十五期：两份逐字相同）。
 *
 * `clearScrollSnapshotsByProject` 原先清理的是本文件里永远为空的 v1 cache
 * （no-op）；改为指向 v2 清理后，唯一调用点 `useChatTabScope` 本就紧接着调
 * `clearTranscriptScrollSnapshotsByProject`，项目删除后的终态不变。
 */
export {scrollCacheKey, clearTranscriptScrollSnapshotsByProject as clearScrollSnapshotsByProject} from './chat-transcript-scroll-cache';
