import type { Session, Job } from './types';
type ApiData = { session: Session | null; command?: Job | null; ignored?: boolean; discarded?: boolean; queuedCount?: number; alreadyQueuedCount?: number };
type ApiResponse<T> = { data: T };
const apiBase = 'https://wtxgjsorpqjanxoevxuw.supabase.co/functions/v1/studio-api';

async function request<T>(method: string, url: string, body?: unknown, signal?: AbortSignal): Promise<ApiResponse<T>> {
  const route = url.replace(/^\/api\//, '');
  const response = await fetch(apiBase + '?path=' + encodeURIComponent(route), {
    method, signal,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    const error = new Error(String(data.error || 'Không thể kết nối máy chủ.'));
    (error as Error & { response?: { data: unknown } }).response = { data };
    throw error;
  }
  return { data: data as T };
}

export const api = {
  get: <T = ApiData>(url: string) => request<T>('GET', url),
  post: <T = ApiData>(url: string, body?: unknown, signal?: AbortSignal) => request<T>('POST', url, body, signal),
};

