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

const WebView = React.forwardRef<View, WebViewProps>(function WebViewMock(
  props,
  ref,
) {
  return <View ref={ref} {...props} />;
});

export default WebView;
