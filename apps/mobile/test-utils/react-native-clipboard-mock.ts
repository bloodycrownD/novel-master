/**
 * @react-native-clipboard/clipboard 的 Jest stub。
 *
 * 原生 turbo module（RNCClipboard）在 Jest 环境 import 期即
 * `TurboModuleRegistry.getEnforcing` 抛错；moduleNameMapper 把包映射到本文件，
 * 保证未被局部 mock 的套件（native-composer 系列等）也能加载。需要控制剪贴板
 * 内容的测试可像既有套件一样用 jest.mock 局部覆盖，或直接 import 本文件的
 * `getString` 后 mockReturnValue / mockResolvedValue。
 */

export const getString = jest.fn(async () => '');
export const setString = jest.fn(() => undefined);

const clipboardMock = {getString, setString};

export default clipboardMock;
