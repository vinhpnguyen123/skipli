import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api } from '../../lib/api';
import { queryClient } from '../../lib/query';
import { socket } from '../../lib/socket';
import type { Schedule, Shift } from '../../lib/types';

const KEY = ['schedules'];

// The owner gets everyone's; an employee only their own.
export function useSchedules() {
  return useQuery({
    queryKey: KEY,
    queryFn: async () => (await api<{ schedules: Schedule[] }>('/schedules')).schedules,
  });
}

const put = (s: Schedule) =>
  queryClient.setQueryData<Schedule[]>(
    KEY,
    (all) => all && [...all.filter((x) => x.employeeId !== s.employeeId), s],
  );

// Edits (from any tab or the owner) arrive over the socket; a reconnect reloads.
export function useScheduleEvents() {
  useEffect(() => {
    const reload = () => queryClient.invalidateQueries({ queryKey: KEY });
    socket.on('schedule:updated', put).on('connect', reload);
    return () => {
      socket.off('schedule:updated', put).off('connect', reload);
    };
  }, []);
}

// Saves an employee's whole week; the server splits overnight shifts and rejects overlaps.
export function useSaveSchedule() {
  return useMutation({
    mutationFn: ({ employeeId, shifts }: { employeeId: string; shifts: Shift[] }) =>
      api<Schedule>(`/employees/${employeeId}/schedule`, {
        method: 'PUT',
        body: JSON.stringify({ shifts }),
      }),
    onSuccess: put,
  });
}
