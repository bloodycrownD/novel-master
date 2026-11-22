import {describe, expect, it, jest, beforeEach} from '@jest/globals';
import {AGENT_PICKER_EMPTY_MESSAGE, AgentPicker} from '@/services/agent-picker'

const mockSetCurrentAgentId = jest.fn(async () => undefined);
const mockGetCurrentAgentId = jest.fn(
    async () => ({ok: true as const, value: undefined as string | undefined}),
);
const mockListAgentIds = jest.fn(async () => [] as string[]);
// 错误通道迁移后 registry.get 走 Result 通道（生产侧 `def.ok` 判定）。
const mockGet = jest.fn(async () => ({
    ok: true as const,
    value: {name: 'writer', mode: 'all'} as const,
}));

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
        mockGetCurrentAgentId.mockResolvedValue({ok: true as const, value: undefined});
        mockListAgentIds.mockResolvedValue([]);
    });

    it('T-P2: empty registry shows empty-state copy', () => {
        expect(AGENT_PICKER_EMPTY_MESSAGE).toContain('智能体配置');
    });

    it('T-P2: loadAgentPickerRows returns no rows when registry empty', async () => {
        const loaded = await AgentPicker.loadRows(mockRuntime() as never);
        if (!loaded.ok) throw loaded.error;
        expect(loaded.value.rows).toEqual([]);
    });

    it('T-P1: selectWorkspaceAgent calls setCurrentAgentId', async () => {
        await AgentPicker.selectWorkspace(mockRuntime() as never, 'a2');
        expect(mockSetCurrentAgentId).toHaveBeenCalledWith('a2');
    });

    it('marks first row current when no explicit current agent id', () => {
        expect(AgentPicker.isRowSelected('a1', 0, undefined)).toBe(true);
        expect(AgentPicker.isRowSelected('a2', 1, undefined)).toBe(false);
    });

    it('loads agent display labels from registry', async () => {
        mockListAgentIds.mockResolvedValue(['a1', 'a2']);
        mockGet.mockImplementation(async (id: string) => ({
            ok: true as const,
            value: {name: id === 'a1' ? 'Alpha' : 'Beta', mode: 'all'},
        }));

        const labeled = await AgentPicker.loadRows(mockRuntime() as never);
        if (!labeled.ok) throw labeled.error;
        expect(labeled.value.rows).toEqual([
            {agentId: 'a1', label: 'Alpha'},
            {agentId: 'a2', label: 'Beta'},
        ]);
    });

    it('T-AC7: filters out agents whose mode is subagent (AC-7)', async () => {
        mockListAgentIds.mockResolvedValue(['primary', 'sub', 'all']);
        mockGet.mockImplementation(async (id: string) => {
            if (id === 'primary') {
                return {ok: true as const, value: {name: 'Primary', mode: 'primary'}};
            }
            if (id === 'sub') {
                return {ok: true as const, value: {name: 'Sub', mode: 'subagent'}};
            }
            return {ok: true as const, value: {name: 'All', mode: 'all'}};
        });

        const loaded = await AgentPicker.loadRows(mockRuntime() as never);
        if (!loaded.ok) throw loaded.error;
        expect(loaded.value.rows).toEqual([
            {agentId: 'primary', label: 'Primary'},
            {agentId: 'all', label: 'All'},
        ]);
    });
});
