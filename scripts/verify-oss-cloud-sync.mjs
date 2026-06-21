#!/usr/bin/env node
/**
 * 阿里云 OSS（S3 兼容）云同步链路探针。
 *
 * 模拟 Mobile `testCloudSyncConnection` + 读写探测，在 Node 环境验证配置是否可用。
 * 密钥仅经环境变量传入，勿写入仓库。
 *
 * 用法（PowerShell）：
 *   $env:OSS_ACCESS_KEY_ID="你的AK"
 *   $env:OSS_SECRET_ACCESS_KEY="你的SK"
 *   node scripts/verify-oss-cloud-sync.mjs
 *
 * 可选环境变量见 CONFIG 默认值。
 */
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

/** @type {Record<string, string>} */
const CONFIG = {
  OSS_ENDPOINT: process.env.OSS_ENDPOINT ?? 'https://oss-cn-beijing.aliyuncs.com',
  OSS_REGION: process.env.OSS_REGION ?? 'oss-cn-beijing',
  OSS_BUCKET: process.env.OSS_BUCKET ?? 'novel-master-files',
  OSS_PATH_PREFIX: process.env.OSS_PATH_PREFIX ?? 'sync/',
  OSS_ACCESS_KEY_ID: process.env.OSS_ACCESS_KEY_ID ?? '',
  OSS_SECRET_ACCESS_KEY: process.env.OSS_SECRET_ACCESS_KEY ?? '',
  OSS_FORCE_PATH_STYLE: process.env.OSS_FORCE_PATH_STYLE ?? '',
};

