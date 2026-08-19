/**
 * document-pick 通用封装：用户取消两态归一为 null 的单测。
 * mock 掉 @react-native-documents/picker，不触真实选择器。
 */
jest.mock('@react-native-documents/picker', () => ({
  errorCodes: {OPERATION_CANCELED: 'OPERATION_CANCELED'},
  isErrorWithCode: (error: unknown): error is {code: string} =>
    typeof error === 'object' &&
    error != null &&
    'code' in error &&
    typeof (error as {code: unknown}).code === 'string',
  pick: jest.fn(),
}));

import {pick} from '@react-native-documents/picker';
import {pickSingleDocument} from '../src/services/document-pick';
import {registerAppToastSink} from '../src/services/app-toast';

const pickMock = pick as unknown as jest.Mock;

describe('pickSingleDocument 用户取消归一', () => {
  const shown: string[] = [];

  beforeEach(() => {
    pickMock.mockReset();
    shown.length = 0;
    registerAppToastSink((msg: string) => shown.push(msg));
  });

  afterAll(() => {
    registerAppToastSink(null);
  });

  test('iOS reject OPERATION_CANCELED → 返回 null 并弹「已取消」', async () => {
    pickMock.mockRejectedValue({code: 'OPERATION_CANCELED'});
    await expect(
      pickSingleDocument({type: ['public.zip']}),
    ).resolves.toBeNull();
    expect(shown).toEqual(['已取消']);
  });

  test('Android resolve 空数组 → 返回 null 并弹「已取消」', async () => {
    pickMock.mockResolvedValue([]);
    await expect(
      pickSingleDocument({type: ['public.yaml']}),
    ).resolves.toBeNull();
    expect(shown).toEqual(['已取消']);
  });

  test('正常选择 → 原样返回文件，不弹 toast', async () => {
    const file = {uri: 'file:///tmp/a.zip', name: 'a.zip'};
    pickMock.mockResolvedValue([file]);
    await expect(pickSingleDocument({type: ['public.zip']})).resolves.toStrictEqual(
      file,
    );
    expect(shown).toEqual([]);
  });

  test('非取消错误 → 原样抛出', async () => {
    pickMock.mockRejectedValue(new Error('boom'));
    await expect(pickSingleDocument({type: ['public.zip']})).rejects.toThrow(
      'boom',
    );
    expect(shown).toEqual([]);
  });
});
