import { useInterfaceLanguage } from './interface-language';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { message } from './api';
import { ConnectionStatus } from './ConnectionStatus';
import { Icon, IconButton } from './primitives';

interface Props {
  title: string;
  conversationId?: string;
  renameDisabled?: boolean;
  cwd?: string;
  onChooseDirectory?: () => void;
  sidebarOpen: boolean;
  connection: string;
  theme: 'dark' | 'light';
  contextOpen: boolean;
  busy: boolean;
  hasContext: boolean;
  onNavigation: () => void;
  onNewConversation: () => void;
  onSettings: () => void;
  onToggleTheme: () => void;
  onReload: () => void;
  onReconnect?: () => void;
  updateAvailable: boolean;
  onStatus: () => void;
  onToggleContext: () => void;
  onRename: (id: string, title: string) => Promise<void>;
}

const minimumTitleEditorWidth = 250;

function ConversationHeading({
  title,
  conversationId,
  renameDisabled,
  onRename,
}: Pick<Props, 'title' | 'conversationId' | 'renameDisabled' | 'onRename'>) {
  const { t } = useInterfaceLanguage();
  const [name, setName] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [titleFitsEditor, setTitleFitsEditor] = useState(false);
  const heading = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const editorId = useId();
  const editing = name !== undefined;
  useLayoutEffect(() => {
    if (!editing && restoreFocus.current) {
      restoreFocus.current = false;
      trigger.current?.focus();
    }
  }, [editing]);
  useLayoutEffect(() => {
    const slot = heading.current;
    if (!editing || !slot) return;
    const measure = () => setTitleFitsEditor(slot.clientWidth >= minimumTitleEditorWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(slot);
    return () => observer.disconnect();
  }, [editing]);
  const close = () => {
    restoreFocus.current = true;
    setName(undefined);
    setError('');
  };
  const canSave =
    !!conversationId && !!name?.trim() && name.trim() !== title && !saving && !renameDisabled;
  return (
    <div
      ref={heading}
      className="conversation-heading"
      data-rename-layout={editing ? (titleFitsEditor ? 'title' : 'row') : undefined}
    >
      <h1 data-tooltip-overflow="">{title}</h1>
      {conversationId && (
        <IconButton
          ref={trigger}
          className="rename-conversation"
          icon="edit"
          label={t('Rename conversation')}
          size={14}
          disabled={renameDisabled || saving}
          aria-expanded={editing}
          aria-controls={editing ? editorId : undefined}
          onClick={() => setName(title)}
        />
      )}
      {editing && (
        <form
          className="conversation-title-editor"
          id={editorId}
          aria-label={t('Rename conversation')}
          onSubmit={async (event) => {
            event.preventDefault();
            if (!canSave) return;
            setSaving(true);
            setError('');
            try {
              await onRename(conversationId, name.trim());
              close();
            } catch (error) {
              setError(message(error));
            } finally {
              setSaving(false);
            }
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Escape' || saving) return;
            event.stopPropagation();
            close();
          }}
        >
          <div className="conversation-title-controls">
            <input
              aria-label={t('Conversation title')}
              value={name}
              maxLength={80}
              disabled={saving}
              autoFocus
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => setName(event.target.value)}
            />
            <IconButton
              icon="close"
              label={t('Cancel')}
              size={14}
              disabled={saving}
              onClick={close}
            />
            <IconButton
              icon="check"
              label={t('Save name')}
              size={14}
              type="submit"
              disabled={!canSave}
            />
          </div>
          {error && (
            <p className="conversation-title-error" role="alert">
              {t(error)}
            </p>
          )}
        </form>
      )}
    </div>
  );
}

export function WorkspaceHeader(props: Props) {
  const { t } = useInterfaceLanguage();
  const reloadLabel = t(props.updateAvailable ? 'Reload to apply update' : 'Reload page');
  return (
    <header className="topbar">
      {!props.sidebarOpen && (
        <IconButton
          icon="sidebar"
          size={18}
          label={t('Open navigation')}
          data-open-navigation=""
          aria-controls="sidebar-navigation"
          aria-expanded={false}
          onClick={props.onNavigation}
        />
      )}
      <div className="breadcrumb">
        <ConversationHeading
          key={props.conversationId ?? ''}
          title={props.title}
          conversationId={props.conversationId}
          renameDisabled={props.renameDisabled}
          onRename={props.onRename}
        />
        {props.cwd &&
          (props.onChooseDirectory ? (
            <button
              type="button"
              className="workspace-directory"
              aria-label={t('Change working directory')}
              data-tooltip={props.cwd}
              disabled={props.busy}
              onClick={props.onChooseDirectory}
            >
              <Icon name="folder" size={14} />
              <span>{props.cwd}</span>
            </button>
          ) : (
            <span className="workspace-directory" data-tooltip-overflow="">
              <Icon name="folder" size={14} />
              <span>{props.cwd}</span>
            </span>
          ))}
        <IconButton
          className="session-status-button"
          icon="activity"
          label={t('Session status')}
          onClick={props.onStatus}
        />
        <IconButton
          className={'compact-page-reload' + (props.updateAvailable ? ' web-update-available' : '')}
          icon="reload-page"
          label={reloadLabel}
          onClick={props.onReload}
        />
      </div>
      {!props.sidebarOpen && (
        <ConnectionStatus
          status={props.connection}
          placement="header"
          onReconnect={props.onReconnect}
        />
      )}
      <div className="top-actions">
        <IconButton
          icon="folder"
          label={t('Files and changes')}
          size={17}
          data-open-context=""
          aria-controls="sidebar-context"
          aria-expanded={props.contextOpen}
          className={props.contextOpen ? 'selected' : undefined}
          disabled={!props.contextOpen && (!props.hasContext || props.busy)}
          onClick={props.onToggleContext}
        />
        <div className="top-action-group" role="group" aria-label={t('Workspace tools')}>
          <IconButton
            className={'page-reload' + (props.updateAvailable ? ' web-update-available' : '')}
            icon="reload-page"
            label={reloadLabel}
            onClick={props.onReload}
          />
          <button
            type="button"
            aria-label={
              props.theme === 'dark' ? t('Switch to light mode') : t('Switch to dark mode')
            }
            data-tooltip=""
            className="icon-button"
            onClick={props.onToggleTheme}
          >
            <Icon name={props.theme === 'dark' ? 'sun' : 'moon'} size={17} />
          </button>
          {!props.sidebarOpen && (
            <button
              aria-label={t('Interaction settings')}
              data-tooltip=""
              className="icon-button"
              onClick={props.onSettings}
            >
              <Icon name="settings" size={16} />
            </button>
          )}
          {!props.sidebarOpen && (
            <button
              aria-label={t('New conversation')}
              data-tooltip=""
              className="icon-button"
              disabled={props.busy}
              onClick={props.onNewConversation}
            >
              <Icon name="newchat" size={16} />
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
