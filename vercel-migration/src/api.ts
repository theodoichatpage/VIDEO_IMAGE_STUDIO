type ApiResponse<T> = { data: T };

async function request<T>(method: string, url: string, body?: unknown): Promise<ApiResponse<T>> {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(String(data.error || 'Không thể kết nối máy chủ.'));
    (error as Error & { response?: { data: unknown } }).response = { data };
    throw error;
  }
  return { data: data as T };
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body),
};

