/**
 * 历史遗留的转录引擎开关（`legacy-rn` / `webview`）——**已于 2026-10-01 退役**。
 *
 * ## 为什么退役
 *
 * chat-webview-unify 迭代把「转录面 + 输入面」合并进单个
 * `ChatConversationWebView` 宿主（合成包 `chat-conversation`），`legacy-rn`
 * 那条老链路随之失去存在意义：`MessageList.tsx` / `ChatComposer.tsx` /
 * `ComposerAtPathInput.tsx` / `MessageActionMenu.tsx` 四个组件、滚动缓存的
 * legacy 回落读取、`legacy_cache_discarded` 遥测分支全部删除。用户 2026-10-01
 * 拍板 Q1：**开关随本迭代退役，不留线上回滚面**——要回滚走 git revert /
 * 重新发版，不再靠一个用户几乎不会去改的 KKV 键。
 *
 * ## 现在的语义：键照读，值一律忽略
 *
 * 即便 KKV 里还留着历史版本写入的 `legacy-rn`（这个键不会被清掉——它是用户
 * 偏好存储，不随代码迭代回收），也一律按 `webview` 走。**保留读取是刻意的**：
 * 一是这个键因此仍有一个显式的消费点，「谁在读、为什么忽略」写在这里，
 * 免得后人看到「读了个值却不用」误判成漏改、把 legacy 分支复活；二是
 * 键留在 KKV 里不会因为无人认领而显得可疑。
 *
 * 本文件**不删**：它是这段历史的口径出处，也是将来真要清理该键时的锚点。
 * 消费方仅剩 `ChatTabProvider`（读一次、值丢弃）。
 */
import {APP_UI_KEY_CHAT_TRANSCRIPT_ENGINE} from './app-ui-keys';
import {readEnumPref} from './app-ui-pref-io';
import type {AppUiPreferences} from './app-ui-prefs';

/**
 * 引擎取值。`'legacy-rn'` 只为**兼容既有 KKV 存量**而保留在联合类型里——
 * 它已不再是可选分支，代码里不应再出现按它分支的判断。
 */
export type ChatTranscriptEngine = 'legacy-rn' | 'webview';

const DEFAULT_ENGINE: ChatTranscriptEngine = 'webview';
const ALLOWED_ENGINES: readonly ChatTranscriptEngine[] = [
  'legacy-rn',
  'webview',
];

/** 恒为 `webview`（引擎开关已退役，见文件头）。 */
export function defaultChatTranscriptEngine(): ChatTranscriptEngine {
  return DEFAULT_ENGINE;
}

/**
 * 读一次引擎键、**丢弃读到的值**，恒返回 `webview`。
 *
 * 保留读动作是为了让这个键有个显式消费点（理由见文件头），返回值不带任何
 * 分支语义——调用方拿到的永远是 `DEFAULT_ENGINE`。
 */
export async function readChatTranscriptEngine(
  appUi: AppUiPreferences | null | undefined,
): Promise<ChatTranscriptEngine> {
  await readEnumPref(
    appUi,
    APP_UI_KEY_CHAT_TRANSCRIPT_ENGINE,
    ALLOWED_ENGINES,
    DEFAULT_ENGINE,
  );
  return DEFAULT_ENGINE;
}
