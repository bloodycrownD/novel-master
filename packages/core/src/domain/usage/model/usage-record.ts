/**
 * 用量账本行模型（usage_record）。
 *
 * @module domain/usage/model/usage-record
 */

/**
 * 待落库的账本行（INSERT 形状；`id` 自增由库生成，不在此列）。
 *
 * 列名与 `chat_message` 的统计列同名同义（见 usage-record-schema），统计读口
 * 的聚合与筛选 SQL 因此可原样复用。全部字段可空：缺 token 真值的请求不入
 * 账本（由 {@link buildUsageRecordFromMessage} 把关），耗时类列独立可空。
 */
export interface UsageRecordInsert {
  /** 溯源：产生本请求的会话；会话删除后本行保留。 */
  readonly sessionId: string | null;
  /** 溯源：本请求对应的 assistant 消息在会话内的 seq。 */
  readonly messageSeq: number | null;
  /** 协议快照（anthropic/openai/gemini）：命中率分母的 anthropic 加法项依据。 */
  readonly provider: string | null;
  /** 服务商配置 id 快照（写入时记，服务商删除/改名不回写历史行）。 */
  readonly providerId: string | null;
  readonly modelName: string | null;
  readonly promptTokens: number | null;
  readonly completionTokens: number | null;
  readonly totalTokens: number | null;
  readonly cacheReadTokens: number | null;
  readonly cacheCreationTokens: number | null;
  readonly firstTokenMs: number | null;
  readonly durationMs: number | null;
  /** 请求完成落库时刻（统计时间轴与桶归属依据）。 */
  readonly createdAtMs: number;
}
