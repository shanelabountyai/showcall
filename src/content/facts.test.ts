import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { extractFacts } from './facts';

const enc = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const box = (type: string, ...parts: Uint8Array[]) => {
  const body = parts.flatMap((p) => [...p]);
  return Uint8Array.from([...be32(8 + body.length), ...enc(type), ...body]);
};

describe('extractFacts', () => {
  it('PDF: first-page aspect, and a Standard font is not embedded — and is named', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([1920, 1080]);
    page.drawText('Hello', { font: await doc.embedFont(StandardFonts.Helvetica) });
    const facts = await extractFacts(await doc.save(), 'deck.pdf');
    expect(facts).toMatchObject({ type: 'pdf', fontsEmbedded: false, unembeddedFonts: ['Helvetica'] });
    expect(facts.aspect).toBeCloseTo(16 / 9);
  });

  it('PDF: a font whose descriptor carries FontFile2 is embedded', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([1024, 768]);
    const descriptor = doc.context.register(doc.context.obj({ Type: 'FontDescriptor', FontFile2: doc.context.register(doc.context.stream('glyphs')) }));
    const font = doc.context.register(doc.context.obj({ Type: 'Font', Subtype: 'TrueType', BaseFont: 'BrandSans', FontDescriptor: descriptor }));
    page.node.setFontDictionary(PDFName.of('F1'), font);
    const facts = await extractFacts(await doc.save(), 'deck.pdf');
    expect(facts).toMatchObject({ type: 'pdf', fontsEmbedded: true });
    expect(facts.unembeddedFonts).toBeUndefined();
    expect(facts.aspect).toBeCloseTo(4 / 3);
  });

  it('PNG: IHDR dimensions', async () => {
    const png = Uint8Array.from([0x89, ...enc('PNG\r\n\x1a\n'), ...be32(13), ...enc('IHDR'), ...be32(1200), ...be32(400), 8, 6, 0, 0, 0]);
    expect(await extractFacts(png, 'logo.png')).toMatchObject({ type: 'png', widthPx: 1200, heightPx: 400, aspect: 3 });
  });

  it('JPEG: skips APP0 to the SOF0 dimensions', async () => {
    const app0 = [0xff, 0xe0, 0, 16, ...enc('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0];
    const sof0 = [0xff, 0xc0, 0, 11, 8, 0x04, 0x38 /* h 1080 */, 0x07, 0x80 /* w 1920 */, 1, 1, 0x11, 0];
    const jpeg = Uint8Array.from([0xff, 0xd8, ...app0, ...sof0, 0xff, 0xd9]);
    expect(await extractFacts(jpeg, 'x.jpg')).toMatchObject({ type: 'jpeg', widthPx: 1920, heightPx: 1080 });
  });

  it('MP4: video sample entries from the vide track only', async () => {
    const hdlr = (h: string) => box('hdlr', new Uint8Array(8), enc(h), new Uint8Array(12));
    const stsd = (...entries: string[]) => box('stsd', new Uint8Array(4), Uint8Array.from(be32(entries.length)), ...entries.map((e) => box(e, new Uint8Array(20))));
    const trak = (h: string, codec: string) => box('trak', box('mdia', hdlr(h), box('minf', box('stbl', stsd(codec)))));
    const mp4 = Uint8Array.from([...box('ftyp', enc('isom')), ...box('moov', trak('vide', 'avc1'), trak('soun', 'mp4a'))]);
    expect(await extractFacts(mp4, 'v.mp4')).toMatchObject({ type: 'mp4', codecs: ['avc1'] });
  });

  it('garbage, truncated and lying files: typed by bytes, no throw', async () => {
    expect(await extractFacts(new Uint8Array([1, 2, 3]), 'deck.pdf')).toEqual({ byteSize: 3, type: 'other' });
    expect(await extractFacts(enc('%PDF-1.7 truncated'), 'deck.pdf')).toEqual({ byteSize: 18, type: 'pdf' });
    expect(await extractFacts(Uint8Array.from([...be32(0xffffff), ...enc('ftyp')]), 'v.mp4')).toEqual({ byteSize: 8, type: 'mp4' });
    expect(await extractFacts(enc('PK\x03\x04rest'), 'slides.pptx')).toEqual({ byteSize: 8, type: 'pptx' });
    expect(await extractFacts(enc('PK\x03\x04rest'), 'archive.zip')).toMatchObject({ type: 'other' });
  });
});
