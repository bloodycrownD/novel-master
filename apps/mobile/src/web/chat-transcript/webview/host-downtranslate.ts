/**
 * chat-transcript 独立入口的下行 v2→v1 翻译层（composer-native-2026-10 Step 2；
 * 真机白屏根因层，3d206251e 修）。
 *
 * 宿主下行全是 v2 信封，而 runtime 的 `handleHostMessage` 用
 * `matchHostMessage(raw, BRIDGE_V)` 只认 v1——合成包时代这层拆包重打包由
 * dispatcher 承担，dispatcher 随包退役后若 runtime 直绑通道，init/快照会在
 * `if (!msg) return` 处被静默丢弃（白屏无错误页）。故入口（`main.ts`）承接
 * dispatcher 的 transcript 半边：**先**单次注册宿主通道，把 v2 拆包重打包成
 * v1 喂给 runtime；runtime 以 `bindChannel: false` 装配（不再自绑，单次注册
 * 纪律保持）。未知 type 透传给 runtime 的 switch 自行忽略（宽松口径与
 * dispatcher 一致）。
 *
 * 独立成模块（而非 main.ts 内私有函数）是为可测：白屏根因层必须能被单测直接
 * 调用锁定——改回 v1 直绑、删掉这层翻译或动 v 号常量，行为断言即红。
 */
import {handleHostMessage} from '@web/chat-transcript/webview/runtime/bridge';
import {BRIDGE_V} from '@web/chat-transcript/webview/runtime/state/state';

/**
 * 入口信封桥版本（v2）。与合成包 `CONVERSATION_BRIDGE_V` 同值：宿主的 ready
 * 验收只认 `v === 2`，v 号语义是「v2 协议文档」而非「某个具体包」——入口的
 * 上行出口（`createBoundPost`）与下行信封校验共用这一个常量。
 */
export const TRANSCRIPT_ENTRY_BRIDGE_V = 2;

/**
 * runtime 老桥的下行信封版本（CR-fix-12：单一来源——直接 import runtime
 * state 的 `BRIDGE_V`，不再手抄一份字面量；v1 契约只此一处语义）。
 */
export const TRANSCRIPT_RUNTIME_BRIDGE_V = BRIDGE_V;

/** v2 信封的最小形状（本层校验只依赖 `v` / `type`，payload 原样透传）。 */
type HostEnvelopeV2 = {
  readonly v?: unknown;
  readonly type?: unknown;
  readonly payload?: unknown;
};

/**
 * 下行 v2→v1 翻译（宿主通道回调）：拆包、校验、重打成 runtime 认识的 v1 信封。
 *
 * 宽松解析口径（与 dispatcher 一致，CR-fix-10：`unknown` + 具名收窄，禁 any）：
 * - 宿主已 JSON.parse 的对象（非 string）与未解析的原始 string 双形态都吃；
 * - 坏 JSON / 非对象 / 缺 `v`、`type` 字段 / `v` ≠ 2 → 静默丢弃，不喂给
 *   runtime（runtime 的 v1 匹配本就该由本层独家承担）；
 * - payload 原样透传——重打信封只换 v 号，语义内容零改动。
 */
export function rawDowntranslate(raw: unknown): void {
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
  }
  if (parsed == null || typeof parsed !== 'object') {
    return;
  }
  const env = parsed as HostEnvelopeV2;
  if (
    typeof env.v !== 'number' ||
    env.v !== TRANSCRIPT_ENTRY_BRIDGE_V ||
    typeof env.type !== 'string'
  ) {
    return;
  }
  handleHostMessage({
    v: TRANSCRIPT_RUNTIME_BRIDGE_V,
    type: env.type,
    payload: env.payload,
  });
}
