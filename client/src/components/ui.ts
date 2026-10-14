// Shared Tailwind class strings, so forms and buttons look the same everywhere.
export const input =
  'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 aria-invalid:border-red-400';
// Compact select for toolbars (filters, sorting): sized to its content, unlike the full-width form input.
export const toolbarSelect =
  'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100';
export const button = {
  primary:
    'rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60',
  secondary:
    'rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60',
  danger:
    'rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60',
  link: 'text-sm font-medium text-blue-600 hover:underline disabled:text-slate-400 disabled:no-underline',
};
