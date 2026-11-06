/**
 * @format
 */

import './src/polyfills';
import 'react-native-gesture-handler';
// Reanimated/Worklets 须在入口尽早加载，否则 unpacker 初始化会拿不到 __initData
import 'react-native-reanimated';
import {AppRegistry} from 'react-native';
import App from './src/App';
import {installJsCrashHandler, installMobileLogSink} from './src/services/log-sink.mobile';
import {name as appName} from './app.json';

// 崩溃钩子同步装（不依赖文件 sink 就绪）；文件 sink 异步装——mkdir/ls/stat 都是
// Promise，顶层 try/catch 抓不到 rejection，必须自带 .catch()。
installJsCrashHandler();
installMobileLogSink().catch(err => {
  console.warn('[nm-log] sink install failed', err);
});

AppRegistry.registerComponent(appName, () => App);
