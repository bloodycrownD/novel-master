/**
 * 冒烟空组件：验证 Preact TSX 可打进 WebView IIFE（phase-toolchain）。
 */
import { h, Fragment } from 'preact';

export function Smoke() {
  return <Fragment />;
}
