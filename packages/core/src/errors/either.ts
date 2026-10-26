/**
 * Result / Either 结果类型：为 errors/ 下各域错误类配套的返回值层（对象风格）。
 *
 * 设计取舍（与仓库现状的对接）：
 * - 失败载荷 E 约定就是各域 XxxError（连同其 code 判别码与上下文字段），
 *   不另造错误模型；本模块只补「把错误放进返回值类型签名」这一层。
 * - 对象风格：Ok / Err 是带方法的类，组合子挂在原型上链式调用；全部入口
 *   （含迁移期桥接 attempt* 与 toError）统一收在 `Result` 命名空间上——
 *   const 与 type 同名双声明（值空间提供静态方法，类型空间描述联合；
 *   Result 是类型别名，TS 不允许类型别名挂静态，const 对象是 Math 形态）。
 *   分支判断用 `r.ok` 字段收窄（字面量判别字段，类实例同样支持判别联合收窄）。
 * - 跨进程（Electron IPC / RN 桥 / worker）：类实例过这些通道只剩 own 字段、
 *   原型上的方法会丢。序列化入口是 `toJSON()`（JSON 通道被 stringify 自动
 *   调用，structuredClone 通道直接传实例、own 字段本身即线上形态），落地端
 *   用 `Result.revive()` 重建带方法的实例。两端 import 本模块同一份实现，
 *   不存在双端重写。
 * - 迁移期桥接：`Result.attempt*` 把「会 throw 的函数」收编成 Result——**所有**
 *   抛出物（含非域的基础设施故障）一律进 Err，桥接层绝不重抛；域守卫在拿到
 *   Err 之后按需收窄 error。
 *
 * 本文件只新增能力，不改动任何现有错误类；各域迁移节奏由上层决定。
 *
 * @module errors/either
 */

/**
 * Result 的线上形态：跨 IPC / JSON 传输时的纯数据 DTO。
 *
 * 由 `toJSON()` 产出、{@link Result.revive} 消费。error 侧是 unknown：
 * JSON 通道下是 serializeErrorPayload 的产物，structuredClone 通道下 Error
 * 本体还在。
 */
export type ResultWire<T> =
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: unknown };

/** Either 风格结果：`if (r.ok)` 即完成分支收窄，组合子见两个类的方法。 */
export type Result<T, E> = Ok<T, E> | Err<T, E>;

/**
 * 成功分支实例；入口用 {@link Result.ok}。`ok: true` 时 value 一定存在。
 */
export class Ok<T, E> {
    readonly ok = true as const;

    constructor(readonly value: T) {
    }

    /** JSON.stringify 钩子，兼显式序列化入口（线上形态见 {@link ResultWire}）。 */
    toJSON(): ResultWire<T> {
        return {ok: true, value: this.value};
    }

    /** 成功时变换 value，失败原样透传。 */
    map<U>(fn: (value: T) => U): Result<U, E> {
        return Result.ok(fn(this.value));
    }

    /** 失败时变换 error（含换错误类型），成功原样透传。 */
    mapErr<F>(_fn: (error: E) => F): Result<T, F> {
        void _fn;
        return this as unknown as Ok<T, F>;
    }

    /** 成功时接续下一个会返回 Result 的步骤（flatMap）；失败短路透传。 */
    andThen<U>(fn: (value: T) => Result<U, E>): Result<U, E> {
        return fn(this.value);
    }

    /** 失败时换一条返回 Result 的补救路径；成功原样透传。 */
    orElse<F>(_fn: (error: E) => Result<T, F>): Result<T, F> {
        void _fn;
        return this as unknown as Ok<T, F>;
    }

    /** 失败时取默认值（无回调形态）。 */
    unwrapOr(_fallback: T): T {
        void _fallback;
        return this.value;
    }

    /** 失败时以 error 为入参计算默认值。 */
    unwrapOrElse(_fallback: (error: E) => T): T {
        void _fallback;
        return this.value;
    }

    /** 双分支都必须给值（穷尽处理，UI 展示常用）。 */
    match<U>(onOk: (value: T) => U, _onErr: (error: E) => U): U {
        void _onErr;
        return onOk(this.value);
    }

