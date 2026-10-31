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
  const worker = url.searchParams.get('worker') || undefined;
  await handler({ method: request.method, query: { path, worker }, body, headers: {} }, response);
  // reply=minimal (the extension delivering results): drop the whole project from the reply, keep ok/error fields.
  if (url.searchParams.get('reply') === 'minimal' && result.payload && typeof result.payload === 'object' && 'session' in (result.payload as Record<string, unknown>)) {
    const { session: _session, ...rest } = result.payload as Record<string, unknown>; result.payload = { ...rest, ok: true };
  }
  const text = JSON.stringify(result.payload);
  // Compress larger replies (projects are JSON, typically 5-10x smaller gzipped) to cut egress.
  if (text.length > 1024 && /gzip/i.test(request.headers.get('accept-encoding') || '')) {
    const zipped = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Response(zipped, { status: result.status, headers: { ...cors, 'Content-Encoding': 'gzip', 'Vary': 'Accept-Encoding' } });
  }
  return new Response(text, { status: result.status, headers: cors });
});
