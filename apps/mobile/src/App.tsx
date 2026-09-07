/**
 * Root shell: runtime bootstrap, theme, and navigation (Chat tab launch).
 */
import React from 'react';
import {StatusBar} from 'react-native';
import {KeyboardProvider} from 'react-native-keyboard-controller';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {NovelMasterProvider} from './runtime/novel-master-context';
import {ThemeProvider, useTheme} from './theme/ThemeProvider';
import {ToastHost} from './components/chrome/ToastHost';
import {UpdateCheckHost} from './components/update/UpdateCheckHost';
import {RootNavigator} from './navigation/RootNavigator';
import {RESCUE_EXPORT_MODE} from './rescue/rescue-mode';
import {RescueExportScreen} from './screens/rescue/RescueExportScreen';

function AppContent() {
  const {mode} = useTheme();

  return (
    <>
      <StatusBar
        barStyle={mode === 'dark' ? 'light-content' : 'dark-content'}
      />
      <ToastHost>
        <RootNavigator />
        <UpdateCheckHost />
      </ToastHost>
    </>
  );
}

function App() {
  return (
    <SafeAreaProvider>
      <KeyboardProvider preload={false}>
        <NovelMasterProvider>
          <ThemeProvider>
            {/* 救援模式：跳过全部常规 UI（含崩溃链所在的会话页与更新检查），
                仅提供数据库导出；见 rescue/rescue-mode.ts 的使用守则 */}
            {RESCUE_EXPORT_MODE ? (
              <RescueExportScreen />
            ) : (
              <AppContent />
            )}
          </ThemeProvider>
        </NovelMasterProvider>
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}

export default App;
