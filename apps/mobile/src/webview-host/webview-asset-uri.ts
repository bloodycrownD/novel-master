/**
 * WebView 本地资产 URI（Android android_asset / iOS MainBundle WebViewDist）。
 * 同步返回；不做磁盘 exists 探测。禁止引入 react-native-fs。
 *
 * ⚠️ 本联合类型是 `scripts/build-webview.mjs` 里 PACKAGES 的**类型镜像**：
 * 增删包必须两处同步（build-webview.mjs 是真源，本文件是消费侧）。
 * 漏改的代价是不对称的——类型侧多一个成员只会放行一个指向永不存在目录的
 * URI（运行时白屏），故 `__tests__/webview-asset-guard.test.ts` 有双向断言
 * 把「六处齐改」钉成断言（chat-webview-unify cr2-C-1）。
 */
import {Platform} from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';

export type WebViewAssetPackageId =
  | 'rich-document'
  | 'code-editor'
  | 'composer-input'
  | 'chat-conversation';

function blobFsDirs(): typeof ReactNativeBlobUtil.fs.dirs {
  const anyMod = ReactNativeBlobUtil as unknown as {
    fs?: typeof ReactNativeBlobUtil.fs;
    default?: {fs?: typeof ReactNativeBlobUtil.fs};
  };
  const fs = anyMod.fs ?? anyMod.default?.fs;
  if (fs?.dirs == null) {
    throw new Error('react-native-blob-util.fs.dirs 不可用');
  }
  return fs.dirs;
}

/** 解析 iOS 主 Bundle 绝对路径；空/异常时同步 throw。 */
function iosMainBundleDir(): string {
  const dir = blobFsDirs().MainBundleDir;
  if (typeof dir !== 'string' || dir.trim().length === 0) {
    throw new Error(
      '无法解析 iOS MainBundleDir，WebView 资产 URI 不可用（请确认 react-native-blob-util 已链接）',
    );
  }
  return dir.replace(/\/+$/, '');
}

function toFileUri(absolutePath: string): string {
  if (absolutePath.startsWith('file://')) {
    return absolutePath;
  }
  return `file://${absolutePath}`;
}

/**
 * 返回包内 `index.html` 的平台 URI（同步；不做文件存在性探测）。
 */
export function getWebViewPackageIndexUri(pkg: WebViewAssetPackageId): string {
  if (Platform.OS === 'android') {
    return `file:///android_asset/webview/${pkg}/index.html`;
  }
  if (Platform.OS === 'ios') {
    return toFileUri(`${iosMainBundleDir()}/WebViewDist/${pkg}/index.html`);
  }
  throw new Error(`WebView 资产 URI 不支持平台: ${Platform.OS}`);
}

/**
 * 包目录 `file://` URI，供 iOS `allowingReadAccessToURL`（相对 ./app.js / ./app.css）。
 */
export function getWebViewPackageDirUri(pkg: WebViewAssetPackageId): string {
  if (Platform.OS === 'android') {
    return `file:///android_asset/webview/${pkg}/`;
  }
  if (Platform.OS === 'ios') {
    return toFileUri(`${iosMainBundleDir()}/WebViewDist/${pkg}/`);
  }
  throw new Error(`WebView 资产目录 URI 不支持平台: ${Platform.OS}`);
}
