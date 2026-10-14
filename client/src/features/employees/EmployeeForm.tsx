import { useId, useState, type FormEvent, type InputHTMLAttributes } from 'react';
import { fieldErrors } from '../../lib/api';
import type { User } from '../../lib/types';
import { button, input } from '../../components/ui';
import { useCreateEmployee, useUpdateEmployee, type InviteResult } from './hooks';

type Props = {
  employee?: User; // edit when set, create otherwise
  departments: string[];
  onCancel: () => void;
  onSaved: (result: { name: string; email: string; invite?: InviteResult }) => void;
};

const FIELDS = ['name', 'email', 'phone', 'department', 'title'] as const;
type Field = (typeof FIELDS)[number];

export function EmployeeForm({ employee, departments, onCancel, onSaved }: Props) {
  const id = useId();
  const [values, setValues] = useState({
    name: employee?.name ?? '',
    email: employee?.email ?? '',
    phone: employee?.phone ?? '',
    department: employee?.department ?? '',
    title: employee?.title ?? '',
  });
  const create = useCreateEmployee();
  const update = useUpdateEmployee();
  const mutation = employee ? update : create;
  const errors = fieldErrors(mutation.error, FIELDS);
  const generalError =
    mutation.error && !Object.keys(errors).length ? mutation.error.message : null;

  const set = (field: Field) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [field]: e.target.value }));

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const phone = values.phone.trim();
    if (employee) {
      // Empty phone on edit clears it.
      update.mutate(
        { id: employee.id, ...values, phone: phone || null },
        { onSuccess: (u) => onSaved({ name: u.name, email: u.email }) },
      );
    } else {
      create.mutate(
        { ...values, phone: phone || undefined },
        { onSuccess: (invite) => onSaved({ name: values.name, email: values.email, invite }) },
      );
    }
  };

  const field = (name: Field, label: string, props: InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <input
        name={name}
        value={values[name]}
        onChange={set(name)}
        aria-invalid={!!errors[name]}
        aria-describedby={errors[name] ? `${id}-${name}` : undefined}
        className={input}
        {...props}
      />
      {errors[name] && (
        <span id={`${id}-${name}`} className="mt-1 block text-xs text-red-600">
          {errors[name]}
        </span>
      )}
    </label>
  );

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      {field('name', 'Full name', { required: true, maxLength: 100, autoFocus: true })}
      {field('email', 'Email', { type: 'email', required: true, maxLength: 254 })}
      {field('phone', 'Phone (optional)', { type: 'tel', placeholder: '+1 555 555 0100' })}
      <div className="grid gap-3 sm:grid-cols-2">
        {field('department', 'Department', {
          required: true,
          maxLength: 100,
          list: `${id}-departments`,
        })}
        {field('title', 'Role / title (optional)', { maxLength: 100 })}
      </div>
      <datalist id={`${id}-departments`}>
        {departments.map((d) => (
          <option key={d} value={d} />
        ))}
      </datalist>

      {!employee && (
        <p className="text-xs text-slate-500">
          They'll get an email with a link to set up their username and password.
        </p>
      )}
      {generalError && (
        <p role="alert" className="text-sm text-red-600">
          {generalError}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onCancel} className={button.secondary}>
          Cancel
        </button>
        <button type="submit" disabled={mutation.isPending} className={button.primary}>
          {mutation.isPending ? 'Saving…' : employee ? 'Save changes' : 'Add employee'}
        </button>
      </div>
    </form>
  );
}
