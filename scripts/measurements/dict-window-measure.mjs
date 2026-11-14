#!/usr/bin/env node
/**
 * zlib 字典窗口测量：验证「字典只用靠后窗口」的假设。
 *
 * 用法：node scripts/measurements/dict-window-measure.mjs
 *
 * 背景：VFS pack 方案里用相邻版本当 zlib 字典，若字典长度超过 zlib 窗口，
 *   只有尾部片段会生效。这里用 700×2 行文本做 A/B 两段，分别以「AB 全量」
 *   与「单段」作字典，比较压缩体积。
 * 判据：若 `A + dict(AB)` ≈ `A alone`，说明字典只用到了靠后的窗口（A 段被截掉）。
 *
 * 退出码：0。
 */

import * as fflate from "fflate";

const encoder = new TextEncoder();
const segA = Array.from({ length: 700 }, (_, i) => "A" + i + "-xxxx-yyyy-zzzz-wwww-pad\n").join("");
const segB = Array.from({ length: 700 }, (_, i) => "B" + i + "-xxxx-yyyy-zzzz-wwww-pad\n").join("");
const dictAB = encoder.encode(segA + segB);
const dataA = encoder.encode(segA);
const dataB = encoder.encode(segB);

console.log("dict bytes", dictAB.byteLength, "| segA", dataA.byteLength, "segB", dataB.byteLength);
console.log("A alone           :", fflate.zlibSync(dataA).byteLength);
console.log("A + dict(AB 64KB) :", fflate.zlibSync(dataA, { dictionary: dictAB }).byteLength);
console.log("A + dict(B 32KB)  :", fflate.zlibSync(dataA, { dictionary: encoder.encode(segB) }).byteLength);
console.log("B + dict(AB 64KB) :", fflate.zlibSync(dataB, { dictionary: dictAB }).byteLength);
console.log("B + dict(A 32KB)  :", fflate.zlibSync(dataB, { dictionary: encoder.encode(segA) }).byteLength);
