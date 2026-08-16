/**
 * `@op-engineering/op-sqlite` 的最小 ambient 类型声明（补丁，非完整 port）。
 *
 * 背景：op-sqlite 18.0.0 发布的 `lib/typescript/src/index.d.ts` 里
 * `export * from "./functions"` 是无扩展名相对导入，在 NodeNext 解析下
 * 静默解析为空（skipLibCheck 掩盖了报错），`open` / `openAsync` 等函数
 * 导出全部丢失（TS2305）。此文件以 ambient 模块声明遮蔽坏掉的发布
 * 类型，只声明本包实际用到的最小表面；升级到修复版 op-sqlite 后应删除。
 */
declare module "@op-engineering/op-sqlite" {
  export type Scalar =
    | string
    | number
    | boolean
    | null
    | ArrayBuffer
    | ArrayBufferView;

  export interface OpenOptions {
    /** 要打开的数据库文件名（不带扩展名，落盘文件本身也无后缀）。 */
    name: string;
    /**
     * 数据库文件的目录前缀。`:memory:` 打开内存库；以 `/` 开头视为
     * 绝对路径目录，最终文件为 `<location>/<name>`（不改写文件名）。
     */
    location?: string;
    encryptionKey?: string;
    /** true 时文件不存在则打开失败，不会新建空库。 */
    failOnCreate?: boolean;
    readOnly?: boolean;
  }

  export type ColumnMetadata = {
    /** 该结果集此列使用的名称。 */
    name: string;
    /** 声明的列类型；动态值（如函数返回）为 "UNKNOWN"。 */
    type: string;
    /** 该列在此结果集中的索引。 */
    index: number;
  };

  export type QueryResult = {
    insertId?: number;
    rowsAffected: number;
    rows: Record<string, Scalar>[];
    columnNames?: string[];
    /** 仅 SELECT 查询结果携带的列元信息。 */
    metadata?: ColumnMetadata[];
  };

  export type DB = {
    close(): void;
    closeAsync(): Promise<void>;
    /** 异步执行（注意命名与 quick-sqlite 反转：execute 是 Promise 版本）。 */
    execute(query: string, params?: Scalar[]): Promise<QueryResult>;
    /** 同步执行：JSI 直调、阻塞 JS 线程，供事务内切换使用。 */
    executeSync(query: string, params?: Scalar[]): QueryResult;
    /** 当前库文件的绝对路径（调试 / 核对落盘位置用）。 */
    getDbPath(location?: string): string;
  };

  export function open(params: OpenOptions): DB;

  /** 平台路径常量：非当前平台的常量为 null（如 Android 上 IOS_* 为 null）。 */
  export const IOS_DOCUMENT_PATH: string | null;
  export const IOS_LIBRARY_PATH: string | null;
  export const ANDROID_DATABASE_PATH: string | null;
  export const ANDROID_FILES_PATH: string | null;
  export const ANDROID_EXTERNAL_FILES_PATH: string | null;
}
