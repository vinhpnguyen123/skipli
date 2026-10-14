import { useMutation, useQuery } from '@tanstack/react-query';
import { api, patch, post } from '../../lib/api';
import { queryClient } from '../../lib/query';
import type { User } from '../../lib/types';

export type EmployeeInput = {
  name: string;
  email: string;
  department: string;
  phone?: string | null;
  title?: string;
};

// inviteSent: false when the email failed; setupUrl only in demo mode.
export type InviteResult = { inviteSent: boolean; setupUrl?: string };

const KEY = ['employees'];
const refresh = () => queryClient.invalidateQueries({ queryKey: KEY });

export function useEmployees() {
  return useQuery({
    queryKey: KEY,
    queryFn: async () => (await api<{ employees: User[] }>('/employees')).employees,
  });
}

export function useCreateEmployee() {
  return useMutation({
    mutationFn: (input: EmployeeInput) =>
      post<InviteResult & { employeeId: string }>('/CreateEmployee', input),
    onSuccess: refresh,
  });
}

export function useUpdateEmployee() {
  return useMutation({
    mutationFn: ({ id, ...input }: EmployeeInput & { id: string }) =>
      patch<User>(`/employees/${id}`, input),
    onSuccess: refresh,
  });
}

export function useDeleteEmployee() {
  return useMutation({
    mutationFn: (employeeId: string) => post('/DeleteEmployee', { employeeId }),
    onSuccess: refresh,
  });
}

export function useResendInvite() {
  return useMutation({
    mutationFn: (employeeId: string) =>
      post<InviteResult>('/employee/resend-invite', { employeeId }),
  });
}
