import { authStorage } from './storage';
import { Platform } from 'react-native';
import Constants from 'expo-constants';

function resolveDefaultBaseUrl() {
  // In Expo dev sessions on a physical device, derive host from Metro host URI.
  const hostUri =
    Constants.expoConfig?.hostUri ||
    (Constants as any).manifest2?.extra?.expoGo?.debuggerHost ||
    '';
  const lanHost = String(hostUri).split(':')[0];
  if (lanHost) return `http://${lanHost}:4000`;

  return Platform.OS === 'android' ? 'http://10.0.2.2:4000' : 'http://localhost:4000';
}

const BASE_URL = (process.env.EXPO_PUBLIC_API_URL ?? resolveDefaultBaseUrl()).replace(/\/+$/, '');

async function fetchWithAuth(path: string, options: RequestInit, token: string | null) {
  return fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await authStorage.getToken();
  let response: Response;
  try {
    response = await fetchWithAuth(path, options, token);
  } catch (error: any) {
    // Render free instances may need a wake-up request on first hit.
    try {
      await fetch(`${BASE_URL}/health`);
      response = await fetchWithAuth(path, options, token);
    } catch {
      throw new Error(`Network request failed. API base URL: ${BASE_URL}`);
    }
  }

  const contentType = response.headers.get('content-type') || '';
  const raw = await response.text();
  let data: any = null;
  if (raw) {
    if (contentType.includes('application/json')) {
      data = JSON.parse(raw);
    } else {
      try {
        data = JSON.parse(raw);
      } catch {
        data = { message: raw };
      }
    }
  }

  if (!response.ok) {
    const fallback = `Request failed (${response.status})`;
    const htmlError = raw.trim().startsWith('<');
    const message =
      (htmlError ? `Server returned HTML (${response.status}). Check backend route/server state.` : '') ||
      data?.message ||
      (typeof data === 'string' ? data : '') ||
      fallback;
    throw new Error(message);
  }

  return (data ?? {}) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown, headers?: Record<string, string>) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body), headers }),
};
