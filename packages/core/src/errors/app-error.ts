/**
 * 全局错误码注册表与统一错误类。
 *
 * 一个错误由「可读 key + 稳定数字码 + 运行期 message」构成：key 给人和栈用
 * （`error.name` 也设成它），抛出点写可读常量；code 给日志、统计与跨进程用，
 * 一经发布永不复用、永不改号；desc 是静态短标签，只当日志文案与 message 兜底，
 * 不替代带路径/id 的运行期 message。
 *
 * 数字按域分段分配（当前只有 AGENT 段落地，其余随各域迁移补入）：
 * 1xxx agent / 2xxx vfs / 3xxx tool / 4xxx provider / 5xxx chat /
 * 6xxx skill / 7xxx compaction + smart-sort / 8xxx config + preferences / 9xxx infra。
 *
 * @module errors/app-error
 */

/** 错误码定义表；新增码只能追加，数值不得复用或改号。 */
export const ErrorCodes = {
  AGENT_DOOM_LOOP: {code: 1001, desc: "doom loop detected"},
} as const satisfies Record<string, {readonly code: number; readonly desc: string}>;

export type ErrorKey = keyof typeof ErrorCodes;
export type ErrorNumber = (typeof ErrorCodes)[ErrorKey]["code"];

/** 跨进程/日志用的序列化形状。 */
export interface AppErrorWire {
  readonly key: ErrorKey;
  readonly code: ErrorNumber;
  readonly desc: string;
  readonly message: string;
  readonly details?: Record<string, unknown>;
}

/** 统一错误类；各域错误随迁移逐步收敛到它。 */
export class AppError<K extends ErrorKey = ErrorKey> extends Error {
  readonly key: K;
  readonly code: ErrorNumber;
  readonly desc: string;
  readonly details?: Record<string, unknown>;

  constructor(key: K, message?: string, details?: Record<string, unknown>, options?: ErrorOptions) {
    super(message ?? ErrorCodes[key].desc, options);
    this.name = key;
    this.key = key;
    this.code = ErrorCodes[key].code;
    this.desc = ErrorCodes[key].desc;
    this.details = details;
  }

  toJSON(): AppErrorWire {
    return {key: this.key, code: this.code, desc: this.desc, message: this.message, details: this.details};
  }
}

/** `instanceof` 收窄；给了 key 时再校一次业务码。 */
export function isAppError(error: unknown, key?: ErrorKey): error is AppError {
  return error instanceof AppError && (key === undefined || error.key === key);
}
