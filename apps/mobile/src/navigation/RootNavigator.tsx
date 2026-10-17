/**
 * Root navigation: bottom tabs (Chat, Profile) + native stack.
 */
import React, {useMemo} from 'react';
import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
} from '@react-navigation/native';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {StyleSheet, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {navigationContainerRef} from './navigation-container-ref';
import {ChatTabIcon, ProfileTabIcon} from '../components/icons/TabIcons';
import {HeaderProvider} from './HeaderContext';
import {buildMainTabBarStyle} from './main-tab-bar-style';
import {StackScreenLayout} from './StackScreenLayout';
import type {MainTabParamList, RootStackParamList} from './types';
import {useTheme} from '../theme/ThemeProvider';
import {ChatTabScreen} from '../screens/tabs/ChatTabScreen';
import {ProfileTabScreen} from '../screens/tabs/ProfileTabScreen';
import {AgentsSettingsScreen} from '../screens/stack/AgentsSettingsScreen';
import {AgentEditorScreen} from '../screens/stack/AgentEditorScreen';
import {RealPromptScreen} from '../screens/stack/RealPromptScreen';
import {PromptTurnDetailScreen} from '../screens/stack/PromptTurnDetailScreen';
import {ProvidersScreen} from '../screens/stack/ProvidersScreen';
import {ProviderCreateScreen} from '../screens/stack/ProviderCreateScreen';
import {ProviderDetailScreen} from '../screens/stack/ProviderDetailScreen';
import {ModelSamplingScreen} from '../screens/stack/ModelSamplingScreen';

import {CloudSyncConfigScreen} from '../screens/stack/CloudSyncConfigScreen';
import {CloudSyncStorageScreen} from '../screens/stack/CloudSyncStorageScreen';
import {SearchEnginesScreen} from '../screens/stack/SearchEnginesScreen';
import {SearchEngineDetailScreen} from '../screens/stack/SearchEngineDetailScreen';
import {StorageConfigScreen} from '../screens/stack/StorageConfigScreen';
import {CloudSyncProgressScreen} from '../screens/stack/CloudSyncProgressScreen';
import {ChatConfigScreen} from '../screens/stack/ChatConfigScreen';
import {GlobalTemplateScreen} from '../screens/stack/GlobalTemplateScreen';
import {SmartSortRulesScreen} from '../screens/stack/SmartSortRulesScreen';
import {SmartSortRuleEditorScreen} from '../screens/stack/SmartSortRuleEditorScreen';
import {FileEditorScreen} from '../screens/stack/FileEditorScreen';
import {SessionDetailScreen} from '../screens/stack/SessionDetailScreen';
import {SubagentSessionScreen} from '../screens/stack/SubagentSessionScreen';
import {SkillPanelScreen} from '../screens/stack/SkillPanelScreen';
import {SkillsSettingsScreen} from '../screens/stack/SkillsSettingsScreen';
import {SkillDetailScreen} from '../screens/stack/SkillDetailScreen';
import {PromptEditorScreen} from '../screens/stack/PromptEditorScreen';

import {TokenUsageStatsScreen} from '../screens/stack/TokenUsageStatsScreen';
import {AboutScreen} from '../screens/stack/AboutScreen';

const Tab = createBottomTabNavigator<MainTabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

function tabIcon(Icon: React.ComponentType<{color: string; size?: number}>) {
  return ({color, size}: {color: string; size: number}) => (
    <Icon color={color} size={size} />
  );
}

function MainTabs() {
  const {tokens} = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Tab.Navigator
      initialRouteName="Chat"
      /* 切 tab 白屏防线（2026-10-01）：默认在 Android 上 detach 非活跃页
         （react-native-screens 把非活跃 tab 的 view 从窗口移除），聊天页的
         WebView 画面层随之销毁，切回来那拍就是白屏一闪。关掉 detach 后非活跃
         页由容器本来的 absoluteFill + zIndex 压底 + pointerEvents 隔离（web
         端即此方案），WebView 常驻可见树，切 tab 零重建。 */
      detachInactiveScreens={false}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: tokens.tabBarActive,
        tabBarInactiveTintColor: tokens.tabBarInactive,
        tabBarLabelStyle: styles.tabLabel,
        tabBarStyle: buildMainTabBarStyle(tokens, insets),
      }}
    >
      <Tab.Screen
        name="Chat"
        component={ChatTabScreen}
        options={{
          tabBarLabel: '对话',
          tabBarIcon: tabIcon(ChatTabIcon),
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileTabScreen}
        options={{
          tabBarLabel: '我的',
          tabBarIcon: tabIcon(ProfileTabIcon),
        }}
      />
    </Tab.Navigator>
  );
}

