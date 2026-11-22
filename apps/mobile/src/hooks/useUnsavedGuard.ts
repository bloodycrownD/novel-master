/**
 * Blocks navigation when the editor has unsaved changes.
 */
import {useCallback, useEffect, useRef} from 'react';
import {Alert} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {coreT} from '@/i18n/core';

/** Confirm before leaving a screen with dirty editor state. */
export function useUnsavedGuard(isDirty: boolean, message = coreT({key: "ui.common.unsaved_confirm_msg"})): {allowLeaveWithoutPrompt: () => void} {
    const navigation = useNavigation();
    const allowLeaveRef = useRef(false);

    useEffect(() => {
        const unsubscribe = navigation.addListener('beforeRemove', event => {
            if (allowLeaveRef.current) {
                allowLeaveRef.current = false;
                return;
            }
            if (!isDirty) {
                return;
            }
            event.preventDefault();
            Alert.alert(coreT({key: "ui.common.unsaved_title"}), message, [
                {text: coreT({key: "ui.common.stay"}), style: 'cancel'},
                {
                    text: coreT({key: "ui.common.leave"}),
                    style: 'destructive',
                    onPress: () => navigation.dispatch(event.data.action),
                },
            ]);
        });
        return unsubscribe;
    }, [navigation, isDirty, message]);

    const allowLeaveWithoutPrompt = useCallback(() => {
        allowLeaveRef.current = true;
    }, []);

    return {allowLeaveWithoutPrompt};
}
