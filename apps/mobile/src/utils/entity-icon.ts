/** 按实体 id 稳定选取图标（列表重排后不变）。 */
export function pickEntityIcon(id: string, icons: readonly string[]): string {
  if (icons.length === 0) {
    return '';
  }
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return icons[hash % icons.length]!;
}
