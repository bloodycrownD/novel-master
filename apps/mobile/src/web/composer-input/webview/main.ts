/**
 * composer-input WebView 打包入口（esbuild → IIFE app.js）——薄入口。
 *
 * 装配（挂载编辑器 / 绑 host 消息通道 / 发 ready）全部收在 `./runtime/factory`：
 * 本文件既被当作旧包构建入口，又被新合成包 import，ESM import 即执行，所以顶层只能留
 * 「import 工厂 + 一行默认参数调用」——默认参数即旧包现行为（宏链活依赖本包）。
 */
import {createComposerRuntime} from './runtime/factory';

createComposerRuntime('#root');
