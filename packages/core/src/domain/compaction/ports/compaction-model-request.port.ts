/**
 * Narrow port for compaction summary LLM requests.
 *
 * @module domain/compaction/ports/compaction-model-request.port
 */

/** Compaction summary 所需的 LLM 请求能力（窄 port）。 */
export interface CompactionModelRequest {
  request(
    applicationModelId: string,
    userContent: string,
    options?: { readonly stream?: false; readonly tools?: undefined },
  ): Promise<{ readonly assistantText: string }>;
}
