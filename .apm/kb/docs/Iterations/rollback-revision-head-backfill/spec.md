---
date: 2026-06-28
---

# 鍥炴粴 revision 缂哄け head 鍥炶ˉ 鎶€鏈鏍硷紙SPEC锛?
## 璁捐鐩爣

鍦?**涓嶆敼鍙?* message-checkpoint-v2 閿氱偣鏍戣涔夌殑鍓嶆彁涓嬶細

1. revision 瀹屽ソ鐨?path 鈫?绮剧‘ `restorePathToRevision`
2. revision 缂哄け鐨?path 鈫?鐢ㄦ埛纭鍚?head 鍥炶ˉ placeholder 鈫?restore锛堣 path 淇濇寔鐜扮姸锛?3. revision 缂哄け 鈫?**涓撶敤绗簩娆?Alert**锛堛€屽揩鐓т涪澶憋紝灏嗕娇鐢ㄦ渶鏂板唴瀹逛慨澶嶃€嶏級锛?*闈?* degraded銆屼粎鍒犲璇濄€?4. 鍏朵粬 VFS 閿欒 鈫?浠?`ROLLBACK_VFS_RESTORE_FAILED` + degraded UI

**闈炵洰鏍?*锛歨ybrid inline capture銆乮ntegrity CLI銆丆LI 浜や簰纭銆?
## 鎬讳綋鏂规

### 鐩爣娴佺▼

```text
UI 鈶?鐜版湁 destructive 纭
  鈻?rollbackToMessage({ revisionHeadBackfill: false })   鈫?榛樿
  鈹?  鈹溾攢 鏃?dangling revision 鈫?浜嬪姟鍐?reconcile + truncate 鈫?Toast銆屽洖婊氭垚鍔熴€?  鈹?  鈹斺攢 throw ROLLBACK_REVISION_BACKFILL_REQUIRED
        鈹?        鈻?     UI 鈶?蹇収涓㈠け Alert
        鏂囨锛氥€屽揩鐓т涪澶憋紝灏嗕娇鐢ㄦ渶鏂板唴瀹逛慨澶嶃€?        锛堝彲闄勶細鍏朵綑鏂囦欢灏嗘甯稿洖婊氳嚦閿氱偣锛?        鈹?        鈹溾攢 鍙栨秷 鈫?缁撴潫锛堟湭杩涗簨鍔★紝鏃犺剰鐘舵€侊級
        鈹?        鈹斺攢 缁х画 鈫?rollbackToMessage({ revisionHeadBackfill: true })
                    鈫?partial reconcile + truncate 鈫?Toast銆屽洖婊氭垚鍔熴€?```

### 涓?degraded 鍒嗘祦

```text
rollbackToMessage({ revisionHeadBackfill: false })
  鈹?  鈹溾攢 ROLLBACK_REVISION_BACKFILL_REQUIRED  鈫?UI 鈶?蹇収涓㈠け Alert
  鈹?  鈹斺攢 ROLLBACK_VFS_RESTORE_FAILED          鈫?UI 鈶?degraded Alert锛堜粎鍒犲璇濓級
```

### 缂哄け妫€娴嬶紙瀹氭锛?
鍦?**杩涘叆浜嬪姟涔嬪墠**锛屽熀浜庡凡瑙ｆ瀽鐨?`RollbackPlan`锛?
```typescript
async function findMissingRevisionPointers(
  revisionRepo: VfsRevisionRepository,
  entryRepo: VfsEntryRepository, // 浠?backfill 闃舵闇€瑕侊紱妫€娴嬮樁娈靛彲涓嶇敤
  scope: VfsScope,
  targetTree: Map<string, number>,
  pathsToReconcile: Set<string>,
): Promise<string[]> // logicalPaths with missing revision
```

瀵规瘡涓?`pathsToReconcile` 涓?`targetTree.has(path)` 鐨勯」锛?
- `physical = toPhysicalPath(scope, path)`
- `revisionRepo.findByPathAndVersion(physical, version)` 涓?null 鈫?璁板叆缂哄け鍒楄〃

