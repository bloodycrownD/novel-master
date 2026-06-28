---
date: 2026-06-28
dependency:
  - Iterations/message-checkpoint-v2/prd.md
  - Iterations/rollback-failure-degraded-fallback/prd.md
---

# 鍥炴粴 revision 缂哄け head 鍥炶ˉ PRD

## 鑳屾櫙

娑堟伅鍥炴粴锛坴2锛夊湪 reconcile 闃舵閫?path 璋冪敤 `restorePathToRevision`锛氫粠 checkpoint 璇诲彇 `(logicalPath 鈫?revisionVersion)`锛屽皢宸ヤ綔鍖烘仮澶嶅埌閿氱偣鏍戙€?
**鐜扮姸闂锛堜笌 `rollback-failure-degraded-fallback` 鐨勮鎺ワ級锛?*

| 鐜拌薄 | 鍚庢灉 |
|------|------|
| 浠绘剰 path 鐨?revision 琛岀己澶?| 鏁存 reconcile 鍦ㄤ簨鍔″唴澶辫触锛?*鎵€鏈?path 鍧囦笉鎭㈠** |
| 鐢ㄦ埛閫夐檷绾с€屼粎鍒犲璇濄€?| **鍏ㄩ儴** path 璺宠繃 VFS reconcile锛岃兘绮剧‘鎭㈠鐨勬枃浠朵篃鏃犳硶鎭㈠ |

鍗筹細涓埆鍧?pointer 瀵艰嚧 **涓€鍒€鍒?*鈥斺€旇涔堝叏澶辫触 + 绗簩娆?Alert锛堛€屾棤娉曟仮澶嶅伐浣滃尯 / 浠呭垹瀵硅瘽銆嶏級锛岃涔堝叏鏀惧純 VFS銆?
**鐢ㄦ埛宸茬‘璁ょ殑浜у搧鎰忓浘锛?*

- 瀵?revision **缂哄け**鐨?path锛岀敤 **live head 鍥炶ˉ** placeholder revision锛屼娇 reconcile **缁х画**锛?- 鍥炶ˉ **涓嶆槸涓轰簡**鎶婂潖蹇収淇噯锛岃€屾槸 **涓嶉樆濉?*鍏朵粬 revision 瀹屽ソ鐨?path 姝ｅ父鍥炴粴锛?- 瀵圭己澶?path 鑰岃█锛屽洖琛ュ悗 restore 鐨勬晥鏋滅瓑浠蜂簬 **璇ユ枃浠朵繚鎸?rollback 鍓嶇幇鐘?*銆?
**涓庣幇鏈夐檷绾?Alert 鐨勫叧绯伙細**

| 鍦烘櫙 | 鐜扮綉 Alert | 鏈渶姹?|
|------|------------|--------|
| revision 缂哄け | 銆屾棤娉曟仮澶嶅伐浣滃尯銆嶁啋 浠呭垹瀵硅瘽 / 鍙栨秷 | **绗簩娆?Alert**锛氥€屽揩鐓т涪澶憋紝灏嗕娇鐢ㄦ渶鏂板唴瀹逛慨澶嶃€嶁啋 缁х画 partial reconcile / 鍙栨秷 |
| 鍏朵粬 VFS 澶辫触 | 鍚屼笂锛堜粎鍒犲璇濓級 | **涓嶅彉**锛堜粛璧?degraded 娴侊級 |
| revision 鍧囧畬濂?| 鏃犵浜屾 Alert | **涓嶅彉** |

## 鐩爣锛堝惈鎴愬姛鎸囨爣锛?
| 鐩爣 | 鎴愬姛鎸囨爣 |
|------|----------|
| 閮ㄥ垎 reconcile | 澶氭枃浠跺満鏅腑锛屼粎閮ㄥ垎 revision 缂哄け鏃讹紝鐢ㄦ埛纭鍚?**瀹屽ソ path 鎭㈠鍒伴敋鐐?*锛岀己澶?path 淇濇寔鐜扮姸 |
| 鍙劅鐭ヤ慨澶?| revision 缂哄け鏃跺睍绀?**涓撶敤绗簩娆?Alert**锛屾枃妗堣鏄庡皢鐢ㄦ渶鏂板唴瀹逛慨澶嶇己澶卞揩鐓?|
| 鐢ㄦ埛鍙帶 | 绗簩娆?Alert 閫?**鍙栨秷** 鈫?娑堟伅涓庡伐浣滃尯鍧囦笉鍙橈紱閫?**缁х画** 鈫?partial reconcile + 鎴柇娑堟伅 |
| 娑堟伅鎴柇 | 缁х画璺緞涓?tail 娑堟伅涓?checkpoint 娓呯悊涓?v2 涓€鑷?|
| 鍥炲綊瀹屾暣鍥炴粴 | revision 鍧囧瓨鍦ㄦ椂锛?*鏃?*绗簩娆?Alert锛岃涓轰笌鐜扮綉 v2 涓€鑷?|

