/**
 * @notifee/react-native 的 Jest stub。
 *
 * 原生模块在 Jest 环境不可用；moduleNameMapper 把包映射到本文件，
 * 保证未被局部 mock 的套件也能加载。需要断言行为的测试（T-P4/P5/P6）
 * 直接 import 本文件的 mock fn 后 clear/assert。
 */
export const AuthorizationStatus = {
  AUTHORIZED: 1,
  PROVISIONAL: 2,
  DENIED: 4,
} as const;

export const AndroidImportance = {
  NONE: 0,
  MIN: 1,
  LOW: 2,
  DEFAULT: 3,
  HIGH: 4,
} as const;

export const EventType = {
  DISMISSED: 0,
  PRESS: 1,
  ACTION_PRESS: 2,
  DELIVERED: 3,
  APP_KILLED: 4,
} as const;

export const displayNotification = jest.fn(async () => 'notification-id');
export const createChannel = jest.fn(async () => 'channel-id');
export const requestPermission = jest.fn(async () => ({
  authorizationStatus: AuthorizationStatus.AUTHORIZED,
}));
export const stopForegroundService = jest.fn(async () => undefined);
export const registerForegroundService = jest.fn();
export const onForegroundEvent = jest.fn(() => () => undefined);

const notifeeMock = {
  displayNotification,
  createChannel,
  requestPermission,
  stopForegroundService,
  registerForegroundService,
  onForegroundEvent,
};

export default notifeeMock;
