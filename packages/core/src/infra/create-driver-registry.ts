/**
 * Generic driver registry factory shared by the SKSP / TDBC / NMTP registries.
 *
 * @module infra/create-driver-registry
 */

import { assert } from "@/common/assert.js";

interface CreateDriverRegistryOptions {
    /** Registry label used in invariant messages ("Tokenizer" / "SKSP" / "TDBC"). */
    readonly label: string;
    /** Optional registration hint appended to invariant messages. */
    readonly hint?: string;
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
 * registered driver is returned. Every other outcome is an invariant
 * violation and fails through {@link assert}.
 *
 * nm-style: keep-bare — nmtp/sksp/tdbc 三个 registry 共用的通用驱动注册表工厂（单文件单函数、跨域多点消费），p23 重复组与 p24 主体桶均不在收口范围。
 */
export function createDriverRegistry<T extends { readonly name: string }>(opts: CreateDriverRegistryOptions): DriverRegistry<T> {
    const { label, hint } = opts;
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
                assert(driver != null, `${label} driver not registered: ${explicit}.${hint == null ? "" : " " + hint}`);
                return driver;
            }
            const names = [...drivers.keys()];
            assert(names.length === 1, names.length === 0 ? `${label}: no driver registered.${hint == null ? "" : " " + hint}` : `${label}: ${names.length} drivers registered (${names.join(", ")}); specify driver name.`);
            return drivers.get(names[0]!)!;
        },
    } as const;
}
