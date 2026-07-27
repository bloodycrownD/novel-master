/**
 * @format
 */

import './src/polyfills';
import 'react-native-gesture-handler';
// Reanimated/Worklets 须在入口尽早加载，否则 unpacker 初始化会拿不到 __initData
import 'react-native-reanimated';
import {AppRegistry} from 'react-native';
import App from './src/App';
import {name as appName} from './app.json';

AppRegistry.registerComponent(appName, () => App);
