import { authStorage } from './storage';
import { sanitizeUserFacingError } from '../utils/userFacingError';
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

const configuredBaseUrl = (process.env.EXPO_PUBLIC_API_URL ?? resolveDefaultBaseUrl()).replace(/\/+$/, '');
const fallbackBaseUrls = ['https://ema-0gp3.onrender.com'];
const BASE_URL_CANDIDATES = Array.from(
  new Set([configuredBaseUrl, ...fallbackBaseUrls].map((u) => u.replace(/\/+$/, '')))
);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithAuth(baseUrl: string, path: string, options: RequestInit, token: string | null) {
  return fetch(`${baseUrl}${path}`, {
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
  let response: Response | null = null;
  let chosenBaseUrl: string | null = null;
  let lastNetworkError: unknown = null;

  for (const baseUrl of BASE_URL_CANDIDATES) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        response = await fetchWithAuth(baseUrl, path, options, token);
        chosenBaseUrl = baseUrl;
        break;
      } catch (error) {
        lastNetworkError = error;
        // Render instances may be cold; poke health and back off.
        try {
          await fetch(`${baseUrl}/health`);
        } catch {
          // ignore and retry with backoff
        }
        await sleep(700 * (attempt + 1));
      }
    }
    if (response) break;
  }

  if (!chosenBaseUrl) {
    chosenBaseUrl = BASE_URL_CANDIDATES[0];
  }

  if (!response) {
    throw new Error(sanitizeUserFacingError('Network request failed'));
  }

  // If fallback base URL worked, keep using it first in future requests.
  if (chosenBaseUrl && BASE_URL_CANDIDATES[0] !== chosenBaseUrl) {
    const idx = BASE_URL_CANDIDATES.indexOf(chosenBaseUrl);
    if (idx > 0) {
      BASE_URL_CANDIDATES.splice(idx, 1);
      BASE_URL_CANDIDATES.unshift(chosenBaseUrl);
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
    const fallback = 'Request failed. Please try again.';
    const rawMessage = data?.message || (typeof data === 'string' ? data : '') || fallback;
    const message = sanitizeUserFacingError(String(rawMessage), fallback);
    const err = new Error(message) as Error & { status?: number; code?: string };
    err.status = response.status;
    if (data?.code) err.code = String(data.code);
    throw err;
  }

  return (data ?? {}) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown, headers?: Record<string, string>) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body), headers }),
  put: <T>(path: string, body: unknown, headers?: Record<string, string>) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body), headers }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
