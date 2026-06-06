/**
 * Regex config IPC handlers.
 */
import type {
  IpcResult,
  RegexCreateGroupRequest,
  RegexCreateRuleRequest,
  RegexGroupDto,
  RegexGroupIdRequest,
  RegexListPickerResponse,
  RegexRuleDto,
  RegexRuleIdRequest,
  RegexSetCurrentRequest,
  RegexUpdateGroupRequest,
  RegexUpdateRuleRequest,
} from "../../../../shared/ipc-types.js";
import { getDesktopRuntime } from "../../runtime/desktop-runtime-singleton.js";
import { formatIpcError } from "../ipc-error.js";

export async function handleRegexListGroups(): Promise<
  IpcResult<RegexGroupDto[]>
> {
  try {
    const rt = await getDesktopRuntime();
    const groups = await rt.regexConfig.listGroups();
    const rows: RegexGroupDto[] = [];
    for (const group of groups) {
      const rules = await rt.regexConfig.listRules(group.groupId);
      rows.push({
        groupId: group.groupId,
        displayName: group.displayName,
        ruleCount: rules.length,
      });
    }
    return { ok: true, data: rows };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleRegexGetGroup(
  req: RegexGroupIdRequest,
): Promise<IpcResult<RegexGroupDto>> {
  try {
    const rt = await getDesktopRuntime();
    const group = await rt.regexConfig.getGroup(req.groupId);
    const rules = await rt.regexConfig.listRules(req.groupId);
    return {
      ok: true,
      data: {
        groupId: group.groupId,
        displayName: group.displayName,
        ruleCount: rules.length,
      },
    };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleRegexCreateGroup(
  req: RegexCreateGroupRequest,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    await rt.regexConfig.createGroup(req);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleRegexUpdateGroup(
  req: RegexUpdateGroupRequest,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    await rt.regexConfig.updateGroup(req.groupId, {
      displayName: req.displayName,
    });
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleRegexDeleteGroup(
  req: RegexGroupIdRequest,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    await rt.regexConfig.deleteGroup(req.groupId);
    const currentId = await rt.state.getCurrentRegexGroupId();
    if (currentId === req.groupId) {
      await rt.state.resetCurrentRegexGroupId();
    }
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleRegexListRules(
  req: RegexGroupIdRequest,
): Promise<IpcResult<RegexRuleDto[]>> {
  try {
    const rt = await getDesktopRuntime();
    const rules = await rt.regexConfig.listRules(req.groupId);
    return { ok: true, data: rules as RegexRuleDto[] };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleRegexGetRule(
  req: RegexRuleIdRequest,
): Promise<IpcResult<RegexRuleDto>> {
  try {
    const rt = await getDesktopRuntime();
    const rule = await rt.regexConfig.getRule(req.groupId, req.ruleId);
    return { ok: true, data: rule as RegexRuleDto };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleRegexCreateRule(
  req: RegexCreateRuleRequest,
): Promise<IpcResult<{ ruleId: string }>> {
  try {
    const rt = await getDesktopRuntime();
    const { rule, groupId } = req;
    const ruleId =
      rule.ruleId ??
      (rule.name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || `rule-${Date.now()}`);
    const created = await rt.regexConfig.createRule({
      groupId,
      ruleId,
      name: rule.name,
      pattern: rule.pattern,
      flags: rule.flags,
      enabled: rule.enabled,
      llmReplace: rule.llmReplace ?? undefined,
      displayReplace: rule.displayReplace ?? undefined,
      scopeUser: rule.scopeUser,
      scopeAssistant: rule.scopeAssistant,
      startDepth: rule.startDepth,
      endDepth: rule.endDepth,
    });
    return { ok: true, data: { ruleId: created.ruleId } };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleRegexUpdateRule(
  req: RegexUpdateRuleRequest,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    const patch: Record<string, unknown> = { ...req.patch };
    if (patch.startDepth === null) delete patch.startDepth;
    if (patch.endDepth === null) delete patch.endDepth;
    await rt.regexConfig.updateRule(
      req.groupId,
      req.ruleId,
      patch as Parameters<typeof rt.regexConfig.updateRule>[2],
    );
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleRegexDeleteRule(
  req: RegexRuleIdRequest,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    await rt.regexConfig.deleteRule(req.groupId, req.ruleId);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleRegexListPicker(): Promise<
  IpcResult<RegexListPickerResponse>
> {
  try {
    const rt = await getDesktopRuntime();
    const currentId =
      (await rt.state.getCurrentRegexGroupId()) ?? undefined;
    const groups = await rt.regexConfig.listGroups();
    const rows = groups.map((g) => ({
      groupId: g.groupId,
      label: g.displayName?.trim() || g.groupId,
    }));
    return { ok: true, data: { rows, currentId } };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleRegexSetCurrent(
  req: RegexSetCurrentRequest,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    if (req.groupId == null) {
      await rt.state.resetCurrentRegexGroupId();
    } else {
      await rt.state.setCurrentRegexGroupId(req.groupId);
    }
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}
