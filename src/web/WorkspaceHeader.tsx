import { useInterfaceLanguage } from './interface-language';
import { useLayoutEffect, useRef, useState } from 'react';
import { message } from './api';
import { PanelMenu } from './PanelMenu';
import { Icon, IconButton } from './primitives';

type Panel = 'files' | 'diff';
interface Props {
  title: string;
  conversationId?: string;
  renameDisabled?: boolean;
  projectName?: string;
  sidebarOpen: boolean;
  drawerLayout: boolean;
  connection: string;
  theme: 'dark' | 'light';
  panel: Panel | null;
  busy: boolean;
  hasProject: boolean;
  showStarters: boolean;
  onNavigation: () => void;
  onNewConversation: () => void;
  onSettings: () => void;
  onToggleTheme: () => void;
  onReload: () => void;
  onReview: () => void;
  onStatus: () => void;
  onPanel: (panel: Panel) => void;
  onDraft: (text: string) => void;
  onRename: (id: string, title: string) => Promise<void>;
}
const starters = [
  ['Explore this project', 'Explain the architecture of this project and its main entry points.'],
  ['Plan a change', 'Review this project and help me plan a small, verifiable improvement.'],
  ['Review the code', 'Review the current code for potential bugs and explain your findings.'],
] as const;

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
  const trigger = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  useLayoutEffect(() => {
    if (name === undefined && restoreFocus.current) {
      restoreFocus.current = false;
      trigger.current?.focus();
    }
  }, [name]);
  const close = () => {
    restoreFocus.current = true;
    setName(undefined);
    setError('');
  };
  if (name === undefined)
    return (
      <div className="conversation-heading">
        <h1 data-tooltip-overflow="">{title}</h1>
        {conversationId && (
          <IconButton
            ref={trigger}
            className="rename-conversation"
            icon="edit"
            label={t('Rename conversation')}
            size={14}
            disabled={renameDisabled}
            onClick={() => setName(title)}
          />
        )}
      </div>
    );
  const canSave =
    !!conversationId && !!name.trim() && name.trim() !== title && !saving && !renameDisabled;
  return (
    <div className="conversation-title-editor">
      <form
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
          if (event.key === 'Escape' && !saving) {
            event.preventDefault();
            close();
          }
        }}
      >
        <input
          aria-label={t('Conversation title')}
          value={name}
          maxLength={80}
          disabled={saving}
          autoFocus
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setName(event.target.value)}
        />
        <IconButton icon="close" label={t('Cancel')} size={14} disabled={saving} onClick={close} />
        <IconButton
          icon="check"
          label={t('Save name')}
          size={14}
          type="submit"
          disabled={!canSave}
        />
      </form>
      {error && (
        <p className="conversation-title-error" role="alert">
          {t(error)}
        </p>
      )}
    </div>
  );
}

export function WorkspaceHeader(props: Props) {
  const { t } = useInterfaceLanguage();
  const reloadLabel = t('Reload page');
  return (
    <header className="topbar">
      {(!props.sidebarOpen || !props.drawerLayout) && (
        <IconButton
          className="navigation-toggle"
          icon="sidebar"
          size={18}
          label={t(props.sidebarOpen ? 'Close navigation' : 'Open navigation')}
          data-open-navigation=""
          aria-controls="sidebar-navigation"
          aria-expanded={props.sidebarOpen}
          onClick={props.onNavigation}
        />
      )}
      <div className="breadcrumb">
        {!props.sidebarOpen && props.projectName && (
          <span className="project-breadcrumb" data-tooltip-overflow="">
            {props.projectName}
          </span>
        )}
        <ConversationHeading
          key={props.conversationId ?? ''}
          title={props.title}
          conversationId={props.conversationId}
          renameDisabled={props.renameDisabled}
          onRename={props.onRename}
        />
        <IconButton
          className="compact-page-reload"
          icon="refresh"
          label={reloadLabel}
          onClick={props.onReload}
        />
      </div>
      <div className="top-actions">
        {!props.sidebarOpen && (
          <span
            className={
              'header-connection ' +
              (['Connected', 'Ready'].includes(props.connection) ? 'connected' : '')
            }
            role="status"
            aria-label={t('Connection: {status}', { status: t(props.connection) })}
          >
            {t(props.connection)}
          </span>
        )}
        <PanelMenu
          label={t('Conversation actions')}
          className="conversation-menu"
          iconOnly
          trigger={<Icon name="more" size={17} />}
        >
          {props.showStarters &&
            starters.map(([title, text]) => (
              <button key={title} data-close-menu onClick={() => props.onDraft(text)}>
                {t(title)}
              </button>
            ))}
          <button
            data-close-menu
            onClick={props.onReview}
            disabled={!props.hasProject || props.busy}
          >
            <Icon name="review" size={14} />
            {t('Review code')}
          </button>
          <button data-close-menu onClick={props.onStatus}>
            <Icon name="activity" size={14} />
            {t('Session status')}
          </button>
        </PanelMenu>
        <div className="top-action-group" role="group" aria-label={t('Project views')}>
          <button
            data-browse-files=""
            data-project-view="files"
            aria-label={t('Browse files')}
            disabled={!props.hasProject || props.busy}
            aria-pressed={props.panel === 'files'}
            data-tooltip=""
            className={'icon-button ' + (props.panel === 'files' ? 'selected' : '')}
            onClick={() => props.onPanel('files')}
          >
            <Icon name="folder" size={17} />
          </button>
          <button
            data-project-view="diff"
            aria-label={t('View changes')}
            aria-pressed={props.panel === 'diff'}
            data-tooltip=""
            className={'icon-button ' + (props.panel === 'diff' ? 'selected' : '')}
            onClick={() => props.onPanel('diff')}
          >
            <Icon name="diff" size={17} />
          </button>
        </div>
        <div className="top-action-group" role="group" aria-label={t('Workspace tools')}>
          <IconButton
            className="page-reload"
            icon="refresh"
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
