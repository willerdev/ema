import { api } from './api';

export type AppAnnouncement = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
};

export const announcementService = {
  getActive: () => api.get<{ announcement: AppAnnouncement | null }>('/announcement/active'),
};
