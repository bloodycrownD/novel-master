/**
 * Create custom provider + SKSP api key (§14 M6).
 */
import React, {useState} from 'react';
import {StyleSheet, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {ProviderForm, ProviderFormMapper} from '@/components/provider/ProviderForm';
import {useToast} from '@/components/chrome/ToastHost';
import {ToastMessage} from '@/errors/toast-message';
import {coreT} from '@/i18n/core';
import {useRuntime} from '@/hooks/useRuntime';
import type {RootStackParamList} from '@/navigation/types';
import {useTheme} from '@/theme/ThemeProvider';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function ProviderCreateScreen() {
    const {tokens} = useTheme();
    const {showToast} = useToast();
    const runtime = useRuntime();
    const navigation = useNavigation<Nav>();
    const [saving, setSaving] = useState(false);

    return (
        <View style={[styles.root, {backgroundColor: tokens.background}]}>
            <ProviderForm
                mode="create"
                saving={saving}
                onSubmit={async values => {
                    setSaving(true);
                    try {
                        const input = ProviderFormMapper.toCreateInput(values);
                        const created = await runtime.providers.create(input);
                        if (!created.ok) {
                            showToast(ToastMessage.toast(coreT({key: "ui.common.create_failed"}), created.error));
                            return;
                        }
                        showToast(coreT({key: "ui.provider.create_done", params: {name: created.value.displayName}}));
                        navigation.replace('ProviderDetail', {providerId: created.value.id});
                    } catch (err) {
                        showToast(ToastMessage.toast(coreT({key: "ui.common.create_failed"}), err));
                    } finally {
                        setSaving(false);
                    }
                }}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    root: {flex: 1},
});
