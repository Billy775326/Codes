import { PanelMenu } from './PanelMenu';
import { Icon } from './primitives';

type Panel = 'files' | 'diff';
interface Props {
  title: string;
  projectName?: string;
  sidebarOpen: boolean;
  connection: string;
  panel: Panel | null;
  busy: boolean;
  hasProject: boolean;
  showStarters: boolean;
  onNavigation: () => void;
  onNewConversation: () => void;
  onSettings: () => void;
  onReview: () => void;
  onStatus: () => void;
  onPanel: (panel: Panel) => void;
  onDraft: (text: string) => void;
}
const starters = [
  ['Explore this project', 'Explain the architecture of this project and its main entry points.'],
  ['Plan a change', 'Review this project and help me plan a small, verifiable improvement.'],
  ['Review the code', 'Review the current code for potential bugs and explain your findings.'],
];

export function WorkspaceHeader(props: Props) {
  return (
    <header className="topbar">
      {!props.sidebarOpen && (
        <button
          className="icon-button"
          aria-label="Open navigation"
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
            aria-label={'Connection: ' + props.connection}
            title={props.connection}
          >
            {props.connection}
          </span>
        )}
        <PanelMenu
          label="Conversation actions"
          className="conversation-menu"
          iconOnly
          trigger={<Icon name="more" size={17} />}
        >
          {props.showStarters &&
            starters.map(([title, text]) => (
              <button key={title} data-close-menu onClick={() => props.onDraft(text!)}>
                {title}
              </button>
            ))}
          <button
            data-close-menu
            onClick={props.onReview}
            disabled={!props.hasProject || props.busy}
          >
            <Icon name="review" size={14} />
            Review code
          </button>
          <button data-close-menu onClick={props.onStatus}>
            <Icon name="activity" size={14} />
            Session status
          </button>
        </PanelMenu>
        <button
          aria-label="Browse files"
          disabled={!props.hasProject || props.busy}
          aria-pressed={props.panel === 'files'}
          data-tooltip=""
          className={'icon-button ' + (props.panel === 'files' ? 'selected' : '')}
          onClick={() => props.onPanel('files')}
        >
          <Icon name="folder" size={17} />
        </button>
        <button
          aria-label="Review changes"
          aria-pressed={props.panel === 'diff'}
          data-tooltip=""
          className={'icon-button ' + (props.panel === 'diff' ? 'selected' : '')}
          onClick={() => props.onPanel('diff')}
        >
          <Icon name="diff" size={17} />
        </button>
        {!props.sidebarOpen && (
          <button
            aria-label="Interaction settings"
            data-tooltip=""
            className="icon-button"
            onClick={props.onSettings}
          >
            <Icon name="settings" size={16} />
          </button>
        )}
        {!props.sidebarOpen && (
          <button
            aria-label="New conversation"
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