鑻?`missing.length > 0` 涓?`!options?.revisionHeadBackfill`锛?
- throw `sessionFsRollbackRevisionBackfillRequired(missing, { sessionId, messageId })`

**涓嶅湪浜嬪姟鍐呮娴?*锛岄伩鍏?partial write銆?
### 鍥炶ˉ瑙勫垯锛堝畾妗堬級

浠呭湪 `revisionHeadBackfill: true` 鐨?reconcile 寰幆涓細

| live entry | 鍥炶ˉ revision |
|------------|---------------|
| 瀛樺湪锛坒ile锛?| `{ path, version: targetVersion, content: entry.content, status: "active", storageKind, mtimeMs: now }` |
| 涓嶅瓨鍦?| `{ path, version: targetVersion, content: null, status: "deleted", storageKind: "inline", mtimeMs: now }` |

闅忓悗 `restorePathToRevision`锛坰trict锛屾鏃?revision 蹇呭瓨鍦級銆?
### Core 鍒嗗眰

| 灞?| 鍙樻洿 |
|----|------|
| `domain/message-checkpoint/logic/detect-missing-revisions.ts` | **鏂板** `findMissingRevisionPointers` |
| `domain/message-checkpoint/logic/backfill-missing-revision.ts` | **鏂板** `backfillMissingRevisionIfNeeded` |
| `domain/message-checkpoint/logic/restore-path.ts` | **鏂板** `restorePathToRevisionWithBackfill` |
| `service/message-checkpoint/impl/message-rollback.service.ts` | 浜嬪姟鍓嶆娴嬶紱`revisionHeadBackfill` 鍒嗘敮 |
| `errors/session-fs-errors.ts` | **鏂板** `ROLLBACK_REVISION_BACKFILL_REQUIRED`銆乣isRollbackRevisionBackfillRequiredError` |
| Mobile / Desktop UI | **鏂板** `rollback-backfill` confirm 娴侊紱涓?`rollback-degraded` 骞跺垪 |

## 鏈€缁堥」鐩粨鏋?
```text
packages/core/src/
  domain/message-checkpoint/logic/
    detect-missing-revisions.ts
    backfill-missing-revision.ts
    restore-path.ts
  errors/session-fs-errors.ts
  service/message-checkpoint/
    message-rollback.port.ts              # +revisionHeadBackfill
    impl/message-rollback.service.ts
  public/session-fs.ts                    # 瀵煎嚭鏂?helper

packages/core/test/message-checkpoint/
  rollback-revision-backfill.test.ts
  rollback-degraded.test.ts               # 鏇存柊 DF1

apps/desktop/
  shared/ipc-types.ts                     # +revisionHeadBackfill
  renderer/features/chat/ConversationPanel.tsx
  src/main/ipc/handlers/messages.ts

apps/mobile/src/
  services/message-rollback.service.ts
  screens/tabs/chat-tab/useChatTabMessages.ts
```

## 鍙樻洿鐐规竻鍗?
### 1. `session-fs-errors.ts`

```typescript
export type SessionFsErrorCode =
  | ...
  | "ROLLBACK_REVISION_BACKFILL_REQUIRED";

export function sessionFsRollbackRevisionBackfillRequired(
  missingLogicalPaths: readonly string[],
  options?: { sessionId?: string; messageId?: string },
): SessionFsError;

