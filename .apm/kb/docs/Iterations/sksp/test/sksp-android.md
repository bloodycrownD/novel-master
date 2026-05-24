# CLI 验收：Android SKSP（Dev Screen）

- 日期: 2026-05-25
- 审查人: pending

## A0 — Gradle 编译（debug APK）

```bash
cd d:\Dev\Js\novel-master\apps\mobile\android
.\gradlew :app:assembleDebug
```

标准输出:
```
BUILD SUCCESSFUL in 15s
132 actionable tasks: 46 executed, 86 up-to-date
```

备注: 已将 `packages/sksp-android/android` 纳入 `settings.gradle`（`:sksp-android`），`app/build.gradle` 增加 `implementation project(':sksp-android')`；`MainApplication.kt` 手动 `add(SkspPackage())`。本机未连接模拟器，未做 on-device 探针。

---

## A1 — 原生模块与 JS 路径（代码审查）

| 项 | 路径 |
|----|------|
| RN 包 | `packages/sksp-android/android/.../SkspPackage.kt`、`SkspModule.kt` |
| JS 桥 | `packages/sksp-android/src/native.ts` |
| SecretStore | `packages/sksp-android/src/android-secret-store.ts` |
| 注册 | `registerSkspAndroidDriver()` + `apps/mobile/src/db/connection.ts` 单连接 |
| Dev UI | `apps/mobile/src/screens/SkspDevScreen.tsx`，ref `provider/dev-probe/apiKey` |

---

## A2 — 模拟器手工验收（待执行）

1. `npm run mobile:android`（或 Metro `npm run mobile:start` + 已安装 debug APK）。
2. 应用首页进入 **SKSP dev probe**。
3. 点 **Run set/get**：`Status` 应为 `ok`，`Last get` 显示 `…xxxx (N chars)`（不显示完整明文）。
4. 设置 → 应用 → Novel Master → 清除存储后重试：应出现 `fail:` 或 `DECRYPT_FAILED` 类提示（Keystore/IV 与数据不一致）。

备注: A2 需在 Android 模拟器或真机完成；A0 已证明原生模块可编译并链接。
