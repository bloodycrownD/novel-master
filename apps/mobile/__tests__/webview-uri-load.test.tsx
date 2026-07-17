/**
 * T-BB-04：URI helper + WebView 必配 props 矩阵（静态断言）。
 */
import React from 'react';
import { Platform } from 'react-native';
import {
  describe,
  expect,
  it,
  jest,
  beforeEach,
  afterEach,
} from '@jest/globals';
import TestRenderer, { act } from 'react-test-renderer';
import { ChatTranscriptWebView } from '../src/components/chat/ChatTranscriptWebView';
import { RichDocumentWebView } from '../src/components/vfs/RichDocumentWebView';
import {
  getChatTranscriptPackageDirUri,
  getChatTranscriptUri,
} from '../src/web/chat-transcript/uri';
import {
  getRichDocumentPackageDirUri,
  getRichDocumentUri,
} from '../src/web/rich-document/uri';

jest.mock('../src/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {
      background: '#000',
      surface: '#111',
      borderLight: '#222',
      textSecondary: '#ccc',
      primary: '#08f',
      text: '#fff',
    },
  }),
}));

jest.mock('react-native-blob-util', () => ({
  __esModule: true,
  default: {
    fs: {
      dirs: { MainBundleDir: '/App/NovelMaster.app' },
    },
  },
}));

describe('WebView URI load (T-BB-04)', () => {
  const originalOs = Platform.OS;

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      get: () => originalOs,
    });
  });

  describe('URI helper', () => {
    it('Android 恒返回 android_asset 定案串', () => {
      Object.defineProperty(Platform, 'OS', {
        configurable: true,
        get: () => 'android',
      });
      expect(getChatTranscriptUri()).toBe(
        'file:///android_asset/webview/chat-transcript/index.html',
      );
      expect(getRichDocumentUri()).toBe(
        'file:///android_asset/webview/rich-document/index.html',
      );
      expect(getChatTranscriptPackageDirUri()).toBe(
        'file:///android_asset/webview/chat-transcript/',
      );
      expect(getRichDocumentPackageDirUri()).toBe(
        'file:///android_asset/webview/rich-document/',
      );
    });

    it('iOS 用 MainBundleDir 拼 WebViewDist file:// URI', () => {
      Object.defineProperty(Platform, 'OS', {
        configurable: true,
        get: () => 'ios',
      });
      expect(getChatTranscriptUri()).toBe(
        'file:///App/NovelMaster.app/WebViewDist/chat-transcript/index.html',
      );
      expect(getRichDocumentUri()).toBe(
        'file:///App/NovelMaster.app/WebViewDist/rich-document/index.html',
      );
      expect(getChatTranscriptPackageDirUri()).toBe(
        'file:///App/NovelMaster.app/WebViewDist/chat-transcript/',
      );
    });
  });

  describe('WebView props 矩阵', () => {
    beforeEach(() => {
      Object.defineProperty(Platform, 'OS', {
        configurable: true,
        get: () => 'android',
      });
    });

    it('ChatTranscriptWebView：source.uri + 双端必配 props', () => {
      let root: TestRenderer.ReactTestRenderer;
      act(() => {
        root = TestRenderer.create(
          <ChatTranscriptWebView sessionKey="s1" messages={[]} />,
        );
      });
      const webView = root!.root.findByType(
        require('react-native-webview').default as React.ComponentType,
      );
      expect(webView.props.source).toEqual({
        uri: 'file:///android_asset/webview/chat-transcript/index.html',
      });
      expect(webView.props.allowFileAccess).toBe(true);
      expect(webView.props.allowFileAccessFromFileURLs).toBe(true);
      expect(webView.props.allowingReadAccessToURL).toBe(
        'file:///android_asset/webview/chat-transcript/',
      );
      expect(webView.props.javaScriptEnabled).toBe(true);
    });

    it('RichDocumentWebView：source.uri + 双端必配 props', () => {
      let root: TestRenderer.ReactTestRenderer;
      act(() => {
        root = TestRenderer.create(<RichDocumentWebView html="<p>x</p>" />);
      });
      const webView = root!.root.findByType(
        require('react-native-webview').default as React.ComponentType,
      );
      expect(webView.props.source).toEqual({
        uri: 'file:///android_asset/webview/rich-document/index.html',
      });
      expect(webView.props.allowFileAccess).toBe(true);
      expect(webView.props.allowFileAccessFromFileURLs).toBe(true);
      expect(webView.props.allowingReadAccessToURL).toBe(
        'file:///android_asset/webview/rich-document/',
      );
      expect(webView.props.javaScriptEnabled).toBe(true);
    });
  });
});
