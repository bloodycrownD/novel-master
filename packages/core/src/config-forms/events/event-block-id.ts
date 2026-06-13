let nextBlockId = 0;

export function newEventBlockId(): string {
  nextBlockId += 1;
  return `evt-${Date.now()}-${nextBlockId}`;
}
