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
  const [all, setAll] = useState(false);
  const files = useMemo(() => parseFileDiffs(item.files ?? []), [item.files]);
  const totals = files.reduce(
    (sum, file) => ({ add: sum.add + file.additions, del: sum.del + file.deletions }),
    { add: 0, del: 0 },
  );
  const count = new Set(files.map((file) => file.path)).size;
  return (
    <section className="edit-summary" aria-label="Edited files">
      <div className="edit-summary-heading">
        <Icon name="review" size={15} />
        <div>
          <strong>
            Edited {count} {count === 1 ? 'file' : 'files'}
          </strong>
          <small>
            <span className="diff-additions">+{totals.add}</span>{' '}
            <span className="diff-deletions">−{totals.del}</span>
            {(item.truncated || files.some((file) => file.truncated)) && ' · Partial preview'}
          </small>
        </div>
        {review && (
          <button aria-label="Review edited files" onClick={() => review()}>
            Review
          </button>
        )}
      </div>
      <div className="edit-summary-files">
        {files.slice(0, all ? 100 : 4).map((file, index) => (
          <button
            key={file.path + ':' + index}
            onClick={() => review?.(file.path)}
            title={file.path}
          >
            <span>{file.path}</span>
            <small className="diff-additions">+{file.additions}</small>
            <small className="diff-deletions">−{file.deletions}</small>
          </button>
        ))}
      </div>
      {files.length > 4 && (
        <button className="edit-summary-more" onClick={() => setAll(!all)}>
          {all ? 'Show fewer files' : 'Show all ' + files.length + ' edits'}
        </button>
      )}
    </section>
  );
}
