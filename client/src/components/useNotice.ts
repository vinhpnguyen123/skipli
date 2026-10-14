import { useEffect, useState } from 'react';

export type Notice = { tone: 'ok' | 'warn' | 'error'; text: string };

// Page-level message state, shown with <NoticeBanner>. Notices fade after a few seconds; errors stay until
// dismissed.
export function useNotice() {
  const [notice, setNotice] = useState<Notice | null>(null);
  useEffect(() => {
    if (!notice || notice.tone === 'error') return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);
  return [notice, setNotice] as const;
}
