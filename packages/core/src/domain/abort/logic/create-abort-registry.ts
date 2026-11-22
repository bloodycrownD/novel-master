/**
 * {@link AbortRegistry} 工厂：Map 薄封装。
 *
 * @module domain/abort/logic/create-abort-registry
 */

import type { AbortRegistry } from "@/domain/abort/ports/abort-registry.port.js";
import type { AbortScope } from "@/domain/abort/model/abort-scope.js";

export const AbortRegistryFactory = {
    create(): AbortRegistry {
        const scopes = new Map<string, AbortScope>();
        // nm-style: keep-closure — scopes 是 create() 每次新建的注册表资源，与本返回字面量其余 7 个闭包方法完全同构；单独参数化反而制造 7 闭包 + 1 模块函数的不一致形态。
        const registerIfAbsent = (key: string, scope: AbortScope): boolean => {
            if (scopes.has(key)) {
                return false;
            }
            scopes.set(key, scope);
            return true;
        };
        return {
            register(key, scope) {
                scopes.set(key, scope);
            },
            registerIfAbsent,
            tryRegister: registerIfAbsent,
            abort(key, reason = "user-stop") {
                // 不删记录：删除交给 finally 的 unregister，避免 abort 与反注册的时序竞态。
                scopes.get(key)?.abort(reason);
            },
            unregister(key, scope) {
                if (scopes.get(key) === scope) {
                    scopes.delete(key);
                }
            },
            has(key) {
                return scopes.has(key);
            },
            abortAll(reason) {
                for (const scope of [...scopes.values()]) {
                    scope.abort(reason);
                }
            },
            get(key) {
                return scopes.get(key);
            },
            entries() {
                return scopes.entries();
            },
        };
    },
} as const;
