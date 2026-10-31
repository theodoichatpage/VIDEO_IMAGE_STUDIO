import type { ImageResult } from './types';
// Pages show the small preview (thumbUrl); the full picture is opened only on request. With `local`, the full
// picture lives on the PC that made it (AI MANAGER keeps it), so it is opened from there, not from Studio's server.
export const previewUrl = (image?: ImageResult | null) => image?.thumbUrl || image?.url || '';
export const originalUrl = (sessionId: string, image?: ImageResult | null) =>
  image?.local && image.jobId ? 'http://127.0.0.1:8765/api/studio-image?sessionId=' + encodeURIComponent(sessionId) + '&jobId=' + encodeURIComponent(image.jobId) : image?.url || '';
