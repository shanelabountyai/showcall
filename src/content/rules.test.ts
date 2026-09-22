import { describe, expect, it } from 'vitest';
import type { Facts } from './facts';
import { evaluate, type Rule } from './rules';

const deck: Facts = { byteSize: 5_000_000, type: 'pdf', aspect: 16 / 9, fontsEmbedded: true };
const rule = (check: Rule['check'], params: unknown = {}, fix = `fix ${check}`): Rule => ({ id: check, check, params, fix });

const status = (facts: Facts, r: Rule) => evaluate(facts, [r]).results[0]!.status;

describe('evaluate', () => {
  it('max_bytes', () => {
    expect(status(deck, rule('max_bytes', { max: 5_000_000 }))).toBe('pass');
    expect(status(deck, rule('max_bytes', { max: 4_999_999 }))).toBe('fail');
  });

  it('file_type', () => {
    expect(status(deck, rule('file_type', { types: ['pdf', 'pptx'] }))).toBe('pass');
    expect(status({ ...deck, type: 'other' }, rule('file_type', { types: ['pdf', 'pptx'] }))).toBe('fail');
  });

  it('aspect_ratio within tolerance', () => {
    const r = rule('aspect_ratio', { ratio: 16 / 9, tolerance: 0.01 });
    expect(status(deck, r)).toBe('pass');
    expect(status({ ...deck, aspect: (16 / 9) * 1.009 }, r)).toBe('pass');
    expect(status({ ...deck, aspect: 4 / 3 }, r)).toBe('fail');
    expect(status({ ...deck, aspect: undefined }, r)).toBe('review');
  });

  it('fonts_embedded', () => {
    expect(status(deck, rule('fonts_embedded'))).toBe('pass');
    expect(status({ ...deck, fontsEmbedded: false }, rule('fonts_embedded'))).toBe('fail');
    expect(status({ byteSize: 1, type: 'pptx' }, rule('fonts_embedded'))).toBe('review');
  });

  it('min_pixels', () => {
    const logo: Facts = { byteSize: 1, type: 'png', widthPx: 1200, heightPx: 400 };
    expect(status(logo, rule('min_pixels', { width: 1000 }))).toBe('pass');
    expect(status({ ...logo, widthPx: 999 }, rule('min_pixels', { width: 1000 }))).toBe('fail');
    expect(status(logo, rule('min_pixels', { width: 1000, height: 500 }))).toBe('fail');
    expect(status({ byteSize: 1, type: 'png' }, rule('min_pixels', { width: 1000 }))).toBe('review');
  });

  it('codec_allowlist', () => {
    const video: Facts = { byteSize: 1, type: 'mp4', codecs: ['avc1'] };
    const r = rule('codec_allowlist', { codecs: ['avc1', 'hvc1'] });
    expect(status(video, r)).toBe('pass');
    expect(status({ ...video, codecs: ['avc1', 'vp09'] }, r)).toBe('fail');
    expect(status({ ...video, codecs: undefined }, r)).toBe('review');
  });

  it('manual is always review', () => {
    expect(status(deck, rule('manual'))).toBe('review');
  });

  it('outcome: any fail → failed; else any review → needs_review; else passed', () => {
    expect(evaluate(deck, []).outcome).toBe('passed');
    expect(evaluate(deck, [rule('fonts_embedded')]).outcome).toBe('passed');
    expect(evaluate(deck, [rule('fonts_embedded'), rule('manual')]).outcome).toBe('needs_review');
    expect(evaluate({ ...deck, fontsEmbedded: false }, [rule('fonts_embedded'), rule('manual')]).outcome).toBe('failed');
  });

  it('fix text passes through on fail and review, not on pass', () => {
    const { results } = evaluate({ ...deck, fontsEmbedded: false }, [rule('fonts_embedded', {}, 'Export with fonts embedded'), rule('manual', {}, 'Use the brand template'), rule('max_bytes', { max: 1e9 })]);
    expect(results).toEqual([
      { ruleId: 'fonts_embedded', status: 'fail', fix: 'Export with fonts embedded' },
      { ruleId: 'manual', status: 'review', fix: 'Use the brand template' },
      { ruleId: 'max_bytes', status: 'pass' },
    ]);
  });
});
