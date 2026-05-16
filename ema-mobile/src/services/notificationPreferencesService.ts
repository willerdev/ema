import { NotificationPreferences, NotificationPreferencesResponse } from '../types';
import { api } from './api';

export const notificationPreferencesService = {
  get: () => api.get<NotificationPreferencesResponse>('/notification-preferences'),
  save: (payload: {
    premiumAlertsEnabled?: boolean;
    notifySms?: boolean;
    notifyEmail?: boolean;
    acceptPremiumTerms?: boolean;
  }) => api.put<NotificationPreferencesResponse>('/notification-preferences', payload),
};

export type { NotificationPreferences };
