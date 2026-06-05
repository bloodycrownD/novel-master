# Rich text list jitter — investigation

> Iteration: `mobile-chat-stability-fixes`  
> Default pref: **off** (`readChatRichTextEnabled`)

## Symptoms

With assistant rich text enabled, users see visible list jump/shimmer during workspace ↔ chat switch, streaming, and keyboard resize. Turning rich text off largely removes the effect.

## Root causes (verified / mitigated)

| Hypothesis | Mechanism | Mitigation in this PR |
|------------|-----------|------------------------|
| Remount blind `scrollToEnd` | `MessageList` remount resets `prevMessageCountRef`; `prevCount === 0` forced tail scroll | Scroll cache + `initialScroll` restore; skip default bottom when snapshot exists |
| `onContentSizeChange` + unconditional tail follow | Keyboard `adjustResize` and HTML reflow change content height → repeated `scrollToEnd` | `scheduleScrollToEnd` 100ms coalesce; only when `nearBottomRef` |
| Frequent stream scroll | Each 40ms buffer flush + `useEffect` on `streamingText` | Same 100ms coalesced scheduler |
| `RenderHTML` layout cost | `react-native-render-html` measures HTML; tail stays plain `Text` | Documented; default pref unchanged; thinking uses same pipeline when enabled |
| FlatList `extraData` full refresh | `{chatRichTextEnabled, richRenderEpoch}` invalidates all rows | Existing `React.memo` on `ChatMessageBody`; no pref default change |

## Tool concurrency (this iteration)

`DefaultAgentRunner` runs tool calls **serially** per assistant step. Parallelizing read-only tools would need core ordering guarantees and VFS write guards — **deferred** to a follow-up iteration.

## Follow-ups (not in this PR)

- Narrow `extraData` to per-row keys if profiling shows whole-list invalidation.
- Optional `chat-thinking` rich variant for slightly smaller typography.
- SKSP native crash outside JS `catch` → separate `sksp-android` issue if reproduced.