    /** map 的异步版：fn 返回 Promise，失败短路透传。 */
    async mapAsync<U>(fn: (value: T) => Promise<U>): Promise<Result<U, E>> {
        return Result.ok(await fn(this.value));
    }

    /** andThen 的异步版：fn 返回 Promise<Result>，失败短路透传。 */
    async andThenAsync<U>(fn: (value: T) => Promise<Result<U, E>>): Promise<Result<U, E>> {
        return fn(this.value);
    }
}

/**
 * 失败分支实例；入口用 {@link Result.err}。error 保持传入对象本身
 * （不复制不包装，端上按 code 分类依赖原对象；短路方法返回 this，链上同样不换壳）。
 */
export class Err<T, E> {
    readonly ok = false as const;

    constructor(readonly error: E) {
    }

    /** JSON.stringify 钩子，兼显式序列化入口；error 经 serializeErrorPayload 展开。 */
    toJSON(): ResultWire<never> {
        return {ok: false, error: serializeErrorPayload(this.error)};
    }

    /** 成功时变换 value，失败原样透传。 */
    map<U>(_fn: (value: T) => U): Result<U, E> {
        void _fn;
        return this as unknown as Err<U, E>;
    }

    /** 失败时变换 error（含换错误类型），成功原样透传。 */
    mapErr<F>(fn: (error: E) => F): Result<T, F> {
        return Result.err(fn(this.error));
    }

    /** 成功时接续下一个会返回 Result 的步骤（flatMap）；失败短路透传，fn 不被调用。 */
    andThen<U>(_fn: (value: T) => Result<U, E>): Result<U, E> {
        void _fn;
        return this as unknown as Err<U, E>;
    }

    /** 失败时换一条返回 Result 的补救路径；成功原样透传，fn 不被调用。 */
    orElse<F>(fn: (error: E) => Result<T, F>): Result<T, F> {
        return fn(this.error);
    }

    /** 失败时取默认值（无回调形态）。 */
    unwrapOr(fallback: T): T {
        return fallback;
    }

    /** 失败时以 error 为入参计算默认值。 */
    unwrapOrElse(fallback: (error: E) => T): T {
        return fallback(this.error);
    }

    /** 双分支都必须给值（穷尽处理，UI 展示常用）。 */
    match<U>(_onOk: (value: T) => U, onErr: (error: E) => U): U {
        void _onOk;
        return onErr(this.error);
    }

    /** map 的异步版：失败短路透传，fn 不被调用。 */
    async mapAsync<U>(_fn: (value: T) => Promise<U>): Promise<Result<U, E>> {
        void _fn;
        return this as unknown as Err<U, E>;
    }

    /** andThen 的异步版：失败短路透传，fn 不被调用。 */
    async andThenAsync<U>(_fn: (value: T) => Promise<Result<U, E>>): Promise<Result<U, E>> {
        void _fn;
        return this as unknown as Err<U, E>;
    }
}

/**
 * Result 的静态入口（与类型 {@link Result} 同名双声明）。
 *
 * ok/err 的对侧类型参数填 never（neverthrow 同款），内联链式调用时泛型
 * 可从上下文推断（err 侧直接链式时 T 钉死为 never，需函数签名/注解提供 T）；
 * revive 是跨进程落地端的重建入口；attempt* 是迁移期把 throw 收编为
 * Result 的桥接；toError 做 unknown 抛出物的 Error 归一。两端共用本实现。
 */
