import { useStatusOf } from './presence';

// Green when online; hover (or a screen reader) gives "Last seen …".
export function PresenceDot({ userId }: { userId: string }) {
  const { online, label } = useStatusOf(userId);
  return (
    <span
      title={label}
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${online ? 'bg-emerald-500' : 'bg-slate-300'}`}
    >
      <span className="sr-only">{label}</span>
    </span>
  );
}