/** UI 灞曠ず銆屽揩鐓т涪澶憋紝灏嗕娇鐢ㄦ渶鏂板唴瀹逛慨澶嶃€嶇浜屾 Alert */
export function isRollbackRevisionBackfillRequiredError(error: unknown): boolean;
```

- message 寤鸿锛歚閮ㄥ垎鏂囦欢蹇収涓㈠け锛屽皢浣跨敤鏈€鏂板唴瀹逛慨澶峘锛圲I 鍙浐瀹氬睍绀?PRD 瀹氭鍙ワ紝涓嶄緷璧?error.message 鍏ㄦ枃锛?- `missingLogicalPaths` 渚涘彲閫?debug锛沀I 榛樿涓嶅垪涓炬枃浠跺悕

### 2. `message-rollback.port.ts`

```typescript
export type RollbackOptions = {
  readonly skipVfsReconcile?: boolean;
  /** User confirmed head-backfill for missing checkpoint revisions. */
  readonly revisionHeadBackfill?: boolean;
};
```

`skipVfsReconcile` 涓?`revisionHeadBackfill` **浜掓枼**锛堝悓鏃朵紶鏃?Core reject 鎴?ignore skip锛屾祴璇曞畾妗?prefer throw锛夈€?
### 3. `message-rollback.service.ts`

```typescript
async rollbackToMessage(..., options?) {
  const plan = await this.resolveRollbackPlan(...);

  const missing = await findMissingRevisionPointers(
    this.deps.revisions, this.deps.scope, plan.targetTree, plan.pathsToReconcile, plan.scope,
  );
  if (missing.length > 0 && !options?.revisionHeadBackfill) {
    throw sessionFsRollbackRevisionBackfillRequired(missing, { sessionId, messageId: anchorMessageId });
  }

  await this.deps.conn.transaction(async (tx) => {
    if (!options?.skipVfsReconcile) {
      try {
        await this.reconcileVfsPaths(tx, plan, {
          revisionHeadBackfill: options?.revisionHeadBackfill === true,
        });
      } catch (cause) {
        throw sessionFsRollbackVfsRestoreFailed(...);
      }
    }
    await truncateTailInTransaction(...);
  });
}
```

`reconcileVfsPaths`锛?
- `revisionHeadBackfill === true` 鈫?`restorePathToRevisionWithBackfill`
- else 鈫?`restorePathToRevision`锛坰trict锛涙甯告棤 missing 鏃惰蛋姝よ矾寰勶級

### 4. UI 鏂囨锛堝畾妗堬級

| 绔?| 绗簩娆?Alert锛坮evision 缂哄け锛?|
|----|------------------------------|
| 鏍囬 | `蹇収涓㈠け` |
| 姝ｆ枃 | `蹇収涓㈠け锛屽皢浣跨敤鏈€鏂板唴瀹逛慨澶嶃€俓n\n鍏朵綑鏂囦欢灏嗘甯稿洖婊氳嚦閿氱偣銆俙 |
| 纭 | `缁х画鍥炴粴`锛圖esktop danger / Mobile destructive锛?|
| 鍙栨秷 | `鍙栨秷` |

**degraded Alert 鏂囨涓嶅彉**锛坄鏃犳硶鎭㈠宸ヤ綔鍖篳 / `浠呭垹闄ゅ悗缁璇漙锛夈€?
#### Desktop `ConversationPanel.tsx`

鎵╁睍 `confirmState`锛?
```typescript
| { kind: "rollback-backfill"; messageId: string }
```

- `executeRollback(messageId, { revisionHeadBackfill? })`
- catch `ROLLBACK_REVISION_BACKFILL_REQUIRED` 鈫?`setConfirmState({ kind: "rollback-backfill", ... })`
- `handleConfirm` 鈫?`executeRollback(messageId, { revisionHeadBackfill: true })`

#### Mobile `useChatTabMessages.ts`

```typescript
if (isRollbackRevisionBackfillRequiredError(error)) {
  Alert.alert('蹇収涓㈠け', '蹇収涓㈠け锛屽皢浣跨敤鏈€鏂板唴瀹逛慨澶嶃€俓n\n鍏朵綑鏂囦欢灏嗘甯稿洖婊氳嚦閿氱偣銆?, [
    { text: '鍙栨秷', style: 'cancel' },
    { text: '缁х画鍥炴粴', style: 'destructive', onPress: () => runRollback(id, { revisionHeadBackfill: true }) },
  ]);
  return;
}
if (isRollbackVfsDegradableError(error)) { /* 鍘?degraded 娴?*/ }
```

### 5. IPC

`SessionFsRollbackRequest` 澧炲姞 `revisionHeadBackfill?: boolean`锛沨andler 閫忎紶銆?
## 鍏煎鎬т笌杩佺Щ璇存槑

- 鏃?DB 杩佺Щ
- 鏃у鎴风鏃?`revisionHeadBackfill`锛歳evision 缂哄け浠嶆姏 **鏂伴敊璇爜**锛堥潪鏃?degraded锛夛紱鏃?UI 鍙兘鍙?Toast 娉涘寲澶辫触 鈫?闇€鍚屾鍙戠増 Mobile/Desktop
- `skipVfsReconcile` 淇濈暀缁?degraded + 娴嬭瘯

## 璇︾粏瀹炵幇姝ラ

### Phase 1 鈥?Core 妫€娴嬩笌鍥炶ˉ锛垀1d锛?
1. `findMissingRevisionPointers` + 鍗曟祴
2. `backfillMissingRevisionIfNeeded` + `restorePathToRevisionWithBackfill`
3. 閿欒鐮?+ `RollbackOptions.revisionHeadBackfill`
4. `message-rollback.service.ts` 鎺ュ叆

### Phase 2 鈥?娴嬭瘯锛垀0.5d锛?
1. `rollback-revision-backfill.test.ts`锛圧B1鈥揜B5锛?2. 鏇存柊 `rollback-degraded.test.ts`锛欴F1 鏀逛负鎶?`ROLLBACK_REVISION_BACKFILL_REQUIRED`锛涙柊澧?DF1b backfill 缁х画鎴愬姛

### Phase 3 鈥?UI锛垀0.5d锛?
1. Desktop confirmState + IPC
2. Mobile Alert 鍒嗘祦
3. 鎵嬪伐 A/B/C/G

### Phase 4 鈥?鍥炲綊锛垀0.5d锛?
`rollback.test.ts`銆乪2e銆乣format-ipc-error.test.ts` 琛ユ柊閿欒鐮佹槧灏?
## 娴嬭瘯绛栫暐

