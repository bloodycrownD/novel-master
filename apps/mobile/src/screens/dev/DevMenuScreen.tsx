/**
 * Developer menu: links to VFS and SKSP dev screens.
 */
import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {RootStackParamList} from '../../navigation/types';
import {AppHeader} from '../../components/chrome/AppHeader';
import {useTheme} from '../../theme/ThemeProvider';

type Props = NativeStackScreenProps<RootStackParamList, 'DevMenu'>;

export function DevMenuScreen({navigation}: Props) {
  const {tokens} = useTheme();

  return (
    <View style={[styles.root, {backgroundColor: tokens.background}]}>
      <AppHeader pageKey="DevMenu" onBack={() => navigation.goBack()} />
      <Pressable
        style={styles.row}
        onPress={() => navigation.navigate('VfsDev')}>
        <Text style={{color: tokens.text}}>VFS 开发页</Text>
      </Pressable>
      <Pressable
        style={styles.row}
        onPress={() => navigation.navigate('SkspDev')}>
        <Text style={{color: tokens.text}}>SKSP 开发页</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  row: {padding: 16},
});
