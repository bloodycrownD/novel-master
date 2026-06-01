/**
 * Events configuration (read-only summary; full YAML edit via CLI).
 */
import React, {useCallback, useEffect, useState} from 'react';
import {ActivityIndicator, ScrollView, Text} from 'react-native';
import {DEFAULT_EVENTS_CONFIG} from '@novel-master/core';
import {useRuntime} from '../../hooks/useRuntime';
import {useTheme} from '../../theme/ThemeProvider';

export function EventsConfigScreen() {
  const {tokens} = useTheme();
  const runtime = useRuntime();
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const config = await runtime.eventsConfig.getConfig();
      const isDefault =
        JSON.stringify(config.events) ===
        JSON.stringify(DEFAULT_EVENTS_CONFIG.events);
      setSummary(
        isDefault
          ? '当前为出厂默认：压缩时并行 hide-message（start-depth 6）与 refresh-macros。'
          : '已自定义事件配置（完整编辑请使用 nm events）。',
      );
    } finally {
      setLoading(false);
    }
  }, [runtime]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  if (loading) {
    return <ActivityIndicator style={{marginTop: 32}} />;
  }

  return (
    <ScrollView contentContainerStyle={{padding: 16, gap: 12}}>
      <Text style={{color: tokens.text, fontSize: 16, fontWeight: '600'}}>
        事件配置
      </Text>
      <Text style={{color: tokens.textSecondary, lineHeight: 22}}>
        {summary}
      </Text>
      <Text style={{color: tokens.textSecondary, lineHeight: 22}}>
        session.compaction.requested：手动或条件触发后执行已配置的 action 链。
      </Text>
    </ScrollView>
  );
}
