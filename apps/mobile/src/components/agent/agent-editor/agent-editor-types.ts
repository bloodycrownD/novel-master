/**
 * AgentEditorForm 拆分件的公共类型（comp-rest/C-3）。
 */
import {useTheme} from '../../../theme/ThemeProvider';

/** 主题 tokens（各 section 子组件经 props 接收，父组件只调一次 useTheme）。 */
export type AgentEditorTokens = ReturnType<typeof useTheme>['tokens'];
