/**
 * Message checkpoint service factories.
 *
 * @module service/message-checkpoint/create-message-checkpoint-services
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqliteMessageRepository } from "@/domain/chat/repositories/impl/sqlite-message.repository.js";
import { DefaultMessageCheckpointService } from "./impl/message-checkpoint.service.js";
import { DefaultMessageRollbackService } from "./impl/message-rollback.service.js";
import { createCheckpointRepoDeps } from "./checkpoint-repo-wiring.js";
import type { MessageCheckpointService } from "./message-checkpoint.port.js";
import type { MessageRollbackService, RollbackProbe } from "./message-rollback.port.js";

/**
 * Creates a {@link MessageCheckpointService} for the given connection.
 *
 * nm-style: keep-public — 边界隔离壳：`public/message-checkpoint.ts` 只导出端口与本工厂，
 * 不导出实现类 `DefaultMessageCheckpointService`；删掉工厂会把实现类暴露到 public 面。
 * 与同文件 `createMessageRollbackService` 不同，它没有装配逻辑（无 repo 构造、无 deps 展开）。
 */
export function createMessageCheckpointService(conn: TdbcConnection): MessageCheckpointService {
  return new DefaultMessageCheckpointService({ conn });
}

/** {@link createMessageRollbackService} 可选装配项（均缺省 = 现状行为）。 */
export interface MessageRollbackServiceOptions {
  /**
   * 回滚链分段打点探针（rollback-large-jank Step 1）：mobile 在 __DEV__
   * 下注入；desktop/cli 不注入（恒 no-op）。
   */
  readonly probe?: RollbackProbe;
  /**
   * plan 拉取列表行解析的片间让步（rollback-large-jank Step 2）：mobile
   * 传 createQuantumYield(16)；缺省不传 → 直通同步 map（现状行为）。
   */
  readonly yieldFn?: () => Promise<void>;
}

/** Creates a {@link MessageRollbackService} for the given connection. */
export function createMessageRollbackService(conn: TdbcConnection, options?: MessageRollbackServiceOptions): MessageRollbackService {
  return new DefaultMessageRollbackService({
    conn,
    messageRepo: new SqliteMessageRepository(conn, options?.yieldFn),
    ...createCheckpointRepoDeps(conn),
    probe: options?.probe,
  });
}
