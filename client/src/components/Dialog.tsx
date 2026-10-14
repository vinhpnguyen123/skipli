import { useEffect, useRef, type ReactNode } from 'react';

// Native <dialog>: focus trap, Escape to close, and a real backdrop for free. Children mount only while open,
// so forms start fresh each time.
export function Dialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  // Tracks the `open` prop so the native close event can tell a user close (Escape, backdrop) from one the
  // parent caused. Otherwise closing this dialog to open another would call onClose and clear the new one.
  const wantOpen = useRef(open);

  useEffect(() => {
    wantOpen.current = open;
    const dialog = ref.current;
    if (open && !dialog?.open) dialog?.showModal();
    if (!open && dialog?.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={() => wantOpen.current && onClose()}
      // A click on the dialog element itself (not its content) is a click on the backdrop.
      onClick={(e) => e.target === ref.current && onClose()}
      aria-labelledby="dialog-title"
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl p-0 shadow-xl backdrop:bg-slate-900/40"
    >
      {open && (
        <div className="p-6">
          <h2 id="dialog-title" className="text-lg font-semibold text-slate-900">
            {title}
          </h2>
          <div className="mt-4">{children}</div>
        </div>
      )}
    </dialog>
  );
}
