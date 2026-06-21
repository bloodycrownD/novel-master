/**
 * Root navigation: bottom tabs (Chat, Profile) + native stack.
 */
import React from 'react';
import {NavigationContainer} from '@react-navigation/native';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {Platform, StyleSheet} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ChatTabIcon, ProfileTabIcon} from '../components/icons/TabIcons';
import {HeaderProvider} from './HeaderContext';
import {StackScreenLayout} from './StackScreenLayout';
import type {MainTabParamList, RootStackParamList} from './types';
import {useTheme} from '../theme/ThemeProvider';
import {ChatTabScreen} from '../screens/tabs/ChatTabScreen';
import {ProfileTabScreen} from '../screens/tabs/ProfileTabScreen';
import {AgentsSettingsScreen} from '../screens/stack/AgentsSettingsScreen';
import {AgentEditorScreen} from '../screens/stack/AgentEditorScreen';
import {RealPromptScreen} from '../screens/stack/RealPromptScreen';
import {ProvidersScreen} from '../screens/stack/ProvidersScreen';
import {ProviderCreateScreen} from '../screens/stack/ProviderCreateScreen';
import {ProviderEditScreen} from '../screens/stack/ProviderEditScreen';
import {ProviderDetailScreen} from '../screens/stack/ProviderDetailScreen';
import {ModelSamplingScreen} from '../screens/stack/ModelSamplingScreen';
import {CompactionConditionsScreen} from '../screens/stack/CompactionConditionsScreen';
import {EventsConfigScreen} from '../screens/stack/EventsConfigScreen';
import {CloudSyncConfigScreen} from '../screens/stack/CloudSyncConfigScreen';
import {StorageConfigScreen} from '../screens/stack/StorageConfigScreen';
import {CloudSyncProgressScreen} from '../screens/stack/CloudSyncProgressScreen';
import {ChatConfigScreen} from '../screens/stack/ChatConfigScreen';
import {GlobalTemplateScreen} from '../screens/stack/GlobalTemplateScreen';
import {RegexGroupsScreen} from '../screens/stack/RegexGroupsScreen';
import {RegexRulesScreen} from '../screens/stack/RegexRulesScreen';
import {RegexRuleEditorScreen} from '../screens/stack/RegexRuleEditorScreen';
import {AboutScreen} from '../screens/stack/AboutScreen';
import {FileEditorScreen} from '../screens/stack/FileEditorScreen';
import {useAutoUpdateCheck} from '../hooks/useAutoUpdateCheck';

const Tab = createBottomTabNavigator<MainTabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

function tabIcon(
  Icon: React.ComponentType<{color: string; size?: number}>,
) {
  return ({
    color,
    size,
  }: {
    color: string;
    size: number;
  }) => <Icon color={color} size={size} />;
}