## 鐢ㄦ埛涓庡満鏅?
| 瑙掕壊 | 鍦烘櫙 |
|------|------|
| Mobile / Desktop 鍐欎綔鑰?| 闀挎寜娑堟伅 鈫?鍥炴粴 鈫?绗竴娆＄‘璁?鈫?妫€娴嬪埌蹇収涓㈠け 鈫?绗簩娆?Alert銆屽揩鐓т涪澶憋紝灏嗕娇鐢ㄦ渶鏂板唴瀹逛慨澶嶃€嶁啋 缁х画 鈫?鍏朵粬鏂囦欢姝ｅ父鍥炴粴锛屾崯鍧忔枃浠朵繚鎸佸綋鍓嶇 |
| 澶氭枃浠?Agent 浼氳瘽 | tail 鏀逛簡 A銆丅銆丆锛涗粎 B 閿氱偣 revision 涓㈠け 鈫?纭淇鍚?A銆丆 鍥為敋鐐癸紝B 涓嶅姩 |

## 鑼冨洿

### 鍖呭惈鑼冨洿

1. **Core锛氱己澶辨娴?+ head 鍥炶ˉ**
   - 鍥炴粴鍓嶆娴?target tree 鏄惁瀛樺湪 dangling revision pointer锛?   - 鏈幏鐢ㄦ埛纭锛坄revisionHeadBackfill`锛夋椂 **涓嶅啓鍏?*锛屾姏鍑?**鍙尯鍒?* 鐨勯渶鍥炶ˉ閿欒锛?   - 鐢ㄦ埛纭鍚庯細缂哄け path 鐢?live head 鍥炶ˉ placeholder锛岀户缁?reconcile銆?2. **绗簩娆?Alert锛圡obile + Desktop锛宺evision 缂哄け涓撶敤锛?*
   - **鏂囨锛堝畾妗堬級**锛氫富璇存槑 **銆屽揩鐓т涪澶憋紝灏嗕娇鐢ㄦ渶鏂板唴瀹逛慨澶嶃€?*锛涘彲琛ュ厖銆屽叾浣欐枃浠跺皢姝ｅ父鍥炴粴鑷抽敋鐐广€嶇被鍚庢灉璇存槑锛?   - **缁х画**锛氬甫 `revisionHeadBackfill` 鎵ц partial reconcile + 鎴柇娑堟伅锛?   - **鍙栨秷**锛氭棤鍙樻洿銆?3. **涓?degraded 鍒嗘祦**
   - revision 缂哄け 鈫?**鏈?Alert**锛堜慨澶嶅苟鍥炴粴锛夛紱
   - 闈?revision 缂哄け VFS 澶辫触 鈫?**鍘?degraded Alert**锛堜粎鍒犲璇濓級銆?4. **鎴愬姛鍙嶉**
   - partial reconcile 鎴愬姛鍚?Toast **銆屽洖婊氭垚鍔熴€?*锛堜笌瀹屾暣鍥炴粴鐩稿悓锛夈€?5. **娴嬭瘯**
   - 澶氭枃浠?partial銆佸崟鏂囦欢缂哄け銆佸畬鏁村洖婊?regression銆乨egraded 鍒嗘祦 regression銆?
### 涓嶅寘鍚寖鍥?
- capture 鏃?inline 鍐椾綑蹇収锛坔ybrid checkpoint锛屽彟寮€杩唬锛?- 鏍瑰洜淇锛圙C bug銆乸ull 涓嶄竴鑷淬€乮ntegrity scan CLI锛?- 瀵圭己澶?path **绮剧‘**鎭㈠鑷抽敋鐐瑰巻鍙插唴瀹?- CLI 浜や簰寮忓洖琛ョ‘璁?- 淇敼銆屾棤 checkpoint 涓嶉樆鏂€嶇瓥鐣?- 鍒犻櫎 `skipVfsReconcile` API锛堜繚鐣欑粰闈?revision 绫?degraded锛?
## 鏍稿績闇€姹?
1. **涓ゆ纭锛坮evision 缂哄け鏃讹級**  
   淇濈暀鐜版湁 destructive 绗竴娆＄‘璁わ紱妫€娴嬪埌蹇収涓㈠け鍚?**绗簩娆?* Alert锛屼笌 degraded銆屼粎鍒犲璇濄€?*鍒嗘祦**銆?
2. **缁х画 = partial reconcile**  
   鐢ㄦ埛纭淇鍚庯細瀹屽ソ path 绮剧‘鎭㈠锛涚己澶?path 鐢ㄦ渶鏂板唴瀹瑰洖琛ュ悗缁х画 restore锛堣 path 淇濇寔 rollback 鍓嶇幇鐘讹級锛泃ail 娑堟伅鍒犻櫎銆?
3. **鍙栨秷 = 鍏ㄦ垨鏃?*  
   绗簩娆?Alert 鍙栨秷鎴栧叧闂細娑堟伅涓庡伐浣滃尯涓庡彂璧峰洖婊氬墠涓€鑷淬€?
4. **revision 瀹屽ソ鏃朵笉鎵撴壈**  
   鏃?dangling pointer 鏃朵笉鍑虹幇绗簩娆?Alert锛屼竴娆″畬鎴愬洖婊氥€?
5. **鍏朵粬 VFS 閿欒浠?degraded**  
   闈?revision 缂哄け绫诲け璐ヤ粛鐢ㄣ€屾棤娉曟仮澶嶅伐浣滃尯 / 浠呭垹瀵硅瘽銆嶉檷绾?Alert銆?
## 楠屾敹鏍囧噯

### A. revision 缂哄け 鈫?绗簩娆?Alert 鈫?缁х画锛堟牳蹇冿級

- **Given** 閿氱偣鍚?`/a.md`銆乣/b.md`锛沗/b.md` 閿氱偣 revision 缂哄け锛宍/a.md` 瀹屽ソ锛泃ail 鏈熼棿涓ゆ枃浠跺潎淇敼  
- **When** 鐢ㄦ埛绗竴娆＄‘璁ゅ洖婊?鈫?鍑虹幇绗簩娆?Alert锛屽惈 **銆屽揩鐓т涪澶憋紝灏嗕娇鐢ㄦ渶鏂板唴瀹逛慨澶嶃€?* 鈫?閫夌户缁? 
- **Then** `/a.md` 鎭㈠閿氱偣鍐呭锛沗/b.md` 淇濇寔 rollback 鍓嶅唴瀹癸紱tail 娑堟伅鍒犻櫎锛汿oast銆屽洖婊氭垚鍔熴€?
### B. revision 缂哄け 鈫?绗簩娆?Alert 鈫?鍙栨秷

- **Given** 鍚?A 鐨?dangling 鏋勯€? 
- **When** 绗簩娆?Alert 閫夊彇娑? 
- **Then** 娑堟伅涓庡伐浣滃尯涓庡洖婊氬墠 **瀹屽叏涓€鑷?*

### C. revision 鍧囧畬濂斤紙鍥炲綊锛?
- **Given** R1 鍦烘櫙锛宺evision 瀹屾暣  
- **When** 鍥炴粴骞剁涓€娆＄‘璁? 
- **Then** **鏃?*绗簩娆?Alert锛沄FS + 娑堟伅鍧囨仮澶?
### D. 闈?revision 缂哄け VFS 澶辫触锛堝洖褰掞級

- **Given** reconcile 鍥犻潪 revision 缂哄け鍘熷洜澶辫触  
- **When** 鐢ㄦ埛鍥炴粴  
- **Then** 鍑虹幇 **degraded** Alert锛堥潪銆屽揩鐓т涪澶便€嶆枃妗堬級锛涖€屼粎鍒犲璇濄€嶈涓轰笌 `rollback-failure-degraded-fallback` 涓€鑷?
### E. 鍗曟枃浠?revision 缂哄け 鈫?缁х画

- **Given** 浠?`/poem.md`锛岄敋鐐?revision 缂哄け锛堝師 DF1 鏋勯€狅級  
- **When** 绗簩娆?Alert 閫夌户缁? 
- **Then** 鏂囦欢鍐呭涓嶅彉锛涙秷鎭埅鏂紱Toast 鎴愬姛

### F. 鏃?checkpoint 涓嶉樆鏂?/ Agent 杩愯涓紙鍥炲綊锛?
- 涓?v2 / degraded PRD 涓€鑷达紱revision 妫€娴嬭矾寰勪笉璇激 R9锛汚gent 杩愯涓洿鎺ユ嫆缁?
### G. 鏂囨

- **Given** revision 缂哄け绗簩娆?Alert  
- **When** 鐢ㄦ埛闃呰  
- **Then** 鍚?**銆屽揩鐓т涪澶憋紝灏嗕娇鐢ㄦ渶鏂板唴瀹逛慨澶嶃€?*锛涚户缁€夐」 **涓?* 琛ㄨ堪涓恒€屼粎鍒犲璇濄€嶏紱鏄庣‘浼氱户缁洖婊氬苟淇缂哄け蹇収

## 椋庨櫓涓庡緟纭椤?
| 椤?| 璇存槑 |
|----|------|
| 缂哄け path 闈炵簿纭仮澶?| 鐢ㄦ埛宸插湪绗簩娆?Alert 琚憡鐭ワ紱浼樹簬 silently 鎴愬姛鎴栨暣鍗曞け璐?|
| 鍙?Alert 绫诲瀷骞跺瓨 | UI 椤讳弗鏍煎尯鍒?backfill vs degraded锛岄伩鍏嶆枃妗堟贩鐢?|
| 閿氱偣搴斾负 deleted 浣?revision 涓㈠け | 杈圭晫 case锛涘洖琛ヨ鍒欒 SPEC |
