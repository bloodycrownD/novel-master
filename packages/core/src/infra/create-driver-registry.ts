/**
 * Generic driver registry factory shared by the SKSP / TDBC / NMTP registries.
 *
 * @module infra/create-driver-registry
 */

interface CreateDriverRegistryOptions {
  /** Builds the error thrown when an explicitly requested driver name is unknown. */
  readonly notRegistered: (detail: string) => Error;
  /** Builds the error thrown when implicit resolution finds zero or multiple drivers. */
  readonly multiple: (names: readonly string[]) => Error;
}

// nm-style: keep-public — createDriverRegistry 返回类型的具名契约（导出常量的 .d.ts 声明需要；无运行时直引）
export interface DriverRegistry<T extends { readonly name: string }> {
  register(driver: T): void;
  get(name: string): T | undefined;
  list(): string[];
  clear(): void;
  resolve(explicit?: string): T;
}

/**
 * Creates a driver registry whose table lives in the factory closure.
 *
 * An explicit name resolves through the table; without one, exactly one
 * registered driver is returned and every other count is delegated to
 * {@link CreateDriverRegistryOptions.multiple}.
 */
export function createDriverRegistry<T extends { readonly name: string }>(opts: CreateDriverRegistryOptions): DriverRegistry<T> {
  const drivers = new Map<string, T>();
  return {
    register: (driver) => {
      drivers.set(driver.name, driver);
    },
    get: (name) => drivers.get(name),
    list: () => [...drivers.keys()],
    clear: () => {
      drivers.clear();
    },
    resolve: (explicit) => {
      if (explicit !== undefined) {
        const driver = drivers.get(explicit);
        if (!driver) {
          throw opts.notRegistered(explicit);
        }
        return driver;
      }
      const names = [...drivers.keys()];
      if (names.length === 1) {
        return drivers.get(names[0]!)!;
      }
      throw opts.multiple(names);
    },
  } as const;
}
