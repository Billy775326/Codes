import { useInterfaceLanguage } from './interface-language';
import { PanelMenu } from './PanelMenu';
import { Icon } from './primitives';

type Panel = 'files' | 'diff';
interface Props {
  title: string;
  projectName?: string;
  sidebarOpen: boolean;
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
  onReview: () => void;
  onStatus: () => void;
  onPanel: (panel: Panel) => void;
  onDraft: (text: string) => void;
}
const starters = [
  ['Explore this project', 'Explain the architecture of this project and its main entry points.'],
  ['Plan a change', 'Review this project and help me plan a small, verifiable improvement.'],
  ['Review the code', 'Review the current code for potential bugs and explain your findings.'],
] as const;

export function WorkspaceHeader(props: Props) {
  const { t } = useInterfaceLanguage();
  return (
    <header className="topbar">
      {!props.sidebarOpen && (
        <button
          className="icon-button"
          data-open-navigation=""
          aria-label={t('Open navigation')}
          data-tooltip=""
          onClick={props.onNavigation}
        >
          <Icon name="sidebar" size={17} />
        </button>
      )}
      <div className="breadcrumb">
        {!props.sidebarOpen && props.projectName && (
          <span className="project-breadcrumb" title={props.projectName}>
            {props.projectName}
          </span>
        )}
        <h1>{props.title}</h1>
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
            title={t(props.connection)}
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
        <button
          data-browse-files=""
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
          aria-label={t('Review changes')}
          aria-pressed={props.panel === 'diff'}
          data-tooltip=""
          className={'icon-button ' + (props.panel === 'diff' ? 'selected' : '')}
          onClick={() => props.onPanel('diff')}
        >
          <Icon name="diff" size={17} />
        </button>
        <button
          type="button"
          aria-label={props.theme === 'dark' ? t('Switch to light mode') : t('Switch to dark mode')}
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
    </header>
  );
}
