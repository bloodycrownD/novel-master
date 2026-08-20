/**
 * react-test-renderer 的最小类型声明（测试专用）。
 *
 * react-test-renderer 是根 node_modules 的传递依赖（随 react-devtools-core 等
 * 引入），未随包声明类型。desktop 测试只用到 create / root / findByProps /
 * findAll / unmount 这几个 API，这里给最小结构声明，避免编辑器与未来测试目录
 * 纳入 typecheck 时报缺模块。
 */
declare module "react-test-renderer" {
  export type TestInstance = {
    props: Record<string, unknown>;
    findAll(predicate: (node: TestInstance) => boolean): TestInstance[];
  };
  export type ReactTestRendererRoot = TestInstance & {
    findByProps(props: Record<string, unknown>): TestInstance;
  };
  export type ReactTestRenderer = {
    root: ReactTestRendererRoot;
    unmount(): void;
  };
  const TestRenderer: {
    create(element: import("react").ReactElement): ReactTestRenderer;
  };
  export default TestRenderer;
}
