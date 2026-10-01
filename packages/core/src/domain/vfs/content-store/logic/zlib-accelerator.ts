/**
 * 宿主注册的同步 zlib 加速器（Node 侧 `node:zlib`，RN 不注册、全走 fflate）。
 *
 * 硬约束：core src 禁止静态 import `node:` 模块（Metro 要为 RN 打包 core），
 * 所以原生实现只能由宿主（desktop main / CLI 运行时）在启动装配期显式注册；
 * **未注册时所有热路径行为与历史完全一致**（fflate 纯 JS）。已注册时热路径
 * 优先走加速器，加速器返回 null 或抛错一律回落 fflate（防御：原生实现异常
 * 不得带崩解压链路）。
 *
 * 动机（真库实测）：fflate 解压 3.24MB 需 ~273ms，`node:zlib` 仅 ~35.7ms
 *（7.6×）；千条会话 listBySession 全量（压缩态）204–317ms → ~100ms 档。
 *
 * @module domain/vfs/content-store/logic/zlib-accelerator
 */

import { errorText } from "../../../../common/error-text.js";

/**
 * 加速器契约：两个同步方法，入出均为 `Uint8Array`（实现可返回 Buffer——
 * 它是 Uint8Array 子类）。
 *
 * @remarks `deflate` 的 `level` 缺省应与 fflate 默认 6 对齐；返回 null 表示
 * 「本调用不走加速器」，由调用方回落 fflate。当前 `compressZlib` 恒不传
 * level（全链路未使用），`level` 形参与宿主适配器里的
 * `level === undefined ? ... : ...` 三元分支都是为将来 level 透传预留的，
 * 不是死代码——断言面见 `test/vfs/zlib-accelerator.test.ts` 的 level 用例。
 */
export interface ZlibCodecAccelerator {
  /** zlib deflate（wrapped zlib 格式，与 fflate zlibSync 同容器）。 */
  deflate(data: Uint8Array, level?: number): Uint8Array | null;
  /** zlib inflate（wrapped zlib 格式，与 fflate unzlibSync 同容器）。 */
  inflate(data: Uint8Array): Uint8Array | null;
}

/** 当前注册的加速器（模块级单例；注册语义对齐 tokenizer registry 先例）。 */
let activeAccelerator: ZlibCodecAccelerator | null = null;

/** 加速器回落告警是否已打过（每个方向只打一次，防热路径刷屏）。 */
const warned = { deflate: false, inflate: false };

/**
 * 收整加速器产物为**普通 `Uint8Array`**：`node:zlib` 同步接口返回 `Buffer`
 * （Uint8Array 子类，原型不同），核心内部各消费方的产物形态必须与 fflate
 * 路径一致（避免下游/断言按原型区分）。Buffer → Uint8Array 视图是零拷贝。
 */
function asPlainUint8Array(bytes: Uint8Array): Uint8Array {
  return bytes.constructor === Uint8Array
    ? bytes
    : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/**
 * 注册加速器（宿主启动装配期调用，重复注册覆盖旧值）。
 *
 * @param accelerator 同步 deflate/inflate 实现。
 */
export function registerZlibCodecAccelerator(
  accelerator: ZlibCodecAccelerator
): void {
  activeAccelerator = accelerator;
}

/**
 * 注销加速器（测试与宿主卸载用）。注销后全部热路径回落 fflate，行为与
 * 从未注册一致。
 *
 * @remarks 告警闩锁按注册期计，注销即复位（回到从未注册的状态；生产不反复
 * 注册不受影响——闩锁的用途只是防热路径刷屏，跨注册期保留反而会让后来
 * 换上的加速器抛错时静默无声）。
 */
export function clearZlibCodecAccelerator(): void {
  activeAccelerator = null;
  warned.deflate = false;
  warned.inflate = false;
}

/**
 * 尝试走加速器 deflate；未注册 / 返回 null / 抛错 → null（调用方回落 fflate）。
 */
export function tryZlibDeflate(
  data: Uint8Array,
  level?: number
): Uint8Array | null {
  const accelerator = activeAccelerator;
  if (accelerator == null) {
    return null;
  }
  try {
    const output = accelerator.deflate(data, level);
    return output == null ? null : asPlainUint8Array(output);
  } catch (error) {
    if (!warned.deflate) {
      warned.deflate = true;
      console.warn(
        `[zlib-accelerator] deflate 加速器抛错，已回落 fflate（本进程只提示一次）：${errorText(error)}`
      );
    }
    return null;
  }
}

/**
 * 尝试走加速器 inflate；未注册 / 返回 null / 抛错 → null（调用方回落 fflate）。
 */
export function tryZlibInflate(data: Uint8Array): Uint8Array | null {
  const accelerator = activeAccelerator;
  if (accelerator == null) {
    return null;
  }
  try {
    const output = accelerator.inflate(data);
    return output == null ? null : asPlainUint8Array(output);
  } catch (error) {
    if (!warned.inflate) {
      warned.inflate = true;
      console.warn(
        `[zlib-accelerator] inflate 加速器抛错，已回落 fflate（本进程只提示一次）：${errorText(error)}`
      );
    }
    return null;
  }
}
