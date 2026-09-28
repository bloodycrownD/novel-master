import * as f from "fflate";
const te = new TextEncoder();
const segA = Array.from({ length: 700 }, (_, i) => "A" + i + "-xxxx-yyyy-zzzz-wwww-pad\n").join("");
const segB = Array.from({ length: 700 }, (_, i) => "B" + i + "-xxxx-yyyy-zzzz-wwww-pad\n").join("");
const dictAB = te.encode(segA + segB);
const dataA = te.encode(segA);
const dataB = te.encode(segB);
console.log("dict bytes", dictAB.byteLength, "| segA", dataA.byteLength, "segB", dataB.byteLength);
console.log("A alone           :", f.zlibSync(dataA).byteLength);
console.log("A + dict(AB 64KB) :", f.zlibSync(dataA, { dictionary: dictAB }).byteLength);
console.log("A + dict(B 32KB)  :", f.zlibSync(dataA, { dictionary: te.encode(segB) }).byteLength);
console.log("B + dict(AB 64KB) :", f.zlibSync(dataB, { dictionary: dictAB }).byteLength);
console.log("B + dict(A 32KB)  :", f.zlibSync(dataB, { dictionary: te.encode(segA) }).byteLength);
// 结论判据：若 A+dict(AB) ≈ A alone，说明字典只用了靠后的窗口（A 段被截掉）
