/**
 * 通用 memoize 工具：给纯函数套一层缓存，相同入参直接复用上次的结果。
 *
 * @module common/memoize
 *
 * 适用场景：AgentRunner 主循环里那些「同样输入必然同样输出」的纯函数——
 * 例如 SQL 模板解析、表达式编译、路径规范化——它们在单个 turn 内会被反复
 * 调用，每次都重算纯属浪费。套上 memoize 之后，第一次算出来的结果会被
 * 缓存，后续命中就直接返回，热点路径的开销就摊薄了。
 *
 * 实现上分两条路径：
 * - 单参数：对象 key 走 `WeakMap`（不阻碍 GC，对象释放后条目自动消失），
 *   原始值（string / number / boolean / symbol / bigint / null / undefined）
 *   走普通 `Map`。
 * - 多参数：用嵌套的 `Map` / `WeakMap` 构成树状缓存，每一层对应一个参数，
 *   最后一层挂结果。这样不用把参数序列化成字符串，对象身份也能正确区分。
 *
 * 注意：被缓存的函数必须是纯函数——不能依赖外部可变状态、不能有副作用，
 * 否则缓存命中时会跳过本应执行的副作用，行为就会偷偷错掉。
 */

/** 终端节点：挂在多参数缓存树的叶子层，存放真正的返回值。 */
interface Leaf {
  v: unknown;
}

/** 中间节点：多参数缓存树的某一层，分别用 Map / WeakMap 存原始值与对象 key。 */
interface CacheLevel {
  p: Map<unknown, CacheLevel | Leaf>;
  o: WeakMap<object, CacheLevel | Leaf>;
}

function createCacheLevel(): CacheLevel {
  return { p: new Map(), o: new WeakMap() };
}

/**
 * 判断 key 是否能安全地作为 `Map` 的键。
 *
 * 对象和函数不行——它们靠身份比较，且放进 `Map` 会阻止 GC，所以要分流到
 * `WeakMap`；其余原始类型都可以直接进 `Map`。
 */
function isPrimitiveKey(key: unknown): boolean {
  if (key === null) return true;
  const t = typeof key;
  return t !== "object" && t !== "function";
}

/**
 * 单参数版本的对象/原始值分流 memoize。
 *
 * 对象 key 用 `WeakMap`，对象被回收后条目自然消失；原始值 key 用 `Map`，
 * 命中检查走 `has`，避免把 `undefined` 当成「未命中」而漏缓存。
 */
function memoizeSingle<A, R>(fn: (arg: A) => R): (arg: A) => R {
  const primitiveCache = new Map<unknown, R>();
  const objectCache = new WeakMap<object, R>();
  return (arg: A): R => {
    if (isPrimitiveKey(arg)) {
      if (primitiveCache.has(arg)) {
        return primitiveCache.get(arg) as R;
      }
      const value = fn(arg);
      primitiveCache.set(arg, value);
      return value;
    }
    if (objectCache.has(arg as object)) {
      return objectCache.get(arg as object) as R;
    }
    const value = fn(arg);
    objectCache.set(arg as object, value);
    return value;
  };
}

/**
 * 多参数版本：用嵌套 `Map` / `WeakMap` 构成缓存树。
 *
 * 每一参数对应一层；走到最后一个参数时，把函数执行结果包成 {@link Leaf}
 * 挂到当前层，下次同样的参数序列再来就能原路命中。因为同一函数的参数个数
 * 一般固定，缓存树的深度也是固定的，不会出现长短不一的调用互相覆盖。
 */
function memoizeMulti<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const root = createCacheLevel();
  return (...args: A): R => {
    let level: CacheLevel | Leaf = root;
    for (let i = 0; i < args.length; i++) {
      const isLast = i === args.length - 1;
      const arg = args[i];
      const current = level as CacheLevel;
      const store = isPrimitiveKey(arg) ? current.p : current.o;
      let next = store.get(arg as never) as CacheLevel | Leaf | undefined;
      if (next === undefined) {
        next = isLast ? { v: fn(...args) } : createCacheLevel();
        store.set(arg as never, next);
      }
      level = next;
    }
    return (level as Leaf).v as R;
  };
}

/**
 * 给纯函数 `fn` 套一层 memoize 缓存。
 *
 * 单参数（按 `fn.length` 判定）走轻量的对象/原始值分流；多参数走嵌套缓存树。
 * 返回的函数与原函数签名一致，调用方无需改动。
 *
 * @example
 * ```ts
 * const parse = memoize((src: string) => heavyParse(src));
 * parse("a") === parse("a"); // true，第二次直接命中缓存
 * ```
 */
export function memoize<A, R>(fn: (arg: A) => R): (arg: A) => R;
export function memoize<A extends unknown[], R>(
  fn: (...args: A) => R,
): (...args: A) => R;
export function memoize(fn: (...args: unknown[]) => unknown): unknown {
  return fn.length <= 1 ? memoizeSingle(fn) : memoizeMulti(fn);
}
