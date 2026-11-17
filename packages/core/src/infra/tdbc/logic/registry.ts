/**
 * Driver registry: register and resolve TDBC drivers by name.
 *
 * @module infra/tdbc/logic/registry
 * @invariant Driver names are unique; last registration wins.
 */

import { createDriverRegistry } from "../../create-driver-registry.js";
import type { TdbcDriver } from "../ports/driver.port.js";
import { TdbcError } from "../errors.js";

/** TDBC driver registry. */
export const TdbcRegistry = createDriverRegistry<TdbcDriver>({
  notRegistered: (detail) => new TdbcError("UNKNOWN_DRIVER", `Driver not registered: ${detail}`, { driver: detail }),
  multiple: (names) => new TdbcError("UNKNOWN_DRIVER", names.length === 0 ? "No TDBC driver registered" : "Multiple drivers registered; specify options.driver"),
});
