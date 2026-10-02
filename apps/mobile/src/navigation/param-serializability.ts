/**
 * 路由 params 的可序列化性门禁（编译期）。
 *
 * React Navigation 的 `params` 会被写进 state（navigate 的 merge/freeze、
 * 状态持久化、深链解析都要求可序列化），函数值在序列化时被**丢弃**。
 * FileEditor 曾把 `onSessionVfsSaved?: () => void` 放进 params，8 个 navigate
 * 调用点又一处都没传它 ⇒ 恒 no-op，session 域保存成功后工作区列表不刷新（N-P1-03）。
 *
 * 为什么放在 `src/` 而不是 `__tests__`：
 * - mobile 的 jest 用 `@react-native/jest-preset`（babel-jest），**不做类型检查**，
 *   类型表达式会被 babel 直接抹除 ⇒ 写在测试里就是永远不会红的废断言；
 * - `tsconfig.build.json` 的 exclude 排除了整个测试目录 ⇒ 测试目录的类型表达式
 *   根本进不了 tsc 的检查面。
 *
 * 牙齿：把 `onSessionVfsSaved` 加回 `types.ts` 的 FileEditor params，
 * `npx tsc --noEmit -p tsconfig.build.json` 立刻报红。
 */
import type {RootStackParamList} from '@/navigation/types';

/** T 若含函数成员则为 false，否则为 true。 */
type AssertNoFn<T> = T extends (...args: never[]) => unknown ? false : true;

// 仓内不存在 `FileEditorParamList` 这个类型名，只能经 RootStackParamList 取。
export const fileEditorParamsAreSerializable: AssertNoFn<
  RootStackParamList['FileEditor']
> = true;
