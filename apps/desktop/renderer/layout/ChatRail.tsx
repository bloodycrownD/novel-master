import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { coreT } from '@shared/logic/core-i18n';
import type { ProjectDto, SessionDto } from '@shared/ipc-types';
import { BatchCheckbox } from '../components/batch/BatchCheckbox';
import { ManageHeader } from '../components/batch/ManageHeader';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { ContextMenu } from '../components/ui/ContextMenu';
import { TextPromptModal } from '../components/ui/TextPromptModal';
import { showToast } from '../components/ui/show-toast';
import { ConversationPanel } from '../features/chat/ConversationPanel';
import { useBatchSelection } from '../hooks/useBatchSelection';
import {
    ipcAgentAbort,
    ipcProjectsCreate,
    ipcProjectsDelete,
    ipcProjectsList,
    ipcProjectsRename,
    ipcSessionsCreate,
    ipcSessionsDelete,
    ipcSessionsListByProject,
    ipcSessionsRename,
} from '../ipc/client';
import { useShellNav } from '../providers/ShellNavProvider';
import { loadDesktopScope } from '../state/desktop-scope';
import { railPaneNavTitle } from '../state/nav-workspace';
import { nextDefaultSessionTitle } from '../utils/session-default-title';

interface ChatRailProps {
    onOpenSessionActions: (anchor: HTMLElement) => void;
    settingsOpen: boolean;
}

type NamePromptState =
    | { mode: 'create-project' }
    | { mode: 'rename-project'; projectId: string; initialName: string }
    | { mode: 'rename-session'; sessionId: string; initialName: string };

type ConfirmState =
    | { kind: 'delete-projects-batch'; count: number }
    | { kind: 'delete-sessions-batch'; count: number }
    | { kind: 'delete-project'; projectId: string; name: string }
    | { kind: 'delete-session'; sessionId: string; label: string };

type ListMenuState =
    | { kind: 'project'; projectId: string; x: number; y: number }
    | { kind: 'session'; sessionId: string; x: number; y: number };

