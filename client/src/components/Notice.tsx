import type { Notice } from './useNotice';

const TONE = {
  ok: 'bg-emerald-50 text-emerald-800',
  warn: 'bg-amber-50 text-amber-800',
  error: 'bg-red-50 text-red-700',
};

export function NoticeBanner({
  notice,
  onDismiss,
}: {
  notice: Notice | null;
  onDismiss: () => void;
}) {
  if (!notice) return null;
  return (
    <div
      role="status"
      className={`mt-4 flex items-start justify-between gap-3 rounded-lg px-4 py-3 text-sm ${TONE[notice.tone]}`}
    >
      <span>{notice.text}</span>
      <button onClick={onDismiss} aria-label="Dismiss" className="opacity-60 hover:opacity-100">
        ✕
      </button>
    </div>
  );
}
