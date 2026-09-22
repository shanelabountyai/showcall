import { PDFArray, PDFDict, PDFDocument, PDFName, type PDFObject } from 'pdf-lib';

/**
 * What a file actually is, read from its bytes — never from the uploader's
 * filename or mime type (D-015). Every parse is defensive: a fact that could
 * not be read stays undefined (the rule then says "needs review"), and a
 * hostile file never throws out of here.
 */
export type Facts = {
  byteSize: number;
  type: 'pdf' | 'png' | 'jpeg' | 'mp4' | 'pptx' | 'other';
  /** width / height of the first page or frame. */
  aspect?: number;
  widthPx?: number;
  heightPx?: number;
  fontsEmbedded?: boolean;
  unembeddedFonts?: string[];
  /** Video sample-entry fourccs, video tracks only (`avc1`, `hvc1`, …). */
  codecs?: string[];
};

const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));
const u16 = (b: Uint8Array, at: number) => (b[at]! << 8) | b[at + 1]!;
const u32 = (b: Uint8Array, at: number) => ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0;

function sniff(b: Uint8Array, filename: string): Facts['type'] {
  if (ascii(b, 0, 5) === '%PDF-') return 'pdf';
  if (ascii(b, 0, 8) === '\x89PNG\r\n\x1a\n') return 'png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpeg';
  if (ascii(b, 4, 4) === 'ftyp') return 'mp4';
  if (ascii(b, 0, 4) === 'PK\x03\x04' && /\.pptx$/i.test(filename)) return 'pptx';
  return 'other';
}

export async function extractFacts(bytes: Uint8Array, filename: string): Promise<Facts> {
  const facts: Facts = { byteSize: bytes.length, type: sniff(bytes, filename) };
  try {
    if (facts.type === 'pdf') Object.assign(facts, await pdfFacts(bytes));
    if (facts.type === 'png' && ascii(bytes, 12, 4) === 'IHDR') px(facts, u32(bytes, 16), u32(bytes, 20));
    if (facts.type === 'jpeg') jpegFacts(bytes, facts);
    if (facts.type === 'mp4') {
      const codecs = mp4Codecs(bytes);
      if (codecs.length) facts.codecs = codecs;
    }
  } catch {
    // A hostile or truncated file: whatever was read before the failure stands.
  }
  return facts;
}

function px(f: Facts, w: number, h: number) {
  if (w > 0 && h > 0) Object.assign(f, { widthPx: w, heightPx: h, aspect: w / h });
}

async function pdfFacts(bytes: Uint8Array): Promise<Partial<Facts>> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const pages = doc.getPages();
  const out: Partial<Facts> = {};
  const first = pages[0];
  if (first) {
    const { width, height } = first.getMediaBox();
    const turned = first.getRotation().angle % 180 !== 0;
    if (width > 0 && height > 0) out.aspect = turned ? height / width : width / height;
  }
  const dict = (o: PDFObject | undefined) => { const v = o && doc.context.lookup(o); return v instanceof PDFDict ? v : undefined; };
  const hasFontFile = (d: PDFDict | undefined) => !!d && ['FontFile', 'FontFile2', 'FontFile3'].some((k) => d.has(PDFName.of(k)));
  const unembedded = new Set<string>();
  // ponytail: page-level Resources only; fonts used only inside form XObjects are not seen. Walk XObject Resources if a real deck slips through.
  for (const page of pages) {
    const fonts = dict(page.node.Resources()?.get(PDFName.of('Font')));
    for (const [, ref] of fonts?.entries() ?? []) {
      const font = dict(ref);
      if (!font) continue;
      const subtype = font.get(PDFName.of('Subtype'))?.toString();
      if (subtype === '/Type3') continue; // glyphs are drawn in the file itself
      let descriptor = dict(font.get(PDFName.of('FontDescriptor')));
      if (subtype === '/Type0') {
        const descendants = doc.context.lookup(font.get(PDFName.of('DescendantFonts')));
        const descendant = descendants instanceof PDFArray ? dict(descendants.get(0)) : undefined;
        descriptor = dict(descendant?.get(PDFName.of('FontDescriptor')));
      }
      if (!hasFontFile(descriptor)) unembedded.add(font.get(PDFName.of('BaseFont'))?.toString().replace(/^\//, '') ?? 'unnamed font');
    }
  }
  out.fontsEmbedded = unembedded.size === 0;
  if (unembedded.size) out.unembeddedFonts = [...unembedded];
  return out;
}

/** Walks marker segments to the first baseline/extended/progressive start-of-frame. */
function jpegFacts(b: Uint8Array, f: Facts) {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return;
    const marker = b[i + 1]!;
    if (marker === 0xff) { i++; continue; }
    if (marker >= 0xd0 && marker <= 0xd9) { i += 2; continue; }
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) return px(f, u16(b, i + 7), u16(b, i + 5));
    i += 2 + u16(b, i + 2);
  }
}

type Box = { type: string; start: number; end: number };

function* boxes(b: Uint8Array, start: number, end: number): Generator<Box> {
  let i = start;
  while (i + 8 <= end) {
    let size = u32(b, i);
    let header = 8;
    if (size === 1) { size = u32(b, i + 8) * 2 ** 32 + u32(b, i + 12); header = 16; }
    if (size === 0) size = end - i;
    if (size < header || i + size > end) return;
    yield { type: ascii(b, i + 4, 4), start: i + header, end: i + size };
    i += size;
  }
}

const child = (b: Uint8Array, box: Box | undefined, type: string) => box && [...boxes(b, box.start, box.end)].find((c) => c.type === type);

/** moov/trak/mdia/minf/stbl/stsd sample entries, for tracks whose handler is `vide`. */
function mp4Codecs(b: Uint8Array): string[] {
  const moov = [...boxes(b, 0, b.length)].find((x) => x.type === 'moov');
  if (!moov) return [];
  const codecs = new Set<string>();
  for (const trak of boxes(b, moov.start, moov.end)) {
    if (trak.type !== 'trak') continue;
    const mdia = child(b, trak, 'mdia');
    const hdlr = child(b, mdia, 'hdlr');
    if (!hdlr || ascii(b, hdlr.start + 8, 4) !== 'vide') continue;
    const stsd = child(b, child(b, child(b, mdia, 'minf'), 'stbl'), 'stsd');
    if (!stsd) continue;
    // Full box: version/flags (4) + entry_count (4), then one box per entry.
    for (const entry of boxes(b, stsd.start + 8, stsd.end)) codecs.add(entry.type);
  }
  return [...codecs];
}
