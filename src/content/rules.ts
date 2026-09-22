import type { Facts } from './facts';

/**
 * Validation rules are data (D-015): per event, keyed to a deliverable kind,
 * each with its own plain-language fix. `evaluate` is pure. A fact the
 * extractor could not read is `review`, never `pass` — an honest gap, not a
 * silent approval. `manual` (brand-template fit) is always `review`.
 */
export type RuleCheck = 'max_bytes' | 'file_type' | 'aspect_ratio' | 'fonts_embedded' | 'min_pixels' | 'codec_allowlist' | 'manual';
export type Rule = { id: string; check: RuleCheck; params: unknown; fix: string };
export type RuleStatus = 'pass' | 'fail' | 'review';
export type RuleResult = { ruleId: string; status: RuleStatus; fix?: string };
export type Outcome = 'passed' | 'needs_review' | 'failed';

type P = {
  max_bytes: { max: number };
  file_type: { types: Facts['type'][] };
  /** width / height, with a fractional tolerance (0.01 = ±1%). */
  aspect_ratio: { ratio: number; tolerance: number };
  min_pixels: { width?: number; height?: number };
  codec_allowlist: { codecs: string[] };
};

function check(f: Facts, rule: Rule): RuleStatus | undefined {
  switch (rule.check) {
    case 'max_bytes': return f.byteSize <= (rule.params as P['max_bytes']).max ? 'pass' : 'fail';
    case 'file_type': return (rule.params as P['file_type']).types.includes(f.type) ? 'pass' : 'fail';
    case 'aspect_ratio': {
      const { ratio, tolerance } = rule.params as P['aspect_ratio'];
      if (f.aspect === undefined) return undefined;
      return Math.abs(f.aspect - ratio) <= ratio * tolerance ? 'pass' : 'fail';
    }
    case 'fonts_embedded': return f.fontsEmbedded === undefined ? undefined : f.fontsEmbedded ? 'pass' : 'fail';
    case 'min_pixels': {
      const { width, height } = rule.params as P['min_pixels'];
      if ((width && f.widthPx === undefined) || (height && f.heightPx === undefined)) return undefined;
      return (!width || f.widthPx! >= width) && (!height || f.heightPx! >= height) ? 'pass' : 'fail';
    }
    case 'codec_allowlist': {
      if (!f.codecs?.length) return undefined;
      const allowed = (rule.params as P['codec_allowlist']).codecs;
      return f.codecs.every((c) => allowed.includes(c)) ? 'pass' : 'fail';
    }
    case 'manual': return 'review';
  }
}

export function evaluate(facts: Facts, rules: Rule[]): { outcome: Outcome; results: RuleResult[] } {
  const results = rules.map((rule): RuleResult => {
    const status = check(facts, rule) ?? 'review';
    return status === 'pass' ? { ruleId: rule.id, status } : { ruleId: rule.id, status, fix: rule.fix };
  });
  const outcome = results.some((r) => r.status === 'fail') ? 'failed' : results.some((r) => r.status === 'review') ? 'needs_review' : 'passed';
  return { outcome, results };
}
