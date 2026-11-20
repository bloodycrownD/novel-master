import {coreT} from '../i18n/core';

export namespace FormatRelativeTime {
  /**
   * Short relative time for list subtitles.
   */
  export function formatMs(ms: number, nowMs = Date.now()): string {
    const delta = Math.max(0, nowMs - ms);
    const minute = 60_000;
    const hour = 60 * minute;
    const day = 24 * hour;

    if (delta < minute) {
      return coreT({key: "ui.common.time_just_now"});
    }
    if (delta < hour) {
      return coreT({key: "ui.common.time_minutes_ago", params: {count: Math.floor(delta / minute)}});
    }
    if (delta < day) {
      return coreT({key: "ui.common.time_hours_ago", params: {count: Math.floor(delta / hour)}});
    }
    if (delta < 7 * day) {
      return coreT({key: "ui.common.time_days_ago", params: {count: Math.floor(delta / day)}});
    }
    const d = new Date(ms);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }
}