export const Result = {
    /** 包装成功值。 */
    ok<T>(value: T): Result<T, never> {
        return new Ok(value);
    },

    /** 包装失败载荷；error 保持传入对象本身。 */
    err<E>(error: E): Result<never, E> {
        return new Err(error);
    },

    /**
     * 从线上形态重建带方法的 Result 实例（跨进程落地端）。
     *
     * 信任模型：同版本内部通道（Electron IPC / worker / RN 桥）。载荷在边界处
     * 由调用方断言为 {@link ResultWire}（TS 类型运行时不存在，这是唯一一次断言），
     * 本方法只负责重建实例与错误侧还原。断言不成立（形状违约）时抛错快速失败，
     * 不伪造成功、也不把协议问题伪装成业务失败。若将来出现「持久化回读 / 跨版本
     * 数据可能损坏、需优雅降级」的场景，再加独立的 safeRevive，不占主路径。
     *
     * error 侧带 name/message 的序列化产物会被重建为 Error 实例（code 等字段
     * 回填，结构守卫可用）。
     */
    revive<T, E>(wire: ResultWire<T>): Result<T, E> {
        // ⚠️ 按「运行时未知」校验，不依赖 ResultWire 的类型承诺：wire 来自进程
        // 边界，调用方的断言可能撒谎。这里必须 `=== true` / `=== false` 精确判别，
        // 不能写成真值判断——`if (!wire.ok)` 会把 undefined / 字符串 / 裸对象
        // 一并吞进 Err，伪造出「业务失败」（IDE 的「简化布尔表达式」建议在此
        // 不适用：它假设 ok 已是 boolean，而这正是本方法要验的东西）。
        const candidate: {
            readonly ok?: unknown;
            readonly value?: unknown;
            readonly error?: unknown;
        } = wire;
        if (candidate.ok === true) {
            return new Ok<T, E>(candidate.value as T);
        }
        if (candidate.ok === false) {
            return new Err<T, E>(deserializeErrorPayload(candidate.error) as E);
        }
        throw new Error("Result.revive 收到非 Result 线上形态：调用方对载荷的形状断言不成立");
    },

    /**
     * 把同步 throw 收编为 Result：任何抛出物（域错误、基础设施故障、字符串、
     * 裸对象）都包进 Err，本方法**从不重抛**。错误侧是 unknown，调用方在拿到
     * Err 之后按需用域守卫收窄（`if (!r.ok && isVfsError(r.error))`）。
     */
    attempt<T>(fn: () => T): Result<T, unknown> {
        try {
            return Result.ok(fn());
        } catch (error) {
            return Result.err(error);
        }
    },

    /**
     * 把 Promise reject 收编为 Result：任何 reject 原因都包进 Err，从不重抛；
     * 收窄约定同 {@link Result.attempt}。
     */
    async attemptAsync<T>(fn: () => Promise<T>): Promise<Result<T, unknown>> {
        try {
            return Result.ok(await fn());
        } catch (error) {
            return Result.err(error);
        }
    },

    /**
     * unknown 抛出物归一为 Error：Error 原样返回（保住 code 等子类字段），
     * 字符串/对象包成新 Error 并把原始值挂在 cause 上。
     */
    toError(cause: unknown): Error {
        if (cause instanceof Error) {
            return cause;
        }
        let message: string;
        if (typeof cause === "object" && cause !== null) {
            try {
                message = JSON.stringify(cause) ?? String(cause);
            } catch {
                message = String(cause);
            }
        } else {
            message = String(cause);
        }
        return new Error(message, {cause});
    },
};

/**
 * Error 序列化（JSON 通道用）：保 name / message 与 own 可枚举字段
 * （code、path 等判别与上下文字段都在这里），非 Error 抛出物原样。
 */
function serializeErrorPayload(error: unknown): unknown {
    if (!(error instanceof Error)) {
        return error;
    }
    const plain: Record<string, unknown> = {
        name: error.name,
        message: error.message,
    };
    for (const [key, value] of Object.entries(error)) {
        plain[key] = value;
    }
    return plain;
}

/**
 * serializeErrorPayload 的落地端：带 name/message 的序列化产物重建为 Error
 * 实例（code 等字段回填，`name` 还原后结构守卫照常可用）；Error 本体原样
 * （structuredClone 通道里 Error 还是 Error）；其余（字符串等）原样。
 */
function deserializeErrorPayload(raw: unknown): unknown {
    if (raw instanceof Error) {
        return raw;
    }
    if (
        typeof raw === "object" &&
        raw !== null &&
        typeof (raw as { message?: unknown }).message === "string" &&
        typeof (raw as { name?: unknown }).name === "string"
    ) {
        const {name, message, ...rest} = raw as { name: string; message: string; } & Record<string, unknown>;
        const revived = new Error(message);
        Object.assign(revived, rest);
        revived.name = name;
        return revived;
    }
    return raw;
}
