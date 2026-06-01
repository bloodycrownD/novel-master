/**
 * Factory for {@link DefaultSessionMacroCache}.
 *
 * @module service/prompt/create-session-macro-cache
 */

import { DefaultSessionMacroCache } from "./impl/session-macro-cache.service.js";
import type { SessionMacroCache } from "./session-macro-cache.port.js";

export function createSessionMacroCache(): SessionMacroCache {
  return new DefaultSessionMacroCache();
}
