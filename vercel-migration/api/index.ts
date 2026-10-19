import handler from './handler';

export default function apiIndex(req: any, res: any) {
  if (!req.query.path) {
    const path = new URL(req.url || '/', 'https://video-image-studio.local').searchParams.get('path') || '';
    req.query.path = path.split('/').filter(Boolean);
  }
  return handler(req, res);
}
