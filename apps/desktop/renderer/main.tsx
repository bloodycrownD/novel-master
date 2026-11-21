import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/shell.css";

const root = document.getElementById("root");
if (!root) {
  // nm-throw: keep — UI 错误边界语义：渲染入口护栏，#root 缺失时 React 尚未接管，throw 是唯一中断通道（renderer 不依赖 core，无 assert 可用）。
  throw new Error("Missing #root element");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
