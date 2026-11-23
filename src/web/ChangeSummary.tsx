import { useInterfaceLanguage } from './interface-language';
import { useMemo, useState } from 'react';
import type { Message } from '../shared/types';
import { parseFileDiffs } from '../shared/diff';
import { Icon } from './primitives';

export function ChangeSummary({
  item,
  review,
}: {
  item: Message;
  review?: (path?: string) => void;
}) {
  const { t } = useInterfaceLanguage();
  const [all, setAll] = useState(false);
  const files = useMemo(() => parseFileDiffs(item.files ?? []), [item.files]);
  const totals = files.reduce(
    (sum, file) => ({ add: sum.add + file.additions, del: sum.del + file.deletions }),
    { add: 0, del: 0 },
  );
  const count = new Set(files.map((file) => file.path)).size;
  return (
    <section className="edit-summary" aria-label={t('Edited files')}>
      <div className="edit-summary-heading">
        <Icon name="diff" size={15} />
        <div>
          <strong>
            {t(count === 1 ? 'Edited {count} file' : 'Edited {count} files', { count })}
          </strong>
          <small>
            <span className="diff-additions">+{totals.add}</span>{' '}
            <span className="diff-deletions">−{totals.del}</span>
            {(item.truncated || files.some((file) => file.truncated)) &&
              ' · ' + t('Partial preview')}
          </small>
        </div>
        {review && (
          <button aria-label={t('View changes for edited files')} onClick={() => review()}>
            {t('View changes')}
          </button>
        )}
      </div>
      <div className="edit-summary-files">
        {files.slice(0, all ? 100 : 4).map((file, index) => (
          <button
            key={file.path + ':' + index}
            onClick={() => review?.(file.path)}
            disabled={!review}
            title={file.path}
          >
            <span>{file.path}</span>
            <small className="diff-additions">+{file.additions}</small>
            <small className="diff-deletions">−{file.deletions}</small>
          </button>
        ))}
      </div>
      {files.length > 4 && (
        <button className="edit-summary-more" aria-expanded={all} onClick={() => setAll(!all)}>
          {all ? t('Show fewer files') : t('Show all {count} edits', { count: files.length })}
        </button>
      )}
    </section>
  );
}