function withStackLayout(
  pageKey: keyof RootStackParamList,
  Screen: React.ComponentType,
) {
  return function Wrapped() {
    return (
      <StackScreenLayout pageKey={pageKey}>
        <Screen />
      </StackScreenLayout>
    );
  };
}

/** 模块级稳定引用：避免 RootNavigator 重渲染时 inline withStackLayout 导致 Stack 屏幕反复卸载/挂载。 */
const AgentsSettingsStackScreen = withStackLayout(
  'AgentsSettings',
  AgentsSettingsScreen,
);
const AgentEditorStackScreen = withStackLayout(
  'AgentEditor',
  AgentEditorScreen,
);
const RealPromptStackScreen = withStackLayout('RealPrompt', RealPromptScreen);
const PromptTurnDetailStackScreen = withStackLayout(
  'PromptTurnDetail',
  PromptTurnDetailScreen,
);
const ProvidersStackScreen = withStackLayout('Providers', ProvidersScreen);
const ProviderCreateStackScreen = withStackLayout(
  'ProviderCreate',
  ProviderCreateScreen,
);
const ProviderDetailStackScreen = withStackLayout(
  'ProviderDetail',
  ProviderDetailScreen,
);
const ModelSamplingStackScreen = withStackLayout(
  'ModelSampling',
  ModelSamplingScreen,
);

const StorageConfigStackScreen = withStackLayout(
  'StorageConfig',
  StorageConfigScreen,
);
const CloudSyncProgressStackScreen = withStackLayout(
  'CloudSyncProgress',
  CloudSyncProgressScreen,
);
const ChatConfigStackScreen = withStackLayout('ChatConfig', ChatConfigScreen);
const CloudSyncConfigStackScreen = withStackLayout(
  'CloudSyncConfig',
  CloudSyncConfigScreen,
);
const CloudSyncStorageStackScreen = withStackLayout(
  'CloudSyncStorage',
  CloudSyncStorageScreen,
);
const SearchEnginesStackScreen = withStackLayout(
  'SearchEngines',
  SearchEnginesScreen,
);
const SearchEngineDetailStackScreen = withStackLayout(
  'SearchEngineDetail',
  SearchEngineDetailScreen,
);
const GlobalTemplateStackScreen = withStackLayout(
  'GlobalTemplate',
  GlobalTemplateScreen,
);
const SmartSortRulesStackScreen = withStackLayout(
  'SmartSortRules',
  SmartSortRulesScreen,
);
const SmartSortRuleEditorStackScreen = withStackLayout(
  'SmartSortRuleEditor',
  SmartSortRuleEditorScreen,
);
const FileEditorStackScreen = withStackLayout('FileEditor', FileEditorScreen);
const SessionDetailStackScreen = withStackLayout(
  'SessionDetail',
  SessionDetailScreen,
);
const SubagentSessionStackScreen = withStackLayout(
  'SubagentSessionView',
  SubagentSessionScreen,
);
const SkillPanelStackScreen = withStackLayout('SkillPanel', SkillPanelScreen);
const SkillsSettingsStackScreen = withStackLayout(
  'SkillsSettings',
  SkillsSettingsScreen,
);
const SkillDetailStackScreen = withStackLayout(
  'SkillDetail',
  SkillDetailScreen,
);
const PromptEditorStackScreen = withStackLayout(
  'PromptEditor',
  PromptEditorScreen,
);
const TokenUsageStatsStackScreen = withStackLayout(
  'TokenUsageStats',
  TokenUsageStatsScreen,
);
const AboutStackScreen = withStackLayout('About', AboutScreen);

