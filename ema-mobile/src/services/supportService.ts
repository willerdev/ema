import { api } from './api';

export type SupportCategory = 'withdraw' | 'deposit' | 'daily_earning' | 'transfer' | 'general';

export type SupportTicket = {
  id: string;
  category: SupportCategory;
  status: string;
  payload: Record<string, unknown>;
  relatedActivityId: string | null;
  createdAt: string;
  updatedAt: string;
};

export const supportService = {
  listTickets: () => api.get<{ tickets: SupportTicket[] }>('/support/tickets'),
  getTicket: (id: string) => api.get<{ ticket: SupportTicket }>(`/support/tickets/${id}`),
  createTicket: (body: {
    category: SupportCategory;
    payload: Record<string, unknown>;
    relatedActivityId?: string;
  }) =>
    api.post<{ ticket: SupportTicket; message: string }>('/support/tickets', {
      category: body.category,
      payload: body.payload,
      relatedActivityId: body.relatedActivityId,
    }),
};
