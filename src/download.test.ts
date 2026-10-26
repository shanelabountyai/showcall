import { describe, expect, it } from 'vitest';
import { downloadHeaders, servedType } from './download';

describe('servedType (SEC-08)', () => {
  it('passes the listed types through, canonicalised', () => {
    expect(servedType('application/pdf')).toBe('application/pdf');
    expect(servedType('Video/MP4')).toBe('video/mp4');
    expect(servedType('image/png; charset=binary')).toBe('image/png');
    expect(servedType('application/vnd.openxmlformats-officedocument.presentationml.presentation'))
      .toBe('application/vnd.openxmlformats-officedocument.presentationml.presentation');
  });

  it('serves anything a browser would render or run as octet-stream', () => {
    for (const t of ['text/html', 'image/svg+xml', 'application/xhtml+xml', 'text/javascript', 'application/x-shockwave-flash', 'text/plain']) {
      expect(servedType(t)).toBe('application/octet-stream');
    }
  });

  it('serves a missing or malformed type as octet-stream', () => {
    expect(servedType('')).toBe('application/octet-stream');
    expect(servedType(null)).toBe('application/octet-stream');
    expect(servedType(undefined)).toBe('application/octet-stream');
    expect(servedType('application/pdf\r\nSet-Cookie: x=1')).toBe('application/octet-stream');
    expect(servedType('video/')).toBe('application/octet-stream');
  });
});

describe('downloadHeaders', () => {
  it('is always an attachment with nosniff and no shared caching, and the headers are valid', () => {
    const h = downloadHeaders('Keynote "final" v7.pdf', 'text/html');
    expect(h).toEqual({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': "attachment; filename*=UTF-8''Keynote%20%22final%22%20v7.pdf",
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });
    expect(() => new Headers(h)).not.toThrow();
  });

  it('cannot be split by a filename carrying CR/LF', () => {
    const h = downloadHeaders('deck.pdf\r\nSet-Cookie: x=1', 'application/pdf');
    expect(h['Content-Disposition']).not.toMatch(/[\r\n]/);
    expect(() => new Headers(h)).not.toThrow();
  });
});
