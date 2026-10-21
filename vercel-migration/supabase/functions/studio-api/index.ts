import handler from './handler.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
};

Deno.serve(async (request) => {
  const url = new URL(request.url);
  const path = (url.searchParams.get('path') || '').split('/').filter(Boolean);
  let body: unknown = {};
  if (request.method !== 'GET' && request.method !== 'OPTIONS') {
    body = await request.json().catch(() => ({}));
  }
  const result: { status: number; payload: unknown } = {
    status: 200,
    payload: { error: 'Máy chủ chưa phản hồi.' },
  };
  const response = {
    setHeader: () => undefined,
    status: (code: number) => ({ json: (value: unknown) => { result.status = code; result.payload = value; } }),
  };
  await handler({ method: request.method, query: { path }, body, headers: {} }, response);
  return new Response(JSON.stringify(result.payload), { status: result.status, headers: cors });
});
