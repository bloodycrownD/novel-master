/**
 * Jest stub for react-native-webview (ESM in node_modules; not transformed by default).
 */
import React from 'react';
import {View, type ViewProps} from 'react-native';

export type WebViewMessageEvent = {
  nativeEvent: {data: string};
};

type WebViewProps = ViewProps & {
  onMessage?: (event: WebViewMessageEvent) => void;
  source?: {html?: string; uri?: string; baseUrl?: string};
};

/** Captured postMessage payloads for tests (cleared via clearMockWebViewPostMessages). */
export const mockWebViewPostMessages: string[] = [];

export function clearMockWebViewPostMessages(): void {
  mockWebViewPostMessages.length = 0;
}

const WebView = React.forwardRef<{postMessage: (data: string) => void}, WebViewProps>(
  function WebViewMock(props, ref) {
    const postMessage = React.useCallback((data: string) => {
      mockWebViewPostMessages.push(data);
    }, []);
    React.useImperativeHandle(ref, () => ({postMessage}), [postMessage]);
    return <View ref={ref as React.Ref<View>} {...props} />;
  },
);

export default WebView;
