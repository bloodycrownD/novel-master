/**
 * SKSP driver registry (mirrors TDBC registry semantics).
 *
 * @module infra/sksp/logic/registry
 */

import type { SecretStore } from "@/infra/sksp/index.js";
import { createDriverRegistry } from "../../create-driver-registry.js";

/** Factory for platform-specific {@link SecretStore} instances. */
// nm-style: keep-public — @novel-master/core/sksp 子入口再导出的公共类型契约（无生产直引）
export interface SkspDriver {
    readonly name: string;
    createStore(connection: unknown): SecretStore;
}

/** SKSP driver registry. */
export const SkspRegistry = createDriverRegistry<SkspDriver>({ label: "SKSP" });
