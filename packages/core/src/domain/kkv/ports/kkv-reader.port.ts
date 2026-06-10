/**
 * Minimal KKV read/write port for domain repositories.
 *
 * @module domain/kkv/ports/kkv-reader.port
 */

/** Subset of application KKV service for domain persistence adapters. */
export interface KkvReaderPort {
  get(module: string, key: string): Promise<string>;
  set(module: string, key: string, value: string): Promise<void>;
  delete(module: string, key: string): Promise<void>;
}