export function RootNavigator() {
  const {tokens, mode} = useTheme();
  /**
   * 导航主题对齐（fix-E 次修）：NavigationContainer 的 theme 决定导航容器
   * colors.background（缺省 DefaultTheme 是浅色 #fff 系），转场剥开的底不得
   * 是浅色——按当前 mode 取 Dark/Default 基础主题、覆写 background 为
   * tokens.background（与 A 层底色同口径，RULE #17）。
   */
  const navigationTheme = useMemo(() => {
    const base = mode === 'dark' ? DarkTheme : DefaultTheme;
    return {...base, colors: {...base.colors, background: tokens.background}};
  }, [mode, tokens.background]);

  return (
    /* 转场白闪（fix-E 主修）：native-stack 转场对新屏做 alpha 过渡，混合底层
       是 ScreenStack 容器——它只有 flex:1（透明），往下透过 RN 根直到窗口
       DayNight 背景（系统浅色=白）；深色屏对白底 alpha 混合 = 均匀灰白帧
       （2026-10-18 三轮取证：进预览 3-4 帧全屏均匀抬亮）。react-native-screens
       4.25 在 Android 上把 ScreenStack 的 style.backgroundColor 等价于
       nativeContainerBackgroundColor（ScreenStackViewManager.kt:85-87），但
       @react-navigation 未透传该 style，故在 NavigationContainer 外衬一层
       主题色 View 作稳定混合底。只包 NavigationContainer（HeaderProvider 在其
       内、不动）；导航外的透明层不受影响。 */
    <View style={[styles.navHost, {backgroundColor: tokens.background}]}>
      {/* 通知点按等 React 外路径经 navigationContainerRef 编程式导航 */}
      <NavigationContainer ref={navigationContainerRef} theme={navigationTheme}>
        <HeaderProvider>
          <Stack.Navigator
            screenOptions={{
              headerShown: false,
              contentStyle: {backgroundColor: tokens.background},
            }}
          >
            <Stack.Screen name="MainTabs" component={MainTabs} />
            <Stack.Screen
              name="AgentsSettings"
              component={AgentsSettingsStackScreen}
            />
            <Stack.Screen
              name="AgentEditor"
              component={AgentEditorStackScreen}
            />
            <Stack.Screen
              name="RealPrompt"
              component={RealPromptStackScreen}
              options={{animation: 'none'}}
            />
            <Stack.Screen
              name="PromptTurnDetail"
              component={PromptTurnDetailStackScreen}
            />
            <Stack.Screen name="Providers" component={ProvidersStackScreen} />
            <Stack.Screen
              name="ProviderCreate"
              component={ProviderCreateStackScreen}
            />
            <Stack.Screen
              name="ProviderDetail"
              component={ProviderDetailStackScreen}
            />
            <Stack.Screen
              name="ModelSampling"
              component={ModelSamplingStackScreen}
            />

            <Stack.Screen
              name="StorageConfig"
              component={StorageConfigStackScreen}
            />
            <Stack.Screen
              name="CloudSyncProgress"
              component={CloudSyncProgressStackScreen}
              options={{gestureEnabled: false}}
            />
            <Stack.Screen name="ChatConfig" component={ChatConfigStackScreen} />
            <Stack.Screen
              name="CloudSyncConfig"
              component={CloudSyncConfigStackScreen}
            />
            <Stack.Screen
              name="CloudSyncStorage"
              component={CloudSyncStorageStackScreen}
            />
            <Stack.Screen
              name="SearchEngines"
              component={SearchEnginesStackScreen}
            />
            <Stack.Screen
              name="SearchEngineDetail"
              component={SearchEngineDetailStackScreen}
            />
            <Stack.Screen
              name="GlobalTemplate"
              component={GlobalTemplateStackScreen}
            />
            <Stack.Screen
              name="SmartSortRules"
              component={SmartSortRulesStackScreen}
            />
            <Stack.Screen
              name="SmartSortRuleEditor"
              component={SmartSortRuleEditorStackScreen}
            />
            <Stack.Screen name="FileEditor" component={FileEditorStackScreen} />
            <Stack.Screen
              name="SessionDetail"
              component={SessionDetailStackScreen}
            />
            <Stack.Screen
              name="SubagentSessionView"
              component={SubagentSessionStackScreen}
            />
            <Stack.Screen name="SkillPanel" component={SkillPanelStackScreen} />
            <Stack.Screen
              name="PromptEditor"
              component={PromptEditorStackScreen}
            />
            <Stack.Screen
              name="SkillsSettings"
              component={SkillsSettingsStackScreen}
            />
            <Stack.Screen
              name="SkillDetail"
              component={SkillDetailStackScreen}
            />
            <Stack.Screen
              name="TokenUsageStats"
              component={TokenUsageStatsStackScreen}
            />
            <Stack.Screen name="About" component={AboutStackScreen} />
          </Stack.Navigator>
        </HeaderProvider>
      </NavigationContainer>
    </View>
  );
}

const styles = StyleSheet.create({
  navHost: {flex: 1},
  tabLabel: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
});