function MainTabs() {
  const {tokens} = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Tab.Navigator
      initialRouteName="Chat"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: tokens.tabBarActive,
        tabBarInactiveTintColor: tokens.tabBarInactive,
        tabBarLabelStyle: styles.tabLabel,
        tabBarStyle: {
          backgroundColor: tokens.tabBarBackground,
          borderTopColor: tokens.borderLight,
          borderTopWidth: StyleSheet.hairlineWidth,
          paddingTop: 8,
          paddingBottom: Math.max(8, insets.bottom),
          height: 56 + insets.bottom,
          ...Platform.select({
            android: {elevation: 8},
            ios: {
              shadowColor: '#000',
              shadowOffset: {width: 0, height: -2},
              shadowOpacity: 0.06,
              shadowRadius: 8,
            },
          }),
        },
      }}>
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
const AgentEditorStackScreen = withStackLayout('AgentEditor', AgentEditorScreen);
const RealPromptStackScreen = withStackLayout('RealPrompt', RealPromptScreen);
const ProvidersStackScreen = withStackLayout('Providers', ProvidersScreen);
const ProviderCreateStackScreen = withStackLayout(
  'ProviderCreate',
  ProviderCreateScreen,
);
const ProviderEditStackScreen = withStackLayout('ProviderEdit', ProviderEditScreen);
const ProviderDetailStackScreen = withStackLayout(
  'ProviderDetail',
  ProviderDetailScreen,
);
const ModelSamplingStackScreen = withStackLayout(
  'ModelSampling',
  ModelSamplingScreen,
);
const CompactionConditionsStackScreen = withStackLayout(
  'CompactionConditions',
  CompactionConditionsScreen,
);
const EventsConfigStackScreen = withStackLayout('EventsConfig', EventsConfigScreen);
const StorageConfigStackScreen = withStackLayout('StorageConfig', StorageConfigScreen);
const CloudSyncProgressStackScreen = withStackLayout(
  'CloudSyncProgress',
  CloudSyncProgressScreen,
);
const ChatConfigStackScreen = withStackLayout('ChatConfig', ChatConfigScreen);
const CloudSyncConfigStackScreen = withStackLayout(
  'CloudSyncConfig',
  CloudSyncConfigScreen,
);
const GlobalTemplateStackScreen = withStackLayout(
  'GlobalTemplate',
  GlobalTemplateScreen,
);
const RegexGroupsStackScreen = withStackLayout('RegexGroups', RegexGroupsScreen);
const RegexRulesStackScreen = withStackLayout('RegexRules', RegexRulesScreen);
const RegexRuleEditorStackScreen = withStackLayout(
  'RegexRuleEditor',
  RegexRuleEditorScreen,
);
const FileEditorStackScreen = withStackLayout('FileEditor', FileEditorScreen);
const AboutStackScreen = withStackLayout('About', AboutScreen);

export function RootNavigator() {
  const {tokens} = useTheme();
  const autoUpdateUi = useAutoUpdateCheck();

  return (
    <>
      {autoUpdateUi}
      <NavigationContainer>
      <HeaderProvider>
        <Stack.Navigator
          screenOptions={{
            headerShown: false,
            contentStyle: {backgroundColor: tokens.background},
          }}>
          <Stack.Screen name="MainTabs" component={MainTabs} />
          <Stack.Screen name="AgentsSettings" component={AgentsSettingsStackScreen} />
          <Stack.Screen name="AgentEditor" component={AgentEditorStackScreen} />
          <Stack.Screen name="RealPrompt" component={RealPromptStackScreen} />
          <Stack.Screen name="Providers" component={ProvidersStackScreen} />
          <Stack.Screen name="ProviderCreate" component={ProviderCreateStackScreen} />
          <Stack.Screen name="ProviderEdit" component={ProviderEditStackScreen} />
          <Stack.Screen name="ProviderDetail" component={ProviderDetailStackScreen} />
          <Stack.Screen name="ModelSampling" component={ModelSamplingStackScreen} />
          <Stack.Screen
            name="CompactionConditions"
            component={CompactionConditionsStackScreen}
          />
          <Stack.Screen name="EventsConfig" component={EventsConfigStackScreen} />
          <Stack.Screen name="StorageConfig" component={StorageConfigStackScreen} />
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
          <Stack.Screen name="GlobalTemplate" component={GlobalTemplateStackScreen} />
          <Stack.Screen name="RegexGroups" component={RegexGroupsStackScreen} />
          <Stack.Screen name="RegexRules" component={RegexRulesStackScreen} />
          <Stack.Screen
            name="RegexRuleEditor"
            component={RegexRuleEditorStackScreen}
          />
          <Stack.Screen name="FileEditor" component={FileEditorStackScreen} />
          <Stack.Screen name="About" component={AboutStackScreen} />
        </Stack.Navigator>
      </HeaderProvider>
    </NavigationContainer>
    </>
  );
}

const styles = StyleSheet.create({
  tabLabel: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
});
