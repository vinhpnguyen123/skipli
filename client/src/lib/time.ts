// "5 minutes ago", "yesterday", "3 days ago" in the viewer's language.
export const ago = (iso: string) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (mins < 60) return rtf.format(-mins, 'minute');
  if (mins < 60 * 24) return rtf.format(-Math.round(mins / 60), 'hour');
  return rtf.format(-Math.round(mins / (60 * 24)), 'day');
};