function defaultForcePathStyle(endpoint) {
  // 阿里云 OSS 要求 virtual-hosted（Path style 关）；MinIO 等通常需 Path style 开
  const host = normalizeEndpoint(endpoint).replace(/^https?:\/\//, '');
  if (host.includes('aliyuncs.com')) {
    return false;
  }
  return true;
}

function resolveForcePathStyle(endpoint) {
  if (CONFIG.OSS_FORCE_PATH_STYLE === 'true') {
    return true;
  }
  if (CONFIG.OSS_FORCE_PATH_STYLE === 'false') {
    return false;
  }
  return defaultForcePathStyle(endpoint);
}

function normalizeEndpoint(raw) {
  const trimmed = raw.trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

function normalizePrefix(prefix) {
  const trimmed = prefix.trim();
  if (trimmed.length === 0) {
    return '';
  }
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

function statusKey(prefix) {
  return `${normalizePrefix(prefix)}status.json`;
}

function maskSecret(value) {
  if (!value) {
    return '(未设置)';
  }
  if (value.length <= 4) {
    return '****';
  }
  return `${value.slice(0, 2)}****${value.slice(-2)}`;
}

function formatError(error) {
  if (error == null) {
    return '未知错误';
  }
  const name =
    typeof error === 'object' && 'name' in error
      ? String(error.name)
      : 'Error';
  const message =
    error instanceof Error ? error.message : String(error);
  const status =
    typeof error === 'object' &&
    error != null &&
    '$metadata' in error &&
    typeof error.$metadata === 'object' &&
    error.$metadata != null &&
    'httpStatusCode' in error.$metadata
      ? error.$metadata.httpStatusCode
      : undefined;
  return status != null ? `${name} (HTTP ${status}): ${message}` : `${name}: ${message}`;
}

async function runStep(label, fn) {
  process.stdout.write(`  • ${label} … `);
  try {
    const result = await fn();
    console.log('OK');
    return {ok: true, result};
  } catch (error) {
    console.log('失败');
    console.log(`    ${formatError(error)}`);
    return {ok: false, error};
  }
}

function buildClient(forcePathStyle) {
  return new S3Client({
    region: CONFIG.OSS_REGION || 'us-east-1',
    endpoint: normalizeEndpoint(CONFIG.OSS_ENDPOINT),
    credentials: {
      accessKeyId: CONFIG.OSS_ACCESS_KEY_ID,
      secretAccessKey: CONFIG.OSS_SECRET_ACCESS_KEY,
    },
    forcePathStyle,
  });
}

function isPathStyleForbidden(error) {
  const message =
    error instanceof Error ? error.message : String(error ?? '');
  const name =
    typeof error === 'object' && error != null && 'name' in error
      ? String(error.name)
      : '';
  return (
    name === 'SecondLevelDomainForbidden' ||
    message.toLowerCase().includes('virtual hosted style')
  );
}

async function readBody(command, client) {
  const response = await client.send(command);
  const bytes = await response.Body?.transformToByteArray();
  if (bytes == null) {
    return null;
  }
  return new TextDecoder().decode(bytes);
}

async function main() {
  const pathPrefix = normalizePrefix(CONFIG.OSS_PATH_PREFIX);
  const probeKey = `${pathPrefix}_probe/novel-master-link-check-${Date.now()}.txt`;
  const probeBody = `novel-master oss probe @ ${new Date().toISOString()}`;
  let forcePathStyle = resolveForcePathStyle(CONFIG.OSS_ENDPOINT);

  console.log('=== OSS 云同步链路探针 ===\n');
  console.log('配置（密钥已打码）：');
  console.log(`  Endpoint:        ${normalizeEndpoint(CONFIG.OSS_ENDPOINT)}`);
  console.log(`  Region:          ${CONFIG.OSS_REGION}`);
  console.log(`  Bucket:          ${CONFIG.OSS_BUCKET}`);
  console.log(`  Path prefix:     ${pathPrefix || '(根)'}`);
  console.log(
    `  Path style:      ${forcePathStyle}（阿里云 OSS 须为 false / 关闭）`,
  );
  console.log(`  Access Key ID:   ${CONFIG.OSS_ACCESS_KEY_ID || '(未设置)'}`);
  console.log(`  Secret Key:      ${maskSecret(CONFIG.OSS_SECRET_ACCESS_KEY)}`);
  console.log('');

  if (!CONFIG.OSS_ACCESS_KEY_ID || !CONFIG.OSS_SECRET_ACCESS_KEY) {
    console.error(
      '缺少 OSS_ACCESS_KEY_ID 或 OSS_SECRET_ACCESS_KEY 环境变量，已中止。',
    );
    process.exit(1);
  }

  let client = buildClient(forcePathStyle);
  const results = [];

  console.log('1) 连接探测（同 Mobile 测试连接）');

  const headStep = await runStep('HeadBucket', async () => {
    await client.send(new HeadBucketCommand({Bucket: CONFIG.OSS_BUCKET}));
    return true;
  });
  results.push(headStep);

  if (!headStep.ok && isPathStyleForbidden(headStep.error)) {
    const flipped = !forcePathStyle;
    console.log(
      `  ↳ 检测到 SecondLevelDomainForbidden，自动切换 Path style: ${forcePathStyle} → ${flipped}`,
    );
    forcePathStyle = flipped;
    client = buildClient(forcePathStyle);
    results.push(
      await runStep(`HeadBucket（Path style=${forcePathStyle} 重试）`, async () => {
        await client.send(new HeadBucketCommand({Bucket: CONFIG.OSS_BUCKET}));
        return true;
      }),
    );
  }

  if (!results.at(-1)?.ok) {
    results.push(
      await runStep('ListObjectsV2（HeadBucket 失败时的回退）', async () => {
        const response = await client.send(
          new ListObjectsV2Command({
            Bucket: CONFIG.OSS_BUCKET,
            Prefix: pathPrefix,
            MaxKeys: 5,
          }),
        );
        return {
          keyCount: response.KeyCount ?? 0,
          sampleKeys: (response.Contents ?? [])
            .map((item) => item.Key)
            .filter(Boolean)
            .slice(0, 5),
        };
      }),
    );
  }

  console.log('\n2) 云同步对象探测');

  results.push(
    await runStep(`HeadObject status.json (${statusKey(CONFIG.OSS_PATH_PREFIX)})`, async () => {
      const key = statusKey(CONFIG.OSS_PATH_PREFIX);
      try {
        const head = await client.send(
          new HeadObjectCommand({Bucket: CONFIG.OSS_BUCKET, Key: key}),
        );
        return {exists: true, bytes: head.ContentLength, etag: head.ETag};
      } catch (error) {
        const status =
          typeof error === 'object' &&
          error != null &&
          '$metadata' in error &&
          error.$metadata?.httpStatusCode;
        if (status === 404 || error?.name === 'NotFound') {
          return {exists: false};
        }
        throw error;
      }
    }),
  );

  const statusResult = results.at(-1)?.result;
  if (statusResult?.exists) {
    results.push(
      await runStep('GetObject status.json（读）', async () => {
        const text = await readBody(
          new GetObjectCommand({
            Bucket: CONFIG.OSS_BUCKET,
            Key: statusKey(CONFIG.OSS_PATH_PREFIX),
          }),
          client,
        );
        return text?.slice(0, 200) ?? '';
      }),
    );
  } else {
    console.log('  · status.json 不存在（尚未 Push 过，属正常）');
  }

  console.log('\n3) 读写探针（临时对象，结束后删除）');
  console.log(`  对象键: ${probeKey}`);

  results.push(
    await runStep('PutObject（写）', async () => {
      await client.send(
        new PutObjectCommand({
          Bucket: CONFIG.OSS_BUCKET,
          Key: probeKey,
          Body: probeBody,
          ContentType: 'text/plain; charset=utf-8',
        }),
      );
      return true;
    }),
  );

  results.push(
    await runStep('GetObject（读）', async () => {
      const text = await readBody(
        new GetObjectCommand({Bucket: CONFIG.OSS_BUCKET, Key: probeKey}),
        client,
      );
      if (text !== probeBody) {
        throw new Error(`内容不一致: 期望 ${probeBody.length} 字节`);
      }
      return text;
    }),
  );

  results.push(
    await runStep('DeleteObject（清理）', async () => {
      await client.send(
        new DeleteObjectCommand({Bucket: CONFIG.OSS_BUCKET, Key: probeKey}),
      );
      return true;
    }),
  );

  const failed = results.filter((item) => !item.ok);
  console.log('\n=== 汇总 ===');
  if (failed.length === 0) {
    console.log('全部步骤通过：OSS 读写链路可用，Mobile 云同步配置参数可行。');
    process.exit(0);
  }

  console.log(`失败 ${failed.length} 项。请检查 Endpoint / Region / Path style / 凭据与桶权限。`);
  process.exit(1);
}

main().catch((error) => {
  console.error('\n未捕获异常:', formatError(error));
  process.exit(1);
});
