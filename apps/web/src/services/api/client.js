import axios from 'axios';

/** Normalised API error used across the app (forms map `details` onto fields). */
export class ApiError extends Error {
  constructor({ status, code, message, details, requestId }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details ?? [];
    this.requestId = requestId;
  }
}

export function toApiError(error) {
  if (error instanceof ApiError) return error;
  const res = error?.response;
  if (res?.data?.error) {
    return new ApiError({ status: res.status, ...res.data.error });
  }
  if (res) {
    return new ApiError({ status: res.status, code: 'INTERNAL', message: 'Something went wrong. Please try again.' });
  }
  return new ApiError({ status: 0, code: 'NETWORK', message: 'Cannot reach the server. Check your connection.' });
}

const baseURL = import.meta.env.VITE_API_URL || '/api/v1';

/**
 * Central HTTP client. Unwraps the `{ success, data, meta }` envelope so callers receive
 * `{ data, meta }`. Access tokens (Phase 2) are attached from memory, never localStorage.
 */
export const http = axios.create({ baseURL, withCredentials: true, timeout: 20000 });

let accessTokenGetter = () => null;
export function setAccessTokenGetter(fn) {
  accessTokenGetter = fn;
}

http.interceptors.request.use((config) => {
  const token = accessTokenGetter();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

http.interceptors.response.use(
  (response) => {
    const body = response.data;
    if (body && typeof body === 'object' && 'success' in body) {
      return { data: body.data, meta: body.meta, status: response.status };
    }
    return { data: body, meta: undefined, status: response.status };
  },
  (error) => Promise.reject(toApiError(error)),
);
