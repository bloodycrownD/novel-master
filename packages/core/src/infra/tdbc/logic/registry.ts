/**
 * Driver registry: register and resolve TDBC drivers by name.
 *
 * @module infra/tdbc/logic/registry
 * @invariant Driver names are unique; last registration wins.
 */

import { createDriverRegistry } from "../../create-driver-registry.js";
import type { TdbcDriver } from "../ports/driver.port.js";

/** TDBC driver registry. */
export const TdbcRegistry = createDriverRegistry<TdbcDriver>({ label: "TDBC" });
