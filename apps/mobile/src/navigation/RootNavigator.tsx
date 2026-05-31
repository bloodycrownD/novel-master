/**
 * Root navigation: bottom tabs (Chat, Agents, Profile) + native stack.
 */
import React from 'react';
import {NavigationContainer} from '@react-navigation/native';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {Platform, StyleSheet} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {
  AgentTabIcon,
  ChatTabIcon,
  ProfileTabIcon,
} from '../components/icons/TabIcons';
import {HeaderProvider} from './HeaderContext';
import {StackScreenLayout} from './StackScreenLayout';
import type {MainTabParamList, RootStackParamList} from './types';
import {useTheme} from '../theme/ThemeProvider';
import {ChatTabScreen} from '../screens/tabs/ChatTabScreen';
import {AgentsTabScreen} from '../screens/tabs/AgentsTabScreen';
import {ProfileTabScreen} from '../screens/tabs/ProfileTabScreen';
import {AgentEditorScreen} from '../screens/stack/AgentEditorScreen';
import {RealPromptScreen} from '../screens/stack/RealPromptScreen';
import {SessionLogScreen} from '../screens/stack/SessionLogScreen';
import {ProvidersScreen} from '../screens/stack/ProvidersScreen';
import {ProviderCreateScreen} from '../screens/stack/ProviderCreateScreen';
import {ProviderEditScreen} from '../screens/stack/ProviderEditScreen';
import {ProviderDetailScreen} from '../screens/stack/ProviderDetailScreen';
import {ModelSamplingScreen} from '../screens/stack/ModelSamplingScreen';
import {CompactionPolicyScreen} from '../screens/stack/CompactionPolicyScreen';
import {GlobalTemplateScreen} from '../screens/stack/GlobalTemplateScreen';
import {RegexGroupsScreen} from '../screens/stack/RegexGroupsScreen';
import {RegexRulesScreen} from '../screens/stack/RegexRulesScreen';
import {RegexRuleEditorScreen} from '../screens/stack/RegexRuleEditorScreen';
import {SettingsScreen} from '../screens/stack/SettingsScreen';
import {FileEditorScreen} from '../screens/stack/FileEditorScreen';
import {DevMenuScreen} from '../screens/dev/DevMenuScreen';
import {VfsDevNavScreen} from '../screens/dev/VfsDevNavScreen';
import {SkspDevNavScreen} from '../screens/dev/SkspDevNavScreen';

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
        name="Agents"
        component={AgentsTabScreen}
        options={{
          tabBarLabel: 'Agent',
          tabBarIcon: tabIcon(AgentTabIcon),
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

export function RootNavigator() {
  const {tokens} = useTheme();

  return (
    <NavigationContainer>
      <HeaderProvider>
        <Stack.Navigator
          screenOptions={{
            headerShown: false,
            contentStyle: {backgroundColor: tokens.background},
          }}>
          <Stack.Screen name="MainTabs" component={MainTabs} />
          <Stack.Screen
            name="AgentEditor"
            component={withStackLayout('AgentEditor', AgentEditorScreen)}
          />
          <Stack.Screen
            name="RealPrompt"
            component={withStackLayout('RealPrompt', RealPromptScreen)}
          />
          <Stack.Screen
            name="SessionLog"
            component={withStackLayout('SessionLog', SessionLogScreen)}
          />
          <Stack.Screen
            name="Providers"
            component={withStackLayout('Providers', ProvidersScreen)}
          />
          <Stack.Screen
            name="ProviderCreate"
            component={withStackLayout('ProviderCreate', ProviderCreateScreen)}
          />
          <Stack.Screen
            name="ProviderEdit"
            component={withStackLayout('ProviderEdit', ProviderEditScreen)}
          />
          <Stack.Screen
            name="ProviderDetail"
            component={withStackLayout('ProviderDetail', ProviderDetailScreen)}
          />
          <Stack.Screen
            name="ModelSampling"
            component={withStackLayout('ModelSampling', ModelSamplingScreen)}
          />
          <Stack.Screen
            name="CompactionPolicy"
            component={withStackLayout('CompactionPolicy', CompactionPolicyScreen)}
          />
          <Stack.Screen
            name="GlobalTemplate"
            component={withStackLayout('GlobalTemplate', GlobalTemplateScreen)}
          />
          <Stack.Screen
            name="RegexGroups"
            component={withStackLayout('RegexGroups', RegexGroupsScreen)}
          />
          <Stack.Screen
            name="RegexRules"
            component={withStackLayout('RegexRules', RegexRulesScreen)}
          />
          <Stack.Screen
            name="RegexRuleEditor"
            component={withStackLayout('RegexRuleEditor', RegexRuleEditorScreen)}
          />
          <Stack.Screen
            name="Settings"
            component={withStackLayout('Settings', SettingsScreen)}
          />
          <Stack.Screen
            name="FileEditor"
            component={withStackLayout('FileEditor', FileEditorScreen)}
          />
          <Stack.Screen name="DevMenu" component={DevMenuScreen} />
          <Stack.Screen name="VfsDev" component={VfsDevNavScreen} />
          <Stack.Screen name="SkspDev" component={SkspDevNavScreen} />
        </Stack.Navigator>
      </HeaderProvider>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  tabLabel: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
});
