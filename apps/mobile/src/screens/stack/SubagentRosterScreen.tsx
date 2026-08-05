/**
 * 全局子智能体名单配置页。
 *
 * 名单中的 agent 可被所有 agent 通过 task 工具调用。
 * general 为内置默认成员，始终启用、不可关闭。
 */
import React, {useCallback, useEffect, useState} from 'react';
import {ActivityIndicator, Text} from 'react-native';
import {FormSectionCard} from '../../components/form/FormSectionCard';
import {FormSwitchRow} from '../../components/form/FormSwitchRow';
import {ScreenFormLayout} from '../../components/form/ScreenFormLayout';
import {StickyFormFooter} from '../../components/form/StickyFormFooter';
import {useRuntime} from '../../hooks/useRuntime';
import {useTheme} from '../../theme/ThemeProvider';
import {useToast} from '../../components/chrome/ToastHost';
import {toastMessage} from '../../errors/toast-message';
import {assessAgentDefinitionWire} from '@novel-master/core/config-forms/stored-config-validity';

type AgentRow = {
  id: string;
  name: string;
  invalid?: boolean;
};

/** 从 wire JSON 尽力读取显示名称，失败回退到 agentId。 */
function agentDisplayNameFromWire(raw: unknown, agentId: string): string {
  if (
    raw != null &&
    typeof raw === 'object' &&
    'name' in raw &&
    typeof (raw as {name: unknown}).name === 'string'
  ) {
    const trimmed = (raw as {name: string}).name.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return agentId;
}

export function SubagentRosterScreen() {
  const {tokens} = useTheme();
  const {showToast} = useToast();
  const runtime = useRuntime();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [savedKey, setSavedKey] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const ids = await runtime.agentRegistry.listAgentIds();
      const rows: AgentRow[] = [];
      for (const id of ids) {
        const raw = await runtime.agentRegistry.getRawWire(id);
        const health = assessAgentDefinitionWire(raw);
        if (health.status === 'valid') {
          rows.push({id, name: health.value.name?.trim() || id});
        } else {
          rows.push({
            id,
            name: agentDisplayNameFromWire(raw, id),
            invalid: true,
          });
        }
      }
      rows.sort((a, b) => a.name.localeCompare(b.name));
      setAgents(rows);

      const names = await runtime.state.getSubagentNames();
      setSelected(new Set(names));
      setSavedKey(snapshotKey(names));
    } finally {
      setLoading(false);
    }
  }, [runtime]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  const dirty = snapshotKey([...selected]) !== savedKey;

  const toggle = useCallback((name: string, on: boolean) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (on) {
        next.add(name);
      } else {
        if (name === 'general') return prev;
        next.delete(name);
      }
      return next;
    });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const names = [...selected].sort();
      await runtime.state.setSubagentNames(names);
      setSavedKey(snapshotKey(names));
      showToast('已保存子智能体名单');
    } catch (error) {
      showToast(toastMessage('保存失败', error));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <ActivityIndicator style={{marginTop: 32}} />;
  }

  return (
    <ScreenFormLayout
      tokens={tokens}
      footer={
        <StickyFormFooter
          tokens={tokens}
          label="保存"
          loading={saving}
          disabled={!dirty}
          onPress={() => handleSave().catch(() => undefined)}
        />
      }>
      <FormSectionCard
        title="子智能体名单"
        tokens={tokens}
        hint="名单中的智能体可被所有智能体通过 task 工具调用。general 为内置默认成员，始终启用。">
        {agents.length === 0 ? (
          <Text style={{color: tokens.textSecondary, paddingHorizontal: 16}}>
            暂无已注册的智能体
          </Text>
        ) : (
          agents.map(agent => {
            const isGeneral = agent.name === 'general';
            return (
              <FormSwitchRow
                key={agent.id}
                label={
                  isGeneral
                    ? `${agent.name}（内置）`
                    : agent.invalid
                      ? `${agent.name}（配置失效）`
                      : agent.name
                }
                tokens={tokens}
                value={selected.has(agent.name)}
                onValueChange={next => toggle(agent.name, next)}
                disabled={isGeneral}
              />
            );
          })
        )}
      </FormSectionCard>
    </ScreenFormLayout>
  );
}

function snapshotKey(names: readonly string[]): string {
  return [...names].sort().join('\n');
}