### Core 鈥?`rollback-revision-backfill.test.ts`

| ID | 鐢ㄤ緥 | 鏂█ |
|----|------|------|
| RB1 | 澶氭枃浠?partial锛涢娆℃棤 flag | rejects `ROLLBACK_REVISION_BACKFILL_REQUIRED`锛汥B 涓嶅彉 |
| RB2 | RB1 + `revisionHeadBackfill: true` | A鈫掗敋鐐癸紱B鈫掔幇鐘讹紱娑堟伅鎴柇 |
| RB3 | revision 瀹屽ソ R1 | 鏃?backfill 閿欒锛涗竴娆℃垚鍔?|
| RB4 | 棣栨 missing 鈫?鍙栨秷锛堟棤绗簩娆¤皟鐢級 | 鈥旓紙UI 鍗曟祴/鎵嬪伐锛?|
| RB5 | backfill entry 涓嶅瓨鍦?| deleted placeholder |

### Core 鈥?`rollback-degraded.test.ts`

| ID | 鍙樻洿 |
|----|------|
| DF1 | missing revision 鈫?`ROLLBACK_REVISION_BACKFILL_REQUIRED`锛堥潪 degradable锛?|
| DF1b | `revisionHeadBackfill: true` 鈫?鎴愬姛 |
| DF2+ | 淇濈暀 degraded + skip 鍦烘櫙 |

### Desktop

| ID | 鐢ㄤ緥 |
|----|------|
| RB-D1 | `formatIpcError` 鏄犲皠 `ROLLBACK_REVISION_BACKFILL_REQUIRED` |

## 椋庨櫓涓庡洖婊氭柟妗?
| 椋庨櫓 | 缂撹В |
|------|------|
| 鏂版棫 UI 涓?Core 閿欓厤 | 鍚岀増鏈彂鐗堬紱Core 鏂伴敊璇爜鏂囨。鍖?|
| backfill vs degraded 璇垽 | 鐙珛 error code + 鐙珛 UI branch |
| 妫€娴嬩笌浜嬪姟闂?race | 妫€娴嬪悗绔嬪嵆杩涗簨鍔★紱desktop 鍗曞啓鍙帴鍙楋紙涓?capture 娉ㄩ噴鍚岀骇锛?|

**浜у搧鍥炴粴**锛歳evert backfill 鍒嗘敮锛涙仮澶?revision 缂哄け 鈫?`ROLLBACK_VFS_RESTORE_FAILED` + degraded銆?
