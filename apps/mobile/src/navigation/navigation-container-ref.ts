/**
 * 编程式导航 container ref——React 树外的模块（通知点按路径）导航用。
 *
 * RootNavigator 把它挂到 NavigationContainer；通知等非 React 上下文经
 * {@link navigationContainerRef} 在 isReady 后 navigate。
 *
 * @module navigation/navigation-container-ref
 */
import {createNavigationContainerRef} from '@react-navigation/native';

export const navigationContainerRef = createNavigationContainerRef();
