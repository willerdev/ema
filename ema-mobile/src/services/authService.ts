import { api } from './api';

export interface AuthResponse {
  token: string;
  user: { id: string; email: string };
}

export const authService = {
  login: (email: string, password: string) => api.post<AuthResponse>('/auth/login', { email, password }),
  register: (email: string, password: string) => api.post<AuthResponse>('/auth/register', { email, password }),
  me: () => api.get<{ user: { id: string; email: string } }>('/auth/me'),
  profile: () => api.get<{ profile: { email: string; username: string; accountStatus: string } }>('/profile'),
};
