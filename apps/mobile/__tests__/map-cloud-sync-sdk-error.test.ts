import {AppError} from '@novel-master/core';
import {mapCloudSyncSdkError} from '@/services/map-cloud-sync-sdk-error';

type MappingCase = {
  name: string;
  error: unknown;
  key: AppError['key'];
  message: string;
  messageNotContains?: string;
};

const cases: MappingCase[] = [
  {
    name: 'InvalidAccessKeyId → AUTH',
    error: {
      name: 'InvalidAccessKeyId',
      message:
        'The AWS Access Key Id you provided does not exist in our records.',
    },
    key: 'CLOUD_SYNC_AUTH',
    message: '云存储凭据无效或权限不足',
  },
  {
    name: 'NoSuchBucket → 桶文案',
    error: {
      name: 'NoSuchBucket',
      message: 'The specified bucket does not exist',
    },
    key: 'CLOUD_SYNC_NETWORK',
    message: '无法访问该存储桶，请检查 Bucket 名称',
  },
  {
    name: 'timeout → 网络文案',
    error: new Error('Connection timeout while contacting endpoint'),
    key: 'CLOUD_SYNC_NETWORK',
    message: '无法连接云存储，请检查网络与 Endpoint',
  },
  {
    name: 'Deserialization error → 兜底不含 Deserialization',
    error: new Error('Deserialization error: Unable to parse response body'),
    key: 'CLOUD_SYNC_NETWORK',
    message: '云存储连接失败，请检查网络与配置',
    messageNotContains: 'Deserialization',
  },
  {
    name: 'DOMParser message → 兜底',
    error: new Error("Property 'DOMParser' doesn't exist"),
    key: 'CLOUD_SYNC_NETWORK',
    message: '云存储连接失败，请检查网络与配置',
  },
  {
    name: 'SecondLevelDomainForbidden → Path style 提示（非凭据）',
    error: {
      name: 'SecondLevelDomainForbidden',
      message: 'Please use virtual hosted style to access.',
      $metadata: {httpStatusCode: 403},
    },
    key: 'CLOUD_SYNC_NETWORK',
    message:
      '阿里云 OSS 请关闭 Path style；Endpoint 建议使用 https://oss-cn-xxx.aliyuncs.com',
    messageNotContains: '凭据',
  },
];

describe.each(cases)(
  'mapCloudSyncSdkError',
  ({name, error, key, message, messageNotContains}) => {
    it(name, () => {
      const result = mapCloudSyncSdkError(error);

      expect(result).toBeInstanceOf(AppError);
      expect(result.key).toBe(key);
      expect(result.message).toBe(message);
      if (messageNotContains) {
        expect(result.message).not.toContain(messageNotContains);
      }
    });
  },
);
