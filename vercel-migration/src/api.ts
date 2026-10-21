type ApiResponse<T> = { data: T };
const apiBase = 'https://wtxgjsorpqjanxoevxuw.supabase.co/functions/v1/studio-api';

type BridgeSession = {
  id?: string;
  activeJob?: { id?: string; type?: string; status?: string; prompt?: string } | null;
};

function dispatchImageJob(route: string, payload: unknown) {
  if (!/^sessions\/[^/]+\/images$/.test(route)) return;
  const data = payload as { session?: BridgeSession };
  const session = data?.session;
  if (!session?.id || session.activeJob?.type !== 'image_generation') return;
  if (!['queued', 'sending'].includes(String(session.activeJob.status || ''))) return;
  window.postMessage({
    source: 'vis-web',
    type: 'studio-send',
    pairCode: session.id,
    command: session.activeJob,
  }, '*');
}

async function request<T>(method: string, url: string, body?: unknown): Promise<ApiResponse<T>> {
  const route = url.replace(/^\/api\//, '');
  const response = await fetch(apiBase + '?path=' + encodeURIComponent(route), {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    const error = new Error(String(data.error || 'Không thể kết nối máy chủ.'));
    (error as Error & { response?: { data: unknown } }).response = { data };
    throw error;
  }
  if (method === 'POST') dispatchImageJob(route, data);
  return { data: data as T };
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body),
};
