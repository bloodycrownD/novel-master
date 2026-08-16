/**
 * Metro 安全的 {@link OpSqliteAdapter}：静态 import @op-engineering/op-sqlite。
 *
 * @module tdbc-driver-op-sqlite/impl/op-sqlite-native.adapter
 */

import {
  ANDROID_FILES_PATH,
  IOS_DOCUMENT_PATH,
  open,
} from "@op-engineering/op-sqlite";
import {
  BaseOpSqliteAdapter,
  type OpSqliteBindings,
} from "./op-sqlite.adapter.js";

/** op-sqlite 自带 TS 类型，无需手写 .d.ts；此处只收敛签名差异。 */
type InjectedOpen = OpSqliteBindings["open"];
type InjectedOptions = Parameters<InjectedOpen>[0];
type InjectedDb = ReturnType<InjectedOpen>;

/** 包一层消除参数型变差异（Scalar[] vs unknown[]，运行时安全：归一化后的绑参都是 Scalar）。 */
function toInjectedOpen(): InjectedOpen {
  return (options: InjectedOptions): InjectedDb =>
    open(options) as unknown as InjectedDb;
}

/** RN / Metro 入口 adapter：静态 peer import，保证打包器依赖图完整。 */
export class NativeOpSqliteAdapter extends BaseOpSqliteAdapter {
  constructor() {
    super({
      open: toInjectedOpen(),
      ANDROID_FILES_PATH: ANDROID_FILES_PATH as string | null | undefined,
      IOS_DOCUMENT_PATH: IOS_DOCUMENT_PATH as string | null | undefined,
    });
  }
}
