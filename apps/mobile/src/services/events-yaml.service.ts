import {decode, encode, parseText, stringifyText} from '@novel-master/core';
import {eventsConfigSchema, type EventsConfig} from '@novel-master/core/events';

import type {MobileNovelMasterRuntime} from '../runtime/types';
import {
  exportYamlFile,
  importYamlFile,
  normalizeYamlError,
} from './yaml-shared';

export function decodeEventsYamlText(yaml: string) {
  const raw = parseText(yaml, 'yaml');
  return decode(raw, eventsConfigSchema);
}

export function encodeEventsYamlText(config: EventsConfig): string {
  const wire = encode(config, eventsConfigSchema);
  return stringifyText(wire, 'yaml');
}

export async function exportEventsYaml(
  runtime: MobileNovelMasterRuntime,
): Promise<'saved' | 'cancelled'> {
  const config = await runtime.eventsConfig.getConfig();
  const yaml = encodeEventsYamlText(config);
  return exportYamlFile(yaml, 'events.config.yaml');
}

export async function importEventsYaml(
  runtime: MobileNovelMasterRuntime,
): Promise<void> {
  await importYamlFile(async yaml => {
    try {
      const config = decodeEventsYamlText(yaml);
      await runtime.eventsConfig.setConfig(config);
    } catch (error) {
      throw normalizeYamlError(error, 'Events YAML 无效');
    }
  });
}
