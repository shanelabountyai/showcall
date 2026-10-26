/**
 * Headers for serving a stored upload (SEC-08). The MIME type on an upload is
 * whatever the uploader's browser said, so it is never echoed back as given:
 * a type on the list below goes out as the canonical lower-case type, and
 * anything else (text/html, image/svg+xml, a header-injection attempt) goes
 * out as application/octet-stream. Every response is an attachment with
 * nosniff, so nothing renders inline either way.
 */
export const SERVABLE_TYPES: ReadonlySet<string> = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
  'application/vnd.apple.keynote',
  'application/x-iwork-keynote-sffkey',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/zip',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'audio/x-wav',
]);

/** The stored type if it is on the list (parameters such as `; charset=` dropped), else octet-stream. */
export function servedType(stored: string | null | undefined): string {
  const base = (stored ?? '').split(';')[0]!.trim().toLowerCase();
  return SERVABLE_TYPES.has(base) ? base : 'application/octet-stream';
}

/** Always a download, never rendered inline, never sniffed, never cached by a shared cache. */
export function downloadHeaders(filename: string, stored: string | null | undefined): Record<string, string> {
  return {
    'Content-Type': servedType(stored),
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
  };
}
