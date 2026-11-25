/**
 * Form switch row inside a form card.
 *
 * `descriptionLines`：描述限定的行数（超出尾部省略）；设置后点描述文字可展开 / 收起全文，
 * 开关区域不参与点击。
 */
import React, {useState} from 'react';
import {LayoutAnimation, Pressable, StyleSheet, Switch, Text, View} from 'react-native';
import type {ThemeTokens} from '@/theme/tokens';

type Props = {
    label: string;
    tokens: ThemeTokens;
    value: boolean;
    onValueChange: (value: boolean) => void;
    description?: string;
    /** 描述最多显示的行数；不设则全文展示且不可点击展开。 */
    descriptionLines?: number;
    disabled?: boolean;
    testID?: string;
};

export function FormSwitchRow({
    label,
    tokens,
    value,
    onValueChange,
    description,
    descriptionLines,
    disabled = false,
    testID,
}: Props) {
    const [expanded, setExpanded] = useState(false);
    const hasDescription = description != null && description !== '';
    const collapsible = descriptionLines != null && hasDescription;
    const descriptionText = (
        <Text style={[styles.description, {color: tokens.textSecondary}]} numberOfLines={collapsible && !expanded ? descriptionLines : undefined}>
            {description}
        </Text>
    );
    return (
        <View style={[styles.row, hasDescription && styles.rowWithDescription]}>
            <View style={styles.textCol}>
                <Text style={[styles.label, {color: tokens.text}]}>{label}</Text>
                {collapsible ? (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityState={{expanded}}
                        hitSlop={{top: 4, bottom: 4, left: 0, right: 0}}
                        onPress={() => {
                            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                            setExpanded(current => !current);
                        }}>
                        {descriptionText}
                    </Pressable>
                ) : hasDescription ? (
                    descriptionText
                ) : null}
            </View>
            <View style={styles.switchWrap}>
                <Switch
                    testID={testID}
                    value={value}
                    onValueChange={onValueChange}
                    disabled={disabled}
                    trackColor={{false: tokens.border, true: tokens.primary}}
                />
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        paddingVertical: 4,
    },
    rowWithDescription: {
        alignItems: 'flex-start',
    },
    textCol: {flex: 1, gap: 4},
    label: {fontSize: 16, fontWeight: '500'},
    description: {fontSize: 13, lineHeight: 18},
    switchWrap: {
        flexShrink: 0,
        paddingTop: 2,
    },
});
