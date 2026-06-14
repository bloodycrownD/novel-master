import {describe, expect, it, jest, beforeEach} from '@jest/globals';
import {
  AGENT_PICKER_EMPTY_MESSAGE,
  isAgentPickerRowSelected,
  loadAgentPickerRows,
  selectWorkspaceAgent,
} from '../src/services/agent-picker';

const mockSetCurrentAgentId = jest.fn(async () => undefined);
const mockGetCurrentAgentId = jest.fn(async () => undefined as string | undefined);
const mockListAgentIds = jest.fn(async () => [] as string[]);
const mockGet = jest.fn(async () => ({name: 'writer'}));

function mockRuntime() {
  return {
    state: {
      getCurrentAgentId: mockGetCurrentAgentId,
      setCurrentAgentId: mockSetCurrentAgentId,
    },
    agentRegistry: {
      listAgentIds: mockListAgentIds,
      get: mockGet,
    },
  };
}

describe('AgentPickerModal (picker service)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentAgentId.mockResolvedValue(undefined);
    mockListAgentIds.mockResolvedValue([]);
  });

  it('T-P2: empty registry shows empty-state copy', () => {
    expect(AGENT_PICKER_EMPTY_MESSAGE).toContain('智能体配置');
  });

  it('T-P2: loadAgentPickerRows returns no rows when registry empty', async () => {
    const {rows} = await loadAgentPickerRows(mockRuntime() as never);
    expect(rows).toEqual([]);
  });

  it('T-P1: selectWorkspaceAgent calls setCurrentAgentId', async () => {
    await selectWorkspaceAgent(mockRuntime() as never, 'a2');
    expect(mockSetCurrentAgentId).toHaveBeenCalledWith('a2');
  });

  it('marks first row current when no explicit current agent id', () => {
    expect(isAgentPickerRowSelected('a1', 0, undefined)).toBe(true);
    expect(isAgentPickerRowSelected('a2', 1, undefined)).toBe(false);
  });

  it('loads agent display labels from registry', async () => {
    mockListAgentIds.mockResolvedValue(['a1', 'a2']);
    mockGet.mockImplementation(async (id: string) => ({
      name: id === 'a1' ? 'Alpha' : 'Beta',
    }));

    const {rows} = await loadAgentPickerRows(mockRuntime() as never);
    expect(rows).toEqual([
      {agentId: 'a1', label: 'Alpha'},
      {agentId: 'a2', label: 'Beta'},
    ]);
  });
});
