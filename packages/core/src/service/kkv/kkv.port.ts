/**
 * KKV application service port.
 *
 * @module service/kkv/kkv.port
 */

/**
 * Module-scoped key-value store.
 *
 * @remarks Keys are isolated per module; delete on missing key throws {@link KkvError}.
 */
export interface KkvService {
  listKeys(module: string): Promise<string[]>;

  get(module: string, key: string): Promise<string>;

  set(module: string, key: string, value: string): Promise<void>;

  delete(module: string, key: string): Promise<void>;
}
