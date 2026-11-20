/**
 * checkpoint 修复族的截断链转出点。
 *
 * `TruncateTail`（原 `truncateTailInTransaction`）与其参数类型被 service/chat 跨域消费
 * （message.service / message-transcript-effects.service）与测试消费，从这里 re-export；
 * conn / tx 面的具体仓储装配在 {@link MessageCheckpointFactory}（`conn.transaction`
 * 回调内必须用回调传入的 tx 现造——外层 conn 会重入驱动 AsyncMutex，那是死锁不是报错）。
 *
 * @module service/message-checkpoint/checkpoint-repo-wiring
 */

import { TruncateTail, type TruncateTailDeps, type TruncateTailParams } from "@/domain/message-checkpoint/logic/truncate-tail-in-transaction.js";

export type { TruncateTailDeps, TruncateTailParams };
export { TruncateTail };
