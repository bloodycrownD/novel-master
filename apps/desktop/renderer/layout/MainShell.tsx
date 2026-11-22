import type { RefObject } from 'react';
import { coreT } from '@shared/logic/core-i18n';
import type { WorkspaceContextTarget } from '../features/workspace/WorkspaceTree';
import { ChatRail } from './ChatRail';
import { ExplorerPane } from './ExplorerPane';
import { PreviewPane } from './PreviewPane';

interface MainShellProps {
    workspaceRef: RefObject<HTMLDivElement | null>;
    onOpenWorkspaceContextMenu: (target: WorkspaceContextTarget) => void;
    onBlankWorkspaceContextMenu: (
        target: Extract<WorkspaceContextTarget, { kind: 'blank' }>,
    ) => void;
    onOpenSessionActions: (anchor: HTMLElement) => void;
    settingsOpen: boolean;
}

export function MainShell({
    workspaceRef,
    onOpenWorkspaceContextMenu,
    onBlankWorkspaceContextMenu,
    onOpenSessionActions,
    settingsOpen,
}: MainShellProps) {
    return (
        <div className="workspace" ref={workspaceRef}>
            <PreviewPane />

            <div
                className="column-splitter"
                id="splitter-preview-explorer"
                data-splitter="preview-explorer"
                role="separator"
                aria-orientation="vertical"
                aria-label={coreT({key: "ui.nav.resize_left_aria"})}
                tabIndex={0}
            />

            <ExplorerPane
                onOpenContextMenu={onOpenWorkspaceContextMenu}
                onBlankContextMenu={onBlankWorkspaceContextMenu}
            />

            <div
                className="column-splitter"
                id="splitter-explorer-chat"
                data-splitter="explorer-chat"
                role="separator"
                aria-orientation="vertical"
                aria-label={coreT({key: "ui.nav.resize_right_aria"})}
                tabIndex={0}
            />

            <ChatRail
                onOpenSessionActions={onOpenSessionActions}
                settingsOpen={settingsOpen}
            />
        </div>
    );
}
