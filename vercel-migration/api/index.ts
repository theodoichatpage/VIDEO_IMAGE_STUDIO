import handler from '../supabase/functions/studio-api/handler';

export default function apiIndex(req: any, res: any) {
  const path = req.query?.path || new URL(req.url || '/', 'https://video-image-studio.local').searchParams.get('path') || '';
  req.query = { ...req.query, path: (Array.isArray(path) ? path : [path]).flatMap(item => item.split('/')).filter(Boolean) };
  return handler(req, res);
}
