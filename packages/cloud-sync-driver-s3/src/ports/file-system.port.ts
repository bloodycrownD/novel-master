/**
 * cloud-sync-driver-s3 对本地文件系统的抽象。
 *
 * 这层接口的存在是为了把 `node:fs/promises` 的硬依赖从 driver 里剥离出来：
 * Node 端注入基于 `node:fs` 的实现，Mobile 端注入基于 `react-native-blob-util`
 * 的实现，driver 本身不再静态依赖任何平台模块（对应 A-26）。
 */
export interface FileSystemPort {
  /**
   * 读取本地文件全部字节，返回 Uint8Array。
   *
   * 契约：**必须返回独立新分配的数组，不得返回内部复用缓冲。**
   * `putFile` 会把返回值原样交给 S3 SDK 的 `Body`（不复制），若实现返回的是
   * 每次 readFile 都复用同一块内存、而 SDK 侧延迟消费 `Body`，就会读到被后续
   * 调用覆写的内容。现有两处注入实现（Node `fs.readFile`、mobile
   * `ReactNativeBlobUtil.fs.readFile(path, 'base64')` 解出的新数组）都满足。
   */
  readFile(path: string): Promise<Uint8Array>;
  /** 将字节写入本地文件（覆盖写入）。 */
  writeFile(path: string, bytes: Uint8Array): Promise<void>;
}
