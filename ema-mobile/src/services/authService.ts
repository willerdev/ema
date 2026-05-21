import { api } from './api';

export interface AuthUser {
  id: string;
  email: string;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}

export type LoginResult =
  | { kind: 'session'; token: string; user: AuthUser }
  | { kind: 'needs_totp'; preAuthToken: string };

export interface TotpStatus {
  enabled: boolean;
  setupPending: boolean;
}

export const authService = {
  register: (email: string, password: string) => api.post<AuthResponse>('/auth/register', { email, password }),

  login: async (email: string, password: string): Promise<LoginResult> => {
    const data = await api.post<AuthResponse | { requiresTotp?: boolean; preAuthToken?: string }>('/auth/login', {
      email,
      password,
    });
    if (data && typeof data === 'object' && 'requiresTotp' in data && data.requiresTotp && data.preAuthToken) {
      return { kind: 'needs_totp', preAuthToken: data.preAuthToken };
    }
    const session = data as AuthResponse;
    return { kind: 'session', token: session.token, user: session.user };
  },

  verifyTotp: (code: string, preAuthToken: string) =>
    api.post<AuthResponse>('/auth/totp/verify', { code }, { Authorization: `Bearer ${preAuthToken}` }),

  me: () => api.get<{ user: AuthUser }>('/auth/me'),

  profile: () => api.get<{ profile: { email: string; username: string; accountStatus: string } }>('/profile'),

  getTotpStatus: () => api.get<TotpStatus>('/auth/totp/status'),

  startTotpSetup: () => api.post<{ otpauthUrl: string; secretBase32: string }>('/auth/totp/setup/start', {}),

  confirmTotpSetup: (code: string) => api.post<{ success: boolean }>('/auth/totp/setup/confirm', { code }),

  cancelTotpSetup: () => api.post<{ success: boolean }>('/auth/totp/setup/cancel', {}),

  disableTotp: (password: string, code: string) =>
    api.post<{ success: boolean }>('/auth/totp/disable', { password, code }),

  verifyRecoverPassword: (body: { email: string; phone: string }) =>
    api.post<{ verified: boolean; message: string }>('/auth/recover-password/verify', body),

  recoverPassword: (body: { email: string; phone: string; password: string }) =>
    api.post<{ message: string }>('/auth/recover-password', body),
};
