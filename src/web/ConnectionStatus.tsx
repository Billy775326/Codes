import { useInterfaceLanguage } from './interface-language';
import { IconButton } from './primitives';

export function ConnectionStatus({
  status,
  placement,
  onReconnect,
}: {
  status: string;
  placement: 'header' | 'sidebar';
  onReconnect?: () => void;
}) {
  const { t } = useInterfaceLanguage();
  const inHeader = placement === 'header';
  const label = t(status);
  const connected = status === 'Connected' || status === 'Ready';
  return (
    <div className={inHeader ? 'header-connection-controls' : 'workspace-connection'}>
      <span
        className={
          (inHeader ? 'header-connection' : 'connection') + (connected ? ' connected' : '')
        }
        role="status"
        aria-label={t('Connection: {status}', { status: label })}
      >
        {!inHeader && <i />}
        {label}
      </span>
      {onReconnect && (
        <IconButton icon="plug" label={t('Reconnect updates')} onClick={onReconnect} />
      )}
    </div>
  );
}
