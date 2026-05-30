/**
 * Regex group repository port.
 *
 * @module domain/regex/repositories/regex-group.port
 */

import type { RegexGroup } from "../model/regex-group.js";

/** Persistence for regex groups. */
export interface RegexGroupRepository {
  list(): Promise<RegexGroup[]>;
  findById(groupId: string): Promise<RegexGroup | null>;
  insert(group: RegexGroup): Promise<void>;
  update(group: RegexGroup): Promise<void>;
  delete(groupId: string): Promise<void>;
}
