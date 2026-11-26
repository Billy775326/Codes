import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Message } from '../shared/types';
import type { ProjectFileReference } from './remarkProjectFileLinks';
import { useInterfaceLanguage } from './interface-language';
import { ImageAttachmentView } from './ImageAttachments';
import { MessageMarkdown } from './ContentPreview';
import { ChangeSummary } from './ChangeSummary';
import { MessageTime } from './MessageTime';
import { Icon, IconButton } from './primitives';
import { isFailedActivity, isToolActivity } from './activity';

export const MessageView = memo(function MessageView({
  projectId,
  projectPath,
  item,
  streaming,
  resolveFile,
  onOpenFile,
  onOpenImage,
  onReply,
  onFork,
  disabled,
  onReview,
  actions = false,
  changes,
  timestamp,
  completion,
}: {
  onReply?: (item: Message) => void;
  resolveFile: (href: string | undefined) => ProjectFileReference | undefined;
  onOpenFile: (file: ProjectFileReference) => void;
  onOpenImage: (path: string) => void;
  onFork?: (item: Message) => void;
  disabled?: boolean;
  onReview?: (item: Message, path?: string) => void;
  projectId: string;
  projectPath?: string;
  item: Message;
  streaming: boolean;
  actions?: boolean;
  changes?: Message;
  timestamp?: number;
  completion?: ReactNode;
}) {
  const { t } = useInterfaceLanguage();
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState('');
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(copyTimer.current), []);
  const failed = isFailedActivity(item);
  if (item.kind === 'change' && item.files?.length && !failed)
    return (
      <ChangeSummary item={item} review={onReview ? (path) => onReview(item, path) : undefined} />
    );
  if (isToolActivity(item)) {
    const firstLine = item.text
      .slice(0, item.text.indexOf('\n') < 0 ? 120 : item.text.indexOf('\n'))
      .slice(0, 100);
    return (
      <details
        className={failed ? 'tool tool-failed' : 'tool'}
        open={expanded}
        onToggle={(event) => setExpanded(event.currentTarget.open)}
      >
        <summary>
          <Icon name={item.status === 'completed' ? 'check' : 'terminal'} size={14} />
          <span className="activity-label">
            {item.kind === 'command'
              ? t(item.status === 'inProgress' ? 'Running {command}' : 'Ran {command}', {
                  command: firstLine || t('command'),
                })
              : item.kind === 'tool'
                ? firstLine
                : t('File changes')}
          </span>
          <span className="activity-status">{t(item.status ?? '')}</span>
        </summary>
        {expanded && (
          <>
            <pre>{item.text}</pre>
            {item.truncated && (
              <p className="tool-truncated">
                {t('Output preview is truncated. Inspect native history for the complete output.')}
              </p>
            )}
          </>
        )}
      </details>
    );
  }
  if (item.kind === 'compaction')
    return (
      <p className="message compaction" data-message-id={item.id} data-turn-id={item.turnId}>
        {item.text}
      </p>
    );
  return (
    <article
      data-message-id={item.id}
      data-turn-id={item.turnId}
      className={`message ${item.kind}`}
      data-testid={`message-${item.kind}`}
      tabIndex={item.kind === 'user' ? -1 : undefined}
    >
      <div className="message-body">
        {!!item.images?.length && (
          <div className="message-images">
            {item.images.map((image, index) => (
              <ImageAttachmentView
                key={image.id + ':' + index}
                image={image}
                projectId={projectId}
              />
            ))}
          </div>
        )}
        {!!item.unavailableImages && (
          <p className="image-unavailable">
            {item.unavailableImages}
            {' ' + t('image attachment(s) available in native history.')}
          </p>
        )}
        <div className="prose">
          <MessageMarkdown
            text={item.text}
            projectPath={projectPath}
            resolveFile={resolveFile}
            onOpenFile={onOpenFile}
            onOpenImage={onOpenImage}
            assistant={item.kind === 'assistant'}
            streaming={item.kind === 'assistant' && streaming}
          />
        </div>
        {changes && (
          <ChangeSummary
            item={changes}
            review={onReview ? (path) => onReview(changes, path) : undefined}
          />
        )}
        {!streaming &&
          item.kind !== 'user' &&
          ((actions && item.turnId && (onReply || onFork)) ||
            timestamp !== undefined ||
            completion) && (
            <div className="message-footer">
              {actions && !streaming && item.turnId && (onReply || onFork) && (
                <div className="message-actions" role="group" aria-label={t('Reply actions')}>
                  <IconButton
                    icon="copy"
                    label={t('Copy message')}
                    size={13}
                    onClick={() => {
                      void navigator.clipboard
                        ?.writeText(item.text)
                        .then(() => {
                          setCopied('Copied');
                          clearTimeout(copyTimer.current);
                          copyTimer.current = setTimeout(() => setCopied(''), 2000);
                        })
                        .catch(() => setCopied('Copy unavailable. Select the message text.'));
                      if (!navigator.clipboard)
                        setCopied('Copy unavailable. Select the message text.');
                    }}
                  />
                  {copied && <span role="status">{t(copied)}</span>}
                  {onReply && (
                    <IconButton
                      icon="reply"
                      label={t('Reply')}
                      hint={t('Quote in draft')}
                      size={13}
                      disabled={disabled}
                      onClick={() => onReply(item)}
                    />
                  )}
                  {onFork && (
                    <IconButton
                      icon="branch"
                      label={t('Branch from here')}
                      size={13}
                      disabled={disabled}
                      onClick={() => onFork(item)}
                    />
                  )}
                </div>
              )}
              {completion ?? <MessageTime value={timestamp} kind="finished" />}
            </div>
          )}
      </div>
      {item.kind === 'user' && <MessageTime value={timestamp} kind="started" />}
    </article>
  );
});
