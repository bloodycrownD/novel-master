/**
 * 用量账本仓储端口（usage_record）。
 *
 * @module domain/usage/repositories/usage-record.port
 */

import type { UsageRecordInsert } from "../model/usage-record.js";

/**
 * 账本只写不删：**不提供**任何 delete / 更新方法——删除会话、删除消息、回滚
 * 截尾、清空、删项目都不得触碰本表（账本与内容分离的接口级保证，见
 * usage-record-schema 的模块注释）。
 */
export interface UsageRecordRepository {
  /** 追加一行账本记录（单语句 INSERT，天然原子）。 */
  insert(record: UsageRecordInsert): Promise<void>;
}