export function ChatRail({
    onOpenSessionActions,
    settingsOpen,
}: ChatRailProps) {
    const {
        viewId,
        projectId,
        projectName,
        sessionId,
        sessionName,
        openProject,
        openSession,
        goBackToProjects,
        goBackToSessions,
        showNavView,
        // subagentSessionId 提升到 ShellNavProvider，供子会话面板导航展示使用；
        // 子会话与父会话共享工作区，工作区 scope 仍由父 session 决定。
        openSubagentSession,
        exitSubagentSession,
        subagentSessionId: navSubagentSessionId,
        subagentSessionName: navSubagentSessionName,
    } = useShellNav();

    // 子会话只读面板的运行态（ConversationPanel 通过 onRunningChange 上报）。
    // subagentSessionId / subagentSessionName 已提升到 Provider，这里只保留 running 态。
    const [subagentRunning, setSubagentRunning] = useState(false);

    // Bug 2：子会话面板 keep-alive——返回父会话时只切 viewId，不清空子会话状态。
    // 这样 ConversationPanel 始终保持挂载，streamingText 等 local state 不会因卸载而丢失。
    // 用户退出再进入子会话还能看到正在进行的流式内容。面板的显隐完全交给外层 hidden 控制。
    const goBackToConversation = useCallback(() => {
        exitSubagentSession();
    }, [exitSubagentSession]);

    // 只读面板停止按钮——点击调 ipcAgentAbort。
    const stopSubagentRun = useCallback(async () => {
        if (navSubagentSessionId == null) return;
        await ipcAgentAbort({ sessionId: navSubagentSessionId });
    }, [navSubagentSessionId]);

    const {
        active: projectBatchActive,
        selectedIds: projectSelectedIds,
        selectedCount: projectSelectedCount,
        enter: enterProjectBatch,
        exit: exitProjectBatch,
        toggle: toggleProjectBatch,
        isSelected: isProjectSelected,
    } = useBatchSelection();
    const {
        active: sessionBatchActive,
        selectedIds: sessionSelectedIds,
        selectedCount: sessionSelectedCount,
        enter: enterSessionBatch,
        exit: exitSessionBatch,
        toggle: toggleSessionBatch,
        isSelected: isSessionSelected,
    } = useBatchSelection();

    const [projects, setProjects] = useState<ProjectDto[]>([]);
    const [sessions, setSessions] = useState<SessionDto[]>([]);
    const [loadingProjects, setLoadingProjects] = useState(true);
    const [loadingSessions, setLoadingSessions] = useState(false);
    const [namePrompt, setNamePrompt] = useState<NamePromptState | null>(null);
    const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
    const [listMenu, setListMenu] = useState<ListMenuState | null>(null);

    const loadProjects = useCallback(async () => {
        setLoadingProjects(true);
        try {
            const result = await ipcProjectsList();
            if (result.ok) {
                setProjects(result.data);
            }
        } finally {
            setLoadingProjects(false);
        }
    }, []);

    const loadSessions = useCallback(async (pid: string) => {
        setLoadingSessions(true);
        try {
            const result = await ipcSessionsListByProject({ projectId: pid });
            if (result.ok) {
                setSessions(result.data);
            }
        } finally {
            setLoadingSessions(false);
        }
    }, []);

    useEffect(() => {
        void loadProjects();
    }, [loadProjects]);

    useEffect(() => {
        if (viewId === 'sessions' && projectId) {
            void loadSessions(projectId);
        }
    }, [viewId, projectId, loadSessions]);

    useEffect(() => {
        if (viewId !== 'projects') {
            exitProjectBatch();
        }
    }, [viewId, exitProjectBatch]);

    useEffect(() => {
        if (viewId !== 'sessions') {
            exitSessionBatch();
        }
    }, [viewId, exitSessionBatch]);

    const deleteSelectedProjects = useCallback(async () => {
        const ids = [...projectSelectedIds];
        for (const id of ids) {
            await ipcProjectsDelete({ id });
        }
        exitProjectBatch();
        await loadDesktopScope();
        await loadProjects();
        if (projectId != null && ids.includes(projectId)) {
            goBackToProjects();
        }
    }, [
        projectSelectedIds,
        exitProjectBatch,
        loadProjects,
        projectId,
        goBackToProjects,
    ]);

    const deleteSelectedSessions = useCallback(async () => {
        const ids = [...sessionSelectedIds];
        for (const id of ids) {
            await ipcSessionsDelete({ id });
        }
        exitSessionBatch();
        await loadDesktopScope();
        if (projectId) {
            await loadSessions(projectId);
        }
        if (sessionId != null && ids.includes(sessionId)) {
            showNavView('sessions');
        }
    }, [
        sessionSelectedIds,
        exitSessionBatch,
        projectId,
        sessionId,
        loadSessions,
        showNavView,
    ]);

    const confirmProjectBatchDelete = useCallback(() => {
        if (projectSelectedCount === 0) {
            return;
        }
        setConfirmState({
            kind: 'delete-projects-batch',
            count: projectSelectedCount,
        });
    }, [projectSelectedCount]);

    const confirmSessionBatchDelete = useCallback(() => {
        if (sessionSelectedCount === 0) {
            return;
        }
        setConfirmState({
            kind: 'delete-sessions-batch',
            count: sessionSelectedCount,
        });
    }, [sessionSelectedCount]);

    const createSession = useCallback(async () => {
        if (!projectId) {
            return;
        }
        const title = nextDefaultSessionTitle(sessions.map(s => s.title));
        const result = await ipcSessionsCreate({ projectId, title });
        if (result.ok) {
            await loadSessions(projectId);
            await openSession(result.data, projectName ?? '—');
        } else {
            showToast(result.error.message);
        }
    }, [projectId, sessions, loadSessions, openSession, projectName]);

    const handleConfirmAction = useCallback(async () => {
        const state = confirmState;
        setConfirmState(null);
        if (!state) {
            return;
        }
        if (state.kind === 'delete-projects-batch') {
            await deleteSelectedProjects();
            return;
        }
        if (state.kind === 'delete-sessions-batch') {
            await deleteSelectedSessions();
            return;
        }
        if (state.kind === 'delete-project') {
            await ipcProjectsDelete({ id: state.projectId });
            await loadDesktopScope();
            await loadProjects();
            if (projectId === state.projectId) {
                goBackToProjects();
            }
            return;
        }
        if (state.kind === 'delete-session') {
            await ipcSessionsDelete({ id: state.sessionId });
            await loadDesktopScope();
            if (projectId) {
                await loadSessions(projectId);
            }
            if (sessionId === state.sessionId) {
                showNavView('sessions');
            }
        }
    }, [
        confirmState,
        deleteSelectedProjects,
        deleteSelectedSessions,
        loadProjects,
        projectId,
        goBackToProjects,
        loadSessions,
        sessionId,
        showNavView,
    ]);

    const handleNamePromptConfirm = useCallback(
        async (name: string) => {
            if (!namePrompt) {
                return;
            }
            if (namePrompt.mode === 'create-project') {
                const result = await ipcProjectsCreate({ name });
                if (result.ok) {
                    await loadProjects();
                    await openProject(result.data);
                }
                return;
            }
            if (namePrompt.mode === 'rename-project') {
                const result = await ipcProjectsRename({
                    id: namePrompt.projectId,
                    name,
                });
                if (result.ok) {
                    await loadProjects();
                }
                return;
            }
            if (namePrompt.mode === 'rename-session') {
                const result = await ipcSessionsRename({
                    id: namePrompt.sessionId,
                    title: name,
                });
                if (result.ok && projectId) {
                    await loadSessions(projectId);
                }
            }
        },
        [
            namePrompt,
            loadProjects,
            openProject,
            projectId,
            projectName,
            loadSessions,
            openSession,
        ],
    );

    const openProjectMenu = (project: ProjectDto, event: React.MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        setListMenu({
            kind: 'project',
            projectId: project.id,
            x: Math.max(8, Math.min(event.clientX, window.innerWidth - 140)),
            y: Math.max(8, Math.min(event.clientY, window.innerHeight - 100)),
        });
    };

    const openSessionMenu = (session: SessionDto, event: React.MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        setListMenu({
            kind: 'session',
            sessionId: session.id,
            x: Math.max(8, Math.min(event.clientX, window.innerWidth - 140)),
            y: Math.max(8, Math.min(event.clientY, window.innerHeight - 100)),
        });
    };

    const handleListMenuSelect = useCallback(
        (action: string) => {
            if (!listMenu) {
                return;
            }
            if (listMenu.kind === 'project') {
                const project = projects.find(p => p.id === listMenu.projectId);
                if (!project) {
                    return;
                }
                if (action === 'rename') {
                    setNamePrompt({
                        mode: 'rename-project',
                        projectId: project.id,
                        initialName: project.name,
                    });
                } else if (action === 'delete') {
                    setConfirmState({
                        kind: 'delete-project',
                        projectId: project.id,
                        name: project.name,
                    });
                }
                return;
            }
            const session = sessions.find(s => s.id === listMenu.sessionId);
            if (!session) {
                return;
            }
            if (action === 'rename') {
                setNamePrompt({
                    mode: 'rename-session',
                    sessionId: session.id,
                    initialName: session.title ?? '',
                });
            } else if (action === 'delete') {
                setConfirmState({
                    kind: 'delete-session',
                    sessionId: session.id,
                    label: session.title?.trim() || coreT({key: "ui.nav.this_session"}),
                });
            }
        },
        [
            listMenu,
            projects,
            sessions,
            loadProjects,
            projectId,
            goBackToProjects,
            loadSessions,
            sessionId,
            showNavView,
        ],
    );

    const namePromptTitle = (() => {
        if (!namePrompt) {
            return '';
        }
        switch (namePrompt.mode) {
            case 'create-project':
                return coreT({key: "ui.project.new_title"});
            case 'rename-project':
                return coreT({key: "ui.project.rename_title"});
            case 'rename-session':
                return coreT({key: "ui.project.rename_session"});
            default:
                return '';
        }
    })();

    const showBack = viewId === 'sessions' || viewId === 'conversation' || viewId === 'subagent-conversation';

    let backAction: string;
    let backHandler: () => void;
    if (viewId === 'sessions') {
        backAction = 'back-to-projects';
        backHandler = goBackToProjects;
    } else if (viewId === 'subagent-conversation') {
        backAction = 'back-to-conversation';
        backHandler = goBackToConversation;
    } else {
        backAction = 'back-to-sessions';
        backHandler = goBackToSessions;
    }

    let railTitle: ReactNode;
    if (viewId === 'sessions') {
        railTitle = (
            <span className="column-header__title column-header__title--truncate">
                {projectName ?? '—'}
            </span>
        );
    } else if (viewId === 'conversation') {
        railTitle = (
            <span className="column-header__title column-header__title--truncate">
                {sessionName ?? '—'}
            </span>
        );
    } else if (viewId === 'subagent-conversation') {
        railTitle = (
            <span className="column-header__title column-header__title--truncate">
                {navSubagentSessionName || coreT({key: "ui.nav.subagent_session_view"})}
            </span>
        );
    } else {
        railTitle = (
            <span className="column-header__title">
                {railPaneNavTitle(viewId)}
            </span>
        );
    }

    let projectListNode: ReactNode;
    if (loadingProjects) {
        projectListNode = (
            <li className="chat-list__item">
                <span className="chat-list__label">{coreT({key: "ui.common.loading"})}</span>
            </li>
        );
    } else if (projects.length === 0) {
        projectListNode = (
            <li className="chat-list__item chat-list__item--empty">
                <span className="chat-list__label">{coreT({key: "ui.project.empty_desktop"})}</span>
                <button
                    type="button"
                    className="chat-list__create-btn"
                    onClick={() => setNamePrompt({ mode: 'create-project' })}
                >
                    {coreT({key: "ui.project.new_title"})}
                </button>
            </li>
        );
    } else {
        projectListNode = projects.map(project => (
            <li
                key={project.id}
                className={`chat-list__item${
                    isProjectSelected(project.id) ? ' is-selected' : ''
                }`}
                data-project-id={project.id}
                data-project-name={project.name}
                role="button"
                tabIndex={0}
                onClick={() => {
                    if (projectBatchActive) {
                        toggleProjectBatch(project.id);
                    } else {
                        void openProject(project);
                    }
                }}
                onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        if (projectBatchActive) {
                            toggleProjectBatch(project.id);
                        } else {
                            void openProject(project);
                        }
                    }
                }}
            >
                {projectBatchActive ? (
                    <BatchCheckbox
                        checked={isProjectSelected(project.id)}
                        onToggle={() => toggleProjectBatch(project.id)}
                    />
                ) : (
                    <span className="chat-list__icon">📚</span>
                )}
                <span className="chat-list__label">{project.name}</span>
                {!projectBatchActive ? (
                    <>
                        <button
                            type="button"
                            className="chat-list__menu-btn"
                            aria-label={coreT({key: "ui.nav.project_actions"})}
                            onClick={e => openProjectMenu(project, e)}
                        >
                            ⋮
                        </button>
                        <span className="chat-list__chevron">›</span>
                    </>
                ) : null}
            </li>
        ));
    }

    let sessionListNode: ReactNode;
    if (loadingSessions) {
        sessionListNode = (
            <li className="chat-list__item">
                <span className="chat-list__label">{coreT({key: "ui.common.loading"})}</span>
            </li>
        );
    } else if (sessions.length === 0) {
        sessionListNode = (
            <li className="chat-list__item chat-list__item--empty">
                <span className="chat-list__label">{coreT({key: "ui.project.empty_sessions"})}</span>
                <button
                    type="button"
                    className="chat-list__create-btn"
                    onClick={() => void createSession()}
                >
                    {coreT({key: "ui.project.new_session"})}
                </button>
            </li>
        );
    } else {
        sessionListNode = sessions.map(session => (
            <li
                key={session.id}
                className={`chat-list__item${
                    isSessionSelected(session.id) ? ' is-selected' : ''
                }`}
                data-session-id={session.id}
                data-session-name={session.title ?? ''}
                role="button"
                tabIndex={0}
                onClick={() => {
                    if (sessionBatchActive) {
                        toggleSessionBatch(session.id);
                    } else {
                        void openSession(session, projectName ?? '—');
                    }
                }}
                onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        if (sessionBatchActive) {
                            toggleSessionBatch(session.id);
                        } else {
                            void openSession(session, projectName ?? '—');
                        }
                    }
                }}
            >
                {sessionBatchActive ? (
                    <BatchCheckbox
                        checked={isSessionSelected(session.id)}
                        onToggle={() => toggleSessionBatch(session.id)}
                    />
                ) : null}
                <span className="chat-list__label">
                    {session.title ?? coreT({key: "ui.nav.untitled_session"})}
                </span>
                {!sessionBatchActive ? (
                    <>
                        <button
                            type="button"
                            className="chat-list__menu-btn"
                            aria-label={coreT({key: "ui.nav.session_actions"})}
                            onClick={e => openSessionMenu(session, e)}
                        >
                            ⋮
                        </button>
                        <span className="chat-list__chevron">›</span>
                    </>
                ) : null}
            </li>
        ));
    }

    let namePromptInitial: string;
    if (namePrompt?.mode === 'rename-project') {
        namePromptInitial = namePrompt.initialName;
    } else if (namePrompt?.mode === 'rename-session') {
        namePromptInitial = namePrompt.initialName;
    } else {
        namePromptInitial = '';
    }

    return (
        <>
            <header className="column-header" id="rail-header" aria-label={coreT({key: "ui.nav.chat_nav_aria"})}>
                <div className="column-header__nav" id="rail-pane-nav">
                    {showBack ? (
                        <button
                            type="button"
                            className="chat-nav-back"
                            data-action={backAction}
                            aria-label={coreT({key: "ui.common.back"})}
                            onClick={backHandler}
                        >
                            ‹
                        </button>
                    ) : null}
                    {railTitle}
                </div>
            </header>
            <section id="chat-rail" aria-label={coreT({key: "ui.nav.chat_content_aria"})}>
                <div
                    className={`chat-nav-view${
            viewId === 'projects' ? ' is-visible' : ''
          }`}
                    data-nav-view="projects"
                    hidden={viewId !== 'projects'}
                >
                    <ManageHeader
                        title={coreT({key: "ui.project.title"})}
                        batchMode={projectBatchActive}
                        selectedCount={projectSelectedCount}
                        onEnterBatch={enterProjectBatch}
                        onCancelBatch={exitProjectBatch}
                        onDelete={confirmProjectBatchDelete}
                        hint={coreT({key: "ui.project.delete_select_hint"})}
                        normalActions={
                            <button
                                type="button"
                                className="list-manage-header__btn list-manage-header__btn--primary"
                                onClick={() => setNamePrompt({ mode: 'create-project' })}
                            >
                                {coreT({key: "ui.common.new"})}
                            </button>
                        }
                    />
                    <ul className="chat-list" id="project-list">
                        {projectListNode}
                    </ul>
                </div>

                <div
                    className={`chat-nav-view${
            viewId === 'sessions' ? ' is-visible' : ''
          }`}
                    data-nav-view="sessions"
                    hidden={viewId !== 'sessions'}
                >
                    <ManageHeader
                        title={coreT({key: "ui.nav.chat"})}
                        batchMode={sessionBatchActive}
                        selectedCount={sessionSelectedCount}
                        onEnterBatch={enterSessionBatch}
                        onCancelBatch={exitSessionBatch}
                        onDelete={confirmSessionBatchDelete}
                        hint={coreT({key: "ui.project.select_sessions_hint"})}
                        normalActions={
                            <button
                                type="button"
                                className="list-manage-header__btn list-manage-header__btn--primary"
                                onClick={() => void createSession()}
                            >
                                {coreT({key: "ui.common.new"})}
                            </button>
                        }
                    />
                    <ul className="chat-list" id="session-list">
                        {sessionListNode}
                    </ul>
                </div>

                <div
                    className={`chat-nav-view${
            viewId === 'conversation' ? ' is-visible' : ''
          }`}
                    data-nav-view="conversation"
                    hidden={viewId !== 'conversation'}
                >
                    {projectId && sessionId ? (
                        <ConversationPanel
                            projectId={projectId}
                            sessionId={sessionId}
                            onOpenSessionActions={onOpenSessionActions}
                            onOpenSubagentSession={(childSessionId) =>
                                openSubagentSession(childSessionId)
                            }
                        />
                    ) : (
                        <p className="preview-empty">{coreT({key: "ui.chat.select_session"})}</p>
                    )}
                </div>

                <div
                    className={`chat-nav-view${
            viewId === 'subagent-conversation' ? ' is-visible' : ''
          }`}
                    data-nav-view="subagent-conversation"
                    hidden={viewId !== 'subagent-conversation'}
                >
                    {projectId && navSubagentSessionId ? (
                        <>
                            {subagentRunning ? (
                                <div className="subagent-stop-bar" role="toolbar">
                                    <span className="subagent-stop-bar__label">
                                        {coreT({key: "ui.chat.subagent_running_empty"})}
                                    </span>
                                    <button
                                        type="button"
                                        className="subagent-stop-bar__button"
                                        onClick={() => {
                                            void stopSubagentRun();
                                        }}
                                    >
                                        {coreT({key: "ui.common.stop"})}
                                    </button>
                                </div>
                            ) : null}
                            <ConversationPanel
                                projectId={projectId}
                                sessionId={navSubagentSessionId}
                                onOpenSessionActions={() => undefined}
                                readOnly
                                onRunningChange={setSubagentRunning}
                                onOpenSubagentSession={(childSessionId) =>
                                    openSubagentSession(childSessionId)
                                }
                            />
                        </>
                    ) : (
                        <p className="preview-empty">{coreT({key: "ui.chat.subagent_pick_parent_hint"})}</p>
                    )}
                </div>
            </section>

            <TextPromptModal
                open={namePrompt != null}
                title={namePromptTitle}
                initialValue={namePromptInitial}
                placeholder={coreT({key: "ui.chat.rename_prompt"})}
                onClose={() => setNamePrompt(null)}
                onConfirm={handleNamePromptConfirm}
            />

            <ContextMenu
                open={listMenu != null}
                x={listMenu?.x ?? 0}
                y={listMenu?.y ?? 0}
                items={[
                    { label: coreT({key: "ui.common.rename"}), action: 'rename' },
                    { label: coreT({key: "ui.common.delete"}), action: 'delete', danger: true },
                ]}
                onSelect={handleListMenuSelect}
                onClose={() => setListMenu(null)}
            />

            <ConfirmModal
                open={confirmState != null}
                title={coreT({key: "ui.common.confirm_delete"})}
                message={(() => {
                    if (!confirmState) return '';
                    switch (confirmState.kind) {
                        case 'delete-projects-batch':
                            return coreT({key: "ui.project.delete_batch_confirm", params: {count: confirmState.count}});
                        case 'delete-sessions-batch':
                            return coreT({key: "ui.chat.delete_sessions_confirm", params: {count: confirmState.count}});
                        case 'delete-project':
                            return coreT({key: "ui.project.delete_confirm_named", params: {name: confirmState.name}});
                        case 'delete-session':
                            return coreT({key: "ui.chat.delete_session_confirm", params: {name: confirmState.label}});
                        default:
                            return '';
                    }
                })()}
                danger
                onConfirm={handleConfirmAction}
                onCancel={() => setConfirmState(null)}
            />

        </>
    );
}
