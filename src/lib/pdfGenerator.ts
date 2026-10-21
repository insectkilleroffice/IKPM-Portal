// Professional PDF documents for IKPM: proposals / quotations, tax invoices, payment receipts,
// field service reports (with photos & sign-off) and site inspection reports.
// Every document shares one letterhead: logo, legal name, address, NTN/STRN, contacts,
// a title band with reference details, client & site cards, ruled tables, totals with the
// amount in words, signature blocks and a footer on every page.

import jsPDF from 'jspdf';
import QRCode from 'qrcode';
import { autoTable, type UserOptions } from 'jspdf-autotable';
import type { Proposal } from '../types/proposal';
import type { ServiceJob, SitePhoto } from '../types/operations';
import type { Invoice, PaymentReceipt, TaxJurisdiction } from '../types/finance';
import type { Lead } from '../types/crm';
import { formatDate } from './formatters';
import { companyProfile, DEFAULT_ACCENT_COLOR, DEFAULT_BRAND_COLOR, type CompanyProfile } from '../services/companyProfile';
import { dataService } from '../services/dataService';
import { planPricing } from './proposalPlan';
import { fillSop } from './sopTemplate';
import { fillTemplate } from './templateFill';
import { documentTemplates } from '../services/documentTemplates';
import type { SopInput } from '../types/document';

// ---------------------------------------------------------------------------
// Palette & layout (mm, A4 portrait)
// ---------------------------------------------------------------------------
// The primary and accent colours come from the company profile (Settings → Company)
type RGB = [number, number, number];
const INK: RGB = [31, 41, 55];
const MUTED: RGB = [107, 114, 128];
const RULE: RGB = [227, 232, 239];
const TINT: RGB = [246, 248, 251];

const hexToRgb = (hex: string | undefined, fallback: string): RGB => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex?.trim() || '') ?? /^#?([0-9a-f]{6})$/i.exec(fallback)!;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const lighten = (c: RGB, amount: number): RGB => c.map((v) => Math.round(v + (255 - v) * amount)) as RGB;

const PAGE_W = 210;
const PAGE_H = 297;
const M = 14; // side margin
const CONTENT_W = PAGE_W - M * 2;
const FOOTER_H = 18;

const money = (n: number | undefined) =>
  (n ?? 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pkr = (n: number | undefined) => `PKR ${money(n)}`;

const JURISDICTION: Record<TaxJurisdiction, string> = {
  sindh_srb: 'Sindh Revenue Board (SRB)',
  punjab_pra: 'Punjab Revenue Authority (PRA)',
  islamabad_ict: 'Islamabad Capital Territory (ICT)',
  kpk_kpra: 'Khyber Pakhtunkhwa Revenue Authority (KPRA)',
  balochistan_bra: 'Balochistan Revenue Authority (BRA)',
};

// ---------------------------------------------------------------------------
// Amount in words (Pakistani style: thousand, lakh, crore)
// ---------------------------------------------------------------------------
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function belowThousand(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const parts: string[] = [];
  if (h) parts.push(`${ONES[h]} Hundred`);
  if (r) parts.push(r < 20 ? ONES[r] : `${TENS[Math.floor(r / 10)]}${r % 10 ? ` ${ONES[r % 10]}` : ''}`);
  return parts.join(' ');
}

export function amountInWords(amount: number): string {
  const rupees = Math.floor(Math.abs(amount));
  const paisa = Math.round((Math.abs(amount) - rupees) * 100);
  if (rupees === 0 && paisa === 0) return 'Rupees Zero Only';
  let n = rupees;
  const parts: string[] = [];
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  if (crore) parts.push(`${belowThousand(crore)} Crore`);
  if (lakh) parts.push(`${belowThousand(lakh)} Lakh`);
  if (thousand) parts.push(`${belowThousand(thousand)} Thousand`);
  if (n) parts.push(belowThousand(n));
  return `Rupees ${parts.join(' ') || 'Zero'}${paisa ? ` and ${belowThousand(paisa)} Paisa` : ''} Only`;
}

// ---------------------------------------------------------------------------
// Images (logo, photos, signatures) → data URLs jsPDF can embed
// ---------------------------------------------------------------------------
interface Img { data: string; w: number; h: number }

const imageCache = new Map<string, Promise<Img | null>>();

function rasterize(src: string, maxPx: number, format: 'image/png' | 'image/jpeg'): Promise<Img | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const ratio = Math.min(1, maxPx / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
        const w = Math.max(1, Math.round((img.naturalWidth || maxPx) * ratio));
        const h = Math.max(1, Math.round((img.naturalHeight || maxPx) * ratio));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d')!;
        if (format === 'image/jpeg') {
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, w, h);
        }
        ctx.drawImage(img, 0, 0, w, h);
        resolve({ data: canvas.toDataURL(format, 0.82), w, h });
      } catch {
        resolve(null); // tainted canvas (no CORS) or decode error
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** Smaller Cloudinary rendition for embedding (keeps PDFs light). */
const cloudinaryThumb = (url: string, w: number) =>
  /res\.cloudinary\.com\/.+\/image\/upload\//.test(url) ? url.replace('/image/upload/', `/image/upload/c_limit,w_${w},q_auto,f_jpg/`) : url;

function loadImage(url: string, maxPx = 900, format: 'image/png' | 'image/jpeg' = 'image/jpeg') {
  const key = `${url}|${maxPx}|${format}`;
  if (!imageCache.has(key)) imageCache.set(key, rasterize(format === 'image/jpeg' ? cloudinaryThumb(url, maxPx) : url, maxPx, format));
  return imageCache.get(key)!;
}

const loadLogo = (p: CompanyProfile) => loadImage(p.logoUrl || '/ik_logo.svg', 700, 'image/png');

// ---------------------------------------------------------------------------
// Document builder
// ---------------------------------------------------------------------------
interface Party {
  heading: string;
  name: string;
  lines: (string | undefined | false)[];
}

interface MetaRow {
  label: string;
  value: string;
}

class DocBuilder {
  doc: jsPDF;
  y = 0;
  private profile: CompanyProfile;
  private logo: Img | null;
  private title: string;
  private ref: string;
  private watermark?: string;
  private qr: Img | null;
  navy: RGB;
  brand: RGB;
  brandTint: RGB;

  constructor(opts: { profile: CompanyProfile; logo: Img | null; title: string; ref: string; watermark?: string; qr?: Img | null }) {
    this.doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
    this.profile = opts.profile;
    this.logo = opts.logo;
    this.title = opts.title;
    this.ref = opts.ref;
    this.watermark = opts.watermark;
    this.qr = opts.qr ?? null;
    this.navy = hexToRgb(opts.profile.brandColor, DEFAULT_BRAND_COLOR);
    this.brand = hexToRgb(opts.profile.accentColor, DEFAULT_ACCENT_COLOR);
    this.brandTint = lighten(this.brand, 0.92);
    this.doc.setProperties({ title: `${opts.title} ${opts.ref}`, author: opts.profile.legalName, creator: `${opts.profile.shortName || opts.profile.legalName} documents` });
    this.doc.setLineHeightFactor(1.35);
  }

  private color(c: RGB, kind: 'text' | 'fill' | 'draw' = 'text') {
    if (kind === 'text') this.doc.setTextColor(c[0], c[1], c[2]);
    else if (kind === 'fill') this.doc.setFillColor(c[0], c[1], c[2]);
    else this.doc.setDrawColor(c[0], c[1], c[2]);
  }

  font(size: number, style: 'normal' | 'bold' | 'italic' = 'normal', c: RGB = INK) {
    this.doc.setFont('helvetica', style);
    this.doc.setFontSize(size);
    this.color(c);
  }

  /** Letterhead: logo left, company identity right, brand rule under it. */
  letterhead() {
    const p = this.profile;
    const top = 12;
    let logoW = 0;
    if (this.logo) {
      const h = 17;
      logoW = Math.min(52, (this.logo.w / this.logo.h) * h);
      this.doc.addImage(this.logo.data, 'PNG', M, top, logoW, (logoW / this.logo.w) * this.logo.h, undefined, 'FAST');
    }

    const right = PAGE_W - M;
    this.font(13, 'bold', this.navy);
    this.doc.text(p.legalName, right, top + 4, { align: 'right' });
    this.font(7.5, 'normal', this.brand);
    this.doc.text(p.tagline.toUpperCase(), right, top + 8.5, { align: 'right' });
    this.font(7.5, 'normal', MUTED);
    const contact = [p.address, p.city].filter(Boolean).join(', ');
    const lines = [
      contact,
      [p.phone && `Tel: ${p.phone}`, p.mobile && `Mob: ${p.mobile}`, p.email].filter(Boolean).join('   ·   '),
      [p.website, p.ntn && `NTN: ${p.ntn}`, p.strn && `STRN: ${p.strn}`].filter(Boolean).join('   ·   '),
      [p.provincialTaxNo, p.pcoLicense && `PCO Licence: ${p.pcoLicense}`].filter(Boolean).join('   ·   '),
    ].filter(Boolean);
    lines.forEach((l, i) => this.doc.text(l, right, top + 13 + i * 3.6, { align: 'right', maxWidth: CONTENT_W - logoW - 6 }));

    const ruleY = Math.max(top + 21, top + 13 + lines.length * 3.6);
    this.color(this.brand, 'fill');
    this.doc.rect(M, ruleY, CONTENT_W * 0.28, 0.9, 'F');
    this.color(this.navy, 'fill');
    this.doc.rect(M + CONTENT_W * 0.28, ruleY, CONTENT_W * 0.72, 0.9, 'F');
    this.y = ruleY + 7;
  }

  /** Large document title with a reference box on the right. */
  titleBand(meta: MetaRow[], subtitle?: string) {
    const startY = this.y;
    this.font(19, 'bold', this.navy);
    this.doc.text(this.title.toUpperCase(), M, startY + 6, { charSpace: 0.4 });
    this.color(this.brand, 'fill');
    this.doc.rect(M, startY + 8.4, 16, 0.9, 'F');
    if (subtitle) {
      this.font(8.5, 'normal', MUTED);
      this.doc.text(subtitle, M, startY + 13, { maxWidth: 100 });
    }

    const boxW = 74;
    const x = PAGE_W - M - boxW;
    const rowH = 5.6;
    const h = meta.length * rowH + 3;
    this.color(TINT, 'fill');
    this.color(RULE, 'draw');
    this.doc.roundedRect(x, startY - 1, boxW, h, 1.5, 1.5, 'FD');
    meta.forEach((m, i) => {
      const yy = startY + 3.4 + i * rowH;
      this.font(7.5, 'normal', MUTED);
      this.doc.text(m.label, x + 3.5, yy);
      this.font(8.5, 'bold', INK);
      this.doc.text(m.value, x + boxW - 3.5, yy, { align: 'right', maxWidth: boxW - 30 });
    });
    this.y = Math.max(startY + (subtitle ? 18 : 13), startY + h + 3);
  }

  /** Two side-by-side cards (e.g. Bill To / Service Site). */
  parties(left: Party, right?: Party) {
    const gap = 6;
    const w = right ? (CONTENT_W - gap) / 2 : CONTENT_W;
    const measure = (p: Party) => {
      this.doc.setFontSize(8.3);
      const lines = p.lines.filter(Boolean).flatMap((l) => this.doc.splitTextToSize(String(l), w - 8) as string[]);
      return { lines, h: 13 + lines.length * 3.9 };
    };
    const L = measure(left);
    const R = right ? measure(right) : { lines: [], h: 0 };
    const h = Math.max(L.h, R.h);
    this.ensure(h + 4);

    const card = (p: Party, lines: string[], x: number) => {
      this.color(RULE, 'draw');
      this.color([255, 255, 255], 'fill');
      this.doc.roundedRect(x, this.y, w, h, 1.5, 1.5, 'FD');
      this.color(this.brand, 'fill');
      this.doc.rect(x, this.y + 2, 0.9, h - 4, 'F');
      this.font(7, 'bold', this.brand);
      this.doc.text(p.heading.toUpperCase(), x + 4.5, this.y + 5, { charSpace: 0.3 });
      this.font(10, 'bold', this.navy);
      this.doc.text(p.name, x + 4.5, this.y + 10, { maxWidth: w - 8 });
      this.font(8.3, 'normal', INK);
      lines.forEach((l, i) => this.doc.text(l, x + 4.5, this.y + 14.5 + i * 3.9));
    };
    card(left, L.lines, M);
    if (right) card(right, R.lines, M + w + gap);
    this.y += h + 6;
  }

  /** Section heading; `keepWith` reserves room so a heading never sits alone at a page bottom. */
  section(title: string, keepWith = 18) {
    this.y += 2;
    this.ensure(8 + keepWith);
    this.font(9, 'bold', this.navy);
    this.doc.text(title.toUpperCase(), M, this.y, { charSpace: 0.3 });
    this.color(RULE, 'draw');
    this.doc.setLineWidth(0.3);
    this.doc.line(M, this.y + 1.8, PAGE_W - M, this.y + 1.8);
    this.y += 6;
  }

  paragraph(text: string, size = 8.6, c: RGB = INK) {
    if (!text) return;
    this.font(size, 'normal', c);
    const lines = this.doc.splitTextToSize(text, CONTENT_W) as string[];
    lines.forEach((l) => {
      this.ensure(5);
      this.doc.text(l, M, this.y);
      this.y += size * 0.47;
    });
    this.y += 2;
  }

  /** Numbered list (terms & conditions). */
  numbered(items: string[], size = 8) {
    items.filter((t) => t.trim()).forEach((t, i) => {
      this.font(size, 'normal', INK);
      const lines = this.doc.splitTextToSize(t.trim(), CONTENT_W - 7) as string[];
      this.ensure(lines.length * 4 + 1);
      this.font(size, 'bold', this.brand);
      this.doc.text(`${i + 1}.`, M, this.y);
      this.font(size, 'normal', INK);
      lines.forEach((l, j) => this.doc.text(l, M + 6, this.y + j * 3.8));
      this.y += lines.length * 3.8 + 1.2;
    });
    this.y += 2;
  }

  /** Lettered list: (a), (b), (c)… */
  lettered(items: string[], size = 8) {
    items.filter((t) => t.trim()).forEach((t, i) => {
      this.font(size, 'normal', INK);
      const lines = this.doc.splitTextToSize(t.trim(), CONTENT_W - 8) as string[];
      this.ensure(lines.length * 4 + 1);
      this.font(size, 'bold', this.brand);
      this.doc.text(`(${String.fromCharCode(97 + (i % 26))})`, M, this.y);
      this.font(size, 'normal', INK);
      lines.forEach((l, j) => this.doc.text(l, M + 7, this.y + j * 3.8));
      this.y += lines.length * 3.8 + 1.2;
    });
    this.y += 2;
  }

  /** Small bold heading inside a section (e.g. "A. Rodent control"). */
  subheading(text: string) {
    this.ensure(10);
    this.font(8.8, 'bold', this.navy);
    this.doc.text(text, M, this.y);
    this.y += 4.6;
  }

  /** Label / value grid, two columns. */
  keyValues(rows: [string, string | undefined][], cols = 2) {
    const items = rows.filter(([, v]) => v);
    const colW = CONTENT_W / cols;
    const rowH = 9;
    for (let i = 0; i < items.length; i += cols) {
      this.ensure(rowH + 1);
      items.slice(i, i + cols).forEach(([k, v], j) => {
        const x = M + j * colW;
        this.font(7, 'normal', MUTED);
        this.doc.text(k.toUpperCase(), x, this.y, { charSpace: 0.2 });
        this.font(8.6, 'bold', INK);
        this.doc.text(String(v), x, this.y + 4, { maxWidth: colW - 4 });
      });
      this.y += rowH;
    }
    this.y += 1;
  }

  table(head: string[], body: (string | number)[][], opts: Partial<UserOptions> = {}) {
    autoTable(this.doc, {
      startY: this.y,
      head: [head],
      body: body.map((r) => r.map((c) => (typeof c === 'number' ? String(c) : c))),
      margin: { left: M, right: M, top: 20, bottom: FOOTER_H + 6 },
      theme: 'grid',
      styles: { font: 'helvetica', fontSize: 8.2, cellPadding: { top: 2.2, bottom: 2.2, left: 2.5, right: 2.5 }, textColor: INK, lineColor: RULE, lineWidth: 0.2, valign: 'middle' },
      headStyles: { fillColor: this.navy, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.8, lineColor: this.navy },
      alternateRowStyles: { fillColor: TINT },
      ...opts,
    });
    this.y = ((this.doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? this.y) + 6;
  }

  /** Right-aligned totals box with the amount in words on the left. */
  totals(rows: [string, string][], grand: [string, number], words = true) {
    const boxW = 82;
    const x = PAGE_W - M - boxW;
    const rowH = 5.8;
    const h = rows.length * rowH + 11;
    this.ensure(h + 4);
    const top = this.y;
    rows.forEach(([k, v], i) => {
      const yy = top + 4 + i * rowH;
      this.font(8.4, 'normal', MUTED);
      this.doc.text(k, x + 3, yy);
      this.font(8.6, 'normal', INK);
      this.doc.text(v, PAGE_W - M - 3, yy, { align: 'right' });
    });
    const gy = top + rows.length * rowH + 1.5;
    this.color(this.navy, 'fill');
    this.doc.roundedRect(x, gy, boxW, 8.5, 1.2, 1.2, 'F');
    this.font(9.2, 'bold', [255, 255, 255]);
    this.doc.text(grand[0], x + 3, gy + 5.6);
    this.doc.text(pkr(grand[1]), PAGE_W - M - 3, gy + 5.6, { align: 'right' });

    if (words) {
      const ww = CONTENT_W - boxW - 8;
      this.color(this.brandTint, 'fill');
      this.doc.roundedRect(M, top + 1, ww, h - 2, 1.2, 1.2, 'F');
      this.font(7, 'bold', this.brand);
      this.doc.text('AMOUNT IN WORDS', M + 3.5, top + 6, { charSpace: 0.3 });
      this.font(8.6, 'bold', this.navy);
      this.doc.text(this.doc.splitTextToSize(amountInWords(grand[1]), ww - 7) as string[], M + 3.5, top + 11);
    }
    this.y = top + h + 6;
  }

  /** Bordered note box (bank details, important notes). */
  noteBox(heading: string, lines: string[], tint: RGB = TINT) {
    const clean = lines.filter(Boolean);
    if (!clean.length) return;
    this.font(8.2, 'normal', INK);
    const wrapped = clean.flatMap((l) => this.doc.splitTextToSize(l, CONTENT_W - 8) as string[]);
    const h = 8 + wrapped.length * 3.9;
    this.ensure(h + 3);
    this.color(tint, 'fill');
    this.color(RULE, 'draw');
    this.doc.roundedRect(M, this.y, CONTENT_W, h, 1.5, 1.5, 'FD');
    this.font(7, 'bold', this.brand);
    this.doc.text(heading.toUpperCase(), M + 4, this.y + 4.8, { charSpace: 0.3 });
    this.font(8.2, 'normal', INK);
    wrapped.forEach((l, i) => this.doc.text(l, M + 4, this.y + 9 + i * 3.9));
    this.y += h + 5;
  }

  /** Signature blocks; an image (e.g. customer signature) can sit above a line. */
  signatures(blocks: { label: string; name?: string; sub?: string; image?: Img | null }[]) {
    const h = 30;
    this.ensure(h + 4);
    const gap = 10;
    const w = (CONTENT_W - gap * (blocks.length - 1)) / blocks.length;
    blocks.forEach((b, i) => {
      const x = M + i * (w + gap);
      const lineY = this.y + 18;
      if (b.image) {
        const ih = 14;
        const iw = Math.min(w - 4, (b.image.w / b.image.h) * ih);
        this.doc.addImage(b.image.data, 'PNG', x, lineY - ih - 1, iw, ih, undefined, 'FAST');
      }
      this.color([148, 163, 184], 'draw');
      this.doc.setLineWidth(0.3);
      this.doc.line(x, lineY, x + w, lineY);
      this.font(7.2, 'bold', MUTED);
      this.doc.text(b.label.toUpperCase(), x, lineY + 4, { charSpace: 0.2 });
      if (b.name) {
        this.font(8.6, 'bold', INK);
        this.doc.text(b.name, x, lineY + 8.5, { maxWidth: w });
      }
      if (b.sub) {
        this.font(7.5, 'normal', MUTED);
        this.doc.text(b.sub, x, lineY + 12, { maxWidth: w });
      }
    });
    this.y += h + 4;
  }

  /** Photo grid (two per row) with captions. */
  photos(items: { img: Img; caption: string }[]) {
    const gap = 6;
    const w = (CONTENT_W - gap) / 2;
    const h = 62;
    for (let i = 0; i < items.length; i += 2) {
      this.ensure(h + 10);
      items.slice(i, i + 2).forEach((p, j) => {
        const x = M + j * (w + gap);
        this.color(RULE, 'draw');
        this.color(TINT, 'fill');
        this.doc.roundedRect(x, this.y, w, h, 1.5, 1.5, 'FD');
        const scale = Math.min((w - 4) / p.img.w, (h - 4) / p.img.h);
        const iw = p.img.w * scale;
        const ih = p.img.h * scale;
        this.doc.addImage(p.img.data, 'JPEG', x + (w - iw) / 2, this.y + (h - ih) / 2, iw, ih, undefined, 'FAST');
        this.font(7.6, 'normal', MUTED);
        this.doc.text(p.caption, x, this.y + h + 4, { maxWidth: w });
      });
      this.y += h + 9;
    }
  }

  /** Floor plan image with numbered pins (x / y are 0–1 of the image). */
  floorPlan(img: Img, pins: { x: number; y: number; label: string }[]) {
    const maxH = PAGE_H - FOOTER_H - 30;
    const scale = Math.min(CONTENT_W / img.w, maxH / img.h);
    const w = img.w * scale;
    const h = img.h * scale;
    this.ensure(h + 4);
    const x0 = M + (CONTENT_W - w) / 2;
    const y0 = this.y;
    this.doc.addImage(img.data, 'JPEG', x0, y0, w, h, undefined, 'FAST');
    this.color(RULE, 'draw');
    this.doc.rect(x0, y0, w, h, 'S');
    pins.forEach((p) => {
      const cx = x0 + p.x * w;
      const cy = y0 + p.y * h;
      this.color(this.brand, 'fill');
      this.doc.circle(cx, cy, 2.6, 'F');
      this.font(5.6, 'bold', [255, 255, 255]);
      this.doc.text(p.label, cx, cy + 0.9, { align: 'center' });
    });
    this.y += h + 6;
  }

  ensure(space: number) {
    if (this.y + space > PAGE_H - FOOTER_H - 6) {
      this.doc.addPage();
      this.y = 20;
    }
  }

  /** Footer + continuation header + watermark on every page, then returns the document. */
  finish(): jsPDF {
    const p = this.profile;
    const pages = this.doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      this.doc.setPage(i);
      if (this.watermark) {
        this.doc.saveGraphicsState();
        // @ts-expect-error GState exists at runtime on jsPDF
        this.doc.setGState(new this.doc.GState({ opacity: 0.07 }));
        this.font(88, 'bold', this.navy);
        this.doc.text(this.watermark, PAGE_W / 2, PAGE_H / 2 + 20, { align: 'center', angle: 35 });
        this.doc.restoreGraphicsState();
      }
      if (i > 1) {
        this.font(7.5, 'bold', this.navy);
        this.doc.text(`${p.legalName}`, M, 11);
        this.font(7.5, 'normal', MUTED);
        this.doc.text(`${this.title} ${this.ref} (continued)`, PAGE_W - M, 11, { align: 'right' });
        this.color(RULE, 'draw');
        this.doc.line(M, 13, PAGE_W - M, 13);
      }
      const fy = PAGE_H - FOOTER_H + 4;
      this.color(RULE, 'draw');
      this.doc.setLineWidth(0.3);
      this.doc.line(M, fy, PAGE_W - M, fy);
      this.font(7, 'bold', this.navy);
      this.doc.text(p.legalName, M, fy + 4.5);
      this.font(6.8, 'normal', MUTED);
      this.doc.text([p.phone, p.email, p.website].filter(Boolean).join('  ·  '), M, fy + 8.3);
      this.doc.text(`This is a computer-generated document issued by ${p.shortName || p.legalName}.`, M, fy + 11.8);
      if (this.qr) {
        const size = 12;
        const qx = PAGE_W - M - 50 - size;
        this.doc.addImage(this.qr.data, 'PNG', qx, fy + 1.2, size, size, 'verify-qr', 'FAST');
        this.font(6, 'bold', this.navy);
        this.doc.text('Scan to', qx - 1.5, fy + 6, { align: 'right' });
        this.doc.text('verify', qx - 1.5, fy + 8.8, { align: 'right' });
      }
      this.font(7, 'normal', MUTED);
      this.doc.text(`${this.title} ${this.ref}`, PAGE_W - M, fy + 4.5, { align: 'right' });
      this.doc.text(`Page ${i} of ${pages}`, PAGE_W - M, fy + 8.3, { align: 'right' });
      this.doc.text(`Generated ${formatDate(new Date().toISOString())}`, PAGE_W - M, fy + 11.8, { align: 'right' });
    }
    return this.doc;
  }
}

// ---------------------------------------------------------------------------
// Verification: each document gets a QR linking to a public page that confirms
// it was issued by the company (doc_verifications/{id}, readable by id only)
// ---------------------------------------------------------------------------
export type VerifiableDoc = 'proposal' | 'invoice' | 'receipt' | 'service_report' | 'inspection_report';

interface VerifyInput {
  type: VerifiableDoc;
  /** Date printed on the document. */
  issued: string;
  client: string;
  /** Individuals' names are shortened on the public page (e.g. "Ayesha K."). */
  clientIsPerson?: boolean;
  amount?: number;
  status: string;
}

const safe = (s: string) => s.replace(/[^\w.-]+/g, '_');

/** Short stable hash so ids can't be guessed from the document number alone. */
const fingerprint = (s: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
};

const shortPersonName = (name: string) => {
  const [first, ...rest] = name.trim().split(/\s+/);
  return [first, ...rest.map((w) => `${w[0]}.`)].join(' ');
};

async function verificationQr(profile: CompanyProfile, title: string, ref: string, v: VerifyInput): Promise<Img | null> {
  const id = `${v.type}_${safe(ref)}_${fingerprint(`${ref}|${v.issued}|${v.amount ?? ''}|${v.client}`)}`;
  try {
    dataService.recordVerification(id, {
      type: v.type,
      title,
      ref,
      issuedAt: v.issued,
      client: v.clientIsPerson ? shortPersonName(v.client) : v.client,
      amount: v.amount,
      status: v.status,
      company: profile.legalName,
      generatedAt: new Date().toISOString(),
    });
    const size = 240;
    const data = await QRCode.toDataURL(`${window.location.origin}/verify/${id}`, { margin: 0, width: size, errorCorrectionLevel: 'M' });
    return { data, w: size, h: size };
  } catch {
    return null; // a missing QR never blocks the document
  }
}

async function builder(title: string, ref: string, watermark?: string, override?: CompanyProfile, verify?: VerifyInput) {
  const profile = override ?? companyProfile.get();
  const [logo, qr] = await Promise.all([loadLogo(profile), verify && !override ? verificationQr(profile, title, ref, verify) : null]);
  const b = new DocBuilder({ profile, logo, title, ref, watermark, qr });
  b.letterhead();
  return { b, profile };
}

// ---------------------------------------------------------------------------
// Client details lookup (company / branch / individual)
// ---------------------------------------------------------------------------
function clientParty(customerType: string, customerId: string, fallbackName: string, branchId?: string, heading = 'Client'): Party {
  if (customerType === 'company') {
    const co = dataService.getCompanyById(customerId);
    const br = branchId ? dataService.getBranchById(branchId) : undefined;
    const c = co?.primaryContact;
    return {
      heading,
      name: co?.legalCompanyName || fallbackName,
      lines: [
        br ? `Branch: ${br.branchName}` : false,
        br?.physicalAddress || co?.headOfficeAddress,
        [br?.city || co?.city, co?.province?.replace('_', ' ')].filter(Boolean).join(', '),
        c && `Attn: ${c.fullName}${c.designation ? ` (${c.designation})` : ''}`,
        [c?.mobile || c?.phone, c?.email].filter(Boolean).join('  ·  '),
        [co?.ntn && `NTN: ${co.ntn}`, co?.strn && `STRN: ${co.strn}`].filter(Boolean).join('  ·  '),
      ],
    };
  }
  const cl = dataService.getClientById(customerId);
  return {
    heading,
    name: cl?.fullName || fallbackName,
    // Same slot order as companies: [branch, address, city, attn, phone/email, tax numbers]
    lines: [
      false,
      cl?.residentialAddress,
      [cl?.area, cl?.city].filter(Boolean).join(', '),
      false,
      [cl?.primaryPhone, cl?.email].filter(Boolean).join('  ·  '),
      cl?.cnic && `CNIC: ${cl.cnic}`,
    ],
  };
}

const statusLabel = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
/** Monthly IPM service plan proposal: cover letter, scope A/B/C, terms (a)–(h), service plan, charges & tenure. */
async function buildPlanProposal(proposal: Proposal): Promise<jsPDF> {
  const watermark = ['draft', 'pending_approval'].includes(proposal.status) ? 'DRAFT' : proposal.status === 'rejected' ? 'REJECTED' : undefined;
  const ref = `${proposal.id}${proposal.revisionNumber ? `-R${proposal.revisionNumber}` : ''}`;
  const { b, profile } = await builder('Quotation', ref, watermark, undefined, {
    type: 'proposal', issued: proposal.createdAt, client: proposal.customerName, clientIsPerson: proposal.customerType !== 'company', amount: proposal.totalAmount, status: proposal.status,
  });
  const company = profile.shortName || profile.legalName;
  const pricing = planPricing({
    monthlyRate: proposal.monthlyRate ?? 0,
    taxMode: proposal.taxMode ?? 'exclusive',
    taxPercent: proposal.taxPercent,
    tenureMonths: proposal.tenureMonths ?? 12,
    discountPercent: proposal.discountPercent,
  });
  const validUntil = new Date(new Date(proposal.createdAt).getTime() + (proposal.validityDays || 30) * 86400000).toISOString();
  const fill = (t: string) =>
    fillTemplate(t, {
      clientName: proposal.customerName,
      companyName: company,
      siteName: proposal.branchName,
      monthlyRate: money(proposal.monthlyRate),
      tenureMonths: proposal.tenureMonths,
      tenureStart: proposal.tenureStart ? formatDate(proposal.tenureStart) : undefined,
      tenureEnd: proposal.tenureEnd ? formatDate(proposal.tenureEnd) : undefined,
      paymentTermsDays: proposal.paymentTermsDays ?? 15,
    });

  // The date is always the day the proposal was created
  b.titleBand(
    [
      { label: 'Ref. No.', value: ref },
      { label: 'Date', value: formatDate(proposal.createdAt) },
      { label: 'Valid until', value: formatDate(validUntil) },
    ],
    'Integrated Pest Management services'
  );

  // Cover letter
  const party = clientParty(proposal.customerType, proposal.customerId, proposal.customerName, proposal.branchId, 'To');
  const att = proposal.attentionTo;
  b.font(8.8, 'normal', INK);
  const toLines = [
    att?.name ? `Attn: ${att.name}${att.designation ? `, ${att.designation}` : ''}` : '',
    party.name,
    proposal.branchName ? `${proposal.branchName}` : '',
    proposal.clientAddress || (party.lines[1] as string) || '',
  ].filter(Boolean);
  b.ensure(toLines.length * 4.4 + 16);
  b.doc.text('To,', M, b.y);
  b.y += 4.6;
  toLines.forEach((l, i) => {
    b.font(8.8, i === 1 ? 'bold' : 'normal', INK);
    b.doc.text(l, M, b.y, { maxWidth: CONTENT_W });
    b.y += 4.4;
  });
  b.y += 2;
  b.font(9, 'bold', b.navy);
  b.doc.text('Subject: Proposal for Integrated Pest Management (IPM) Services', M, b.y);
  b.y += 6;
  b.paragraph(att?.name ? `Dear ${att.name},` : 'Dear Sir / Madam,');
  b.paragraph(fill(proposal.coverLetter || proposal.scopeOfWork));

  if (proposal.scopeSections?.length) {
    b.section('Scope of services');
    proposal.scopeSections.forEach((sec) => {
      b.subheading(`${sec.key}. ${fill(sec.title)}`);
      b.paragraph(fill(sec.body));
    });
  }

  if (proposal.terms?.length) {
    b.section('Terms');
    b.lettered(proposal.terms.map(fill));
  }

  b.section('Monthly IPM service plan', 34);
  b.table(
    ['#', 'Service', 'Frequency'],
    (proposal.servicePlan ?? []).map((row, i) => [i + 1, row.service, row.frequency]),
    { columnStyles: { 0: { cellWidth: 9, halign: 'center' }, 1: { fontStyle: 'bold' }, 2: { cellWidth: 52 } } }
  );
  const pco = proposal.pcoCountMin || proposal.pcoCountMax
    ? proposal.pcoCountMin && proposal.pcoCountMax && proposal.pcoCountMin !== proposal.pcoCountMax
      ? `${proposal.pcoCountMin} to ${proposal.pcoCountMax}`
      : String(proposal.pcoCountMax || proposal.pcoCountMin)
    : undefined;
  b.keyValues([
    ['Service visits per month', proposal.serviceVisitsPerMonth ? String(proposal.serviceVisitsPerMonth) : undefined],
    ['Follow-up visits per month', proposal.followUpVisitsPerMonth ? String(proposal.followUpVisitsPerMonth) : undefined],
    ['PCOs per visit', pco],
  ], 3);
  if (proposal.documentationIncluded?.length) b.noteBox('Documentation included', proposal.documentationIncluded.map((d) => `•  ${d}`));

  b.section('Charges & tenure', 40);
  const taxLabel = proposal.taxPercent > 0 ? `Sales tax (${proposal.taxPercent}%)` : 'Sales tax';
  const months = proposal.tenureMonths ?? 12;
  b.table(
    ['Description', 'Amount (PKR)'],
    [
      [`Monthly charges${proposal.taxMode === 'inclusive' ? ' (excluding tax)' : ''}`, money(pricing.monthlyBase)],
      [`${taxLabel} per month`, money(pricing.monthlyTax)],
      ['Monthly charges including tax', money(pricing.monthlyTotal)],
      [`Tenure`, `${months} month${months === 1 ? '' : 's'}${proposal.tenureStart ? `: ${formatDate(proposal.tenureStart)} to ${formatDate(proposal.tenureEnd)}` : ''}`],
    ],
    { columnStyles: { 0: { fontStyle: 'bold' }, 1: { halign: 'right', cellWidth: 70 } } }
  );
  const rows: [string, string][] = [[`Charges for ${months} month${months === 1 ? '' : 's'}`, pkr(pricing.subtotal)]];
  if (proposal.discountPercent > 0) rows.push([`Discount (${proposal.discountPercent}%)`, `- ${pkr(pricing.discountAmount)}`]);
  if (pricing.taxAmount > 0) rows.push([taxLabel, pkr(pricing.taxAmount)]);
  b.totals(rows, ['Total for tenure', pricing.totalAmount]);
  const snap = (proposal.templateSnapshot ?? {}) as { taxWording?: string; paymentTerms?: string };
  const current = documentTemplates.get();
  b.paragraph(fillTemplate(snap.taxWording ?? current.taxWording, { taxMode: proposal.taxMode === 'inclusive' ? 'inclusive' : 'exclusive' }), 8, MUTED);

  b.section('Payment terms');
  b.paragraph(`${fill(snap.paymentTerms ?? current.paymentTerms)}${proposal.paymentTerms ? ` ${proposal.paymentTerms}` : ''}`);

  const notes = [proposal.exclusions && `Exclusions: ${proposal.exclusions}`, proposal.deviceOwnership && `Devices: ${proposal.deviceOwnership}`].filter(Boolean) as string[];
  if (notes.length) b.noteBox('Please note', notes, b.brandTint);

  b.paragraph(`We look forward to serving you. For any questions please contact ${proposal.preparedByName}${profile.phone ? ` at ${profile.phone}` : ''}.`);
  b.signatures([
    { label: `For ${company}`, name: profile.signatoryName || proposal.preparedByName, sub: profile.signatoryTitle },
    { label: 'Accepted by client', name: att?.name || ' ', sub: att?.designation ? `${att.designation} · signature, stamp & date` : 'Name, signature, stamp & date' },
  ]);
  return b.finish();
}

async function buildProposal(proposal: Proposal): Promise<jsPDF> {
  if (proposal.servicePlan?.length) return buildPlanProposal(proposal);
  const watermark = ['draft', 'pending_approval'].includes(proposal.status) ? 'DRAFT' : proposal.status === 'rejected' ? 'REJECTED' : undefined;
  const ref = `${proposal.id}${proposal.revisionNumber ? `-R${proposal.revisionNumber}` : ''}`;
  const { b, profile } = await builder('Proposal & Quotation', ref, watermark, undefined, {
    type: 'proposal', issued: proposal.createdAt, client: proposal.customerName, clientIsPerson: proposal.customerType !== 'company', amount: proposal.totalAmount, status: proposal.status,
  });
  const validUntil = new Date(new Date(proposal.createdAt).getTime() + (proposal.validityDays || 30) * 86400000).toISOString();

  b.titleBand(
    [
      { label: 'Proposal No.', value: ref },
      { label: 'Date', value: formatDate(proposal.createdAt) },
      { label: 'Valid until', value: formatDate(validUntil) },
      { label: 'Prepared by', value: proposal.preparedByName },
    ],
    'Integrated Pest Management service proposal'
  );

  b.parties(
    clientParty(proposal.customerType, proposal.customerId, proposal.customerName, proposal.branchId, 'Prepared for'),
    {
      heading: 'Service site',
      name: proposal.branchName || 'Main premises',
      lines: [proposal.siteAddress, proposal.warrantyPeriodMonths ? `Warranty: ${proposal.warrantyPeriodMonths} months` : false, `Payment terms: ${proposal.paymentTerms}`],
    }
  );

  b.section('Scope of work');
  b.paragraph(proposal.scopeOfWork);

  b.section('Services & pricing', 30);
  b.table(
    ['#', 'Service', 'Treatment method & materials', 'Frequency', 'Qty', 'Rate (PKR)', 'Amount (PKR)'],
    proposal.lineItems.map((li, i) => [
      i + 1,
      li.serviceName,
      [li.treatmentMethod, li.chemicalsSuggested].filter(Boolean).join('\n'),
      li.frequency || '',
      li.quantity,
      money(li.unitPrice),
      money(li.totalPrice),
    ]),
    {
      columnStyles: {
        0: { cellWidth: 8, halign: 'center' },
        1: { cellWidth: 40, fontStyle: 'bold' },
        2: { cellWidth: 56 },
        3: { cellWidth: 22 },
        4: { cellWidth: 11, halign: 'center' },
        5: { cellWidth: 22, halign: 'right' },
        6: { halign: 'right' },
      },
    }
  );

  const rows: [string, string][] = [['Subtotal', pkr(proposal.subtotal)]];
  if (proposal.discountPercent > 0) rows.push([`Discount (${proposal.discountPercent}%)`, `- ${pkr(proposal.discountAmount)}`]);
  if (proposal.taxPercent > 0) rows.push([`Sales tax (${proposal.taxPercent}%)`, pkr(proposal.taxAmount)]);
  b.totals(rows, ['Total payable', proposal.totalAmount]);

  b.section('Terms & conditions');
  b.numbered([
    `Payment terms: ${proposal.paymentTerms}.`,
    `This proposal is valid for ${proposal.validityDays || 30} days from the date above.`,
    proposal.warrantyPeriodMonths ? `Warranty: ${proposal.warrantyPeriodMonths} months. Free re-treatment if the targeted pests recur within the warranty period, subject to agreed hygiene recommendations.` : '',
    ...(profile.proposalTerms || '').split('\n'),
  ]);

  b.signatures([
    { label: `For ${profile.shortName || profile.legalName}`, name: profile.signatoryName || proposal.preparedByName, sub: profile.signatoryTitle },
    { label: 'Accepted by client', name: ' ', sub: 'Name, signature, stamp & date' },
  ]);
  return b.finish();
}

async function buildInvoice(invoice: Invoice): Promise<jsPDF> {
  const isTax = invoice.invoiceType === 'statutory_sales_tax_invoice' || invoice.taxTotal > 0;
  const watermark = invoice.status === 'void_reversed' ? 'VOID' : invoice.status === 'draft' ? 'DRAFT' : invoice.status === 'paid' ? 'PAID' : undefined;
  const { b, profile } = await builder(isTax ? 'Sales Tax Invoice' : 'Invoice', invoice.invoiceNumber, watermark, undefined, {
    type: 'invoice', issued: invoice.issueDate, client: invoice.customerName, clientIsPerson: invoice.customerType !== 'company', amount: invoice.grossPayable, status: invoice.status,
  });

  b.titleBand(
    [
      { label: 'Invoice No.', value: invoice.invoiceNumber },
      { label: 'Invoice date', value: formatDate(invoice.issueDate) },
      { label: 'Due date', value: formatDate(invoice.dueDate) },
      { label: 'Status', value: statusLabel(invoice.status) },
    ],
    isTax ? `Tax jurisdiction: ${JURISDICTION[invoice.jurisdiction] || invoice.jurisdiction}` : undefined
  );

  const bill = clientParty(invoice.customerType, invoice.customerId, invoice.customerName, invoice.branchId, 'Bill to');
  // clientParty lines: [branch, address, city, attn, phone/email, tax numbers]
  if (invoice.billingAddress) bill.lines[1] = invoice.billingAddress;
  if (invoice.customerNtn || invoice.customerStrn) {
    // The invoice's own tax numbers win over the customer profile's
    bill.lines[5] = [invoice.customerNtn && `NTN: ${invoice.customerNtn}`, invoice.customerStrn && `STRN: ${invoice.customerStrn}`].filter(Boolean).join('  ·  ');
  }
  const job = invoice.jobId ? dataService.getJobById(invoice.jobId) : undefined;
  b.parties(bill, {
    heading: 'Service reference',
    name: job?.siteName || invoice.branchName || 'Pest management services',
    lines: [
      job && `Service job: ${job.id} (${formatDate(job.scheduledDate)})`,
      job?.siteAddress,
      invoice.contractId && `Contract: ${invoice.contractId}`,
      [profile.ntn && `Our NTN: ${profile.ntn}`, profile.strn && `Our STRN: ${profile.strn}`].filter(Boolean).join('  ·  '),
    ],
  });

  b.section('Details', 30);
  b.table(
    isTax
      ? ['#', 'Description', 'Qty', 'Rate (PKR)', 'Value excl. tax', 'Tax %', 'Sales tax', 'Amount incl. tax']
      : ['#', 'Description', 'Qty', 'Rate (PKR)', 'Amount (PKR)'],
    invoice.lineItems.map((li, i) =>
      isTax
        ? [i + 1, `${li.description}${li.serviceCategory ? `\n${li.serviceCategory}` : ''}`, li.quantity, money(li.unitPrice), money(li.amount), `${li.taxRatePercent}%`, money(li.taxAmount), money(li.totalWithTax)]
        : [i + 1, `${li.description}${li.serviceCategory ? `\n${li.serviceCategory}` : ''}`, li.quantity, money(li.unitPrice), money(li.amount)]
    ),
    {
      columnStyles: isTax
        ? { 0: { cellWidth: 8, halign: 'center' }, 1: { cellWidth: 56 }, 2: { cellWidth: 11, halign: 'center' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { cellWidth: 13, halign: 'center' }, 6: { halign: 'right' }, 7: { halign: 'right', fontStyle: 'bold' } }
        : { 0: { cellWidth: 8, halign: 'center' }, 1: { cellWidth: 100 }, 2: { cellWidth: 14, halign: 'center' }, 3: { halign: 'right' }, 4: { halign: 'right', fontStyle: 'bold' } },
    }
  );

  const rows: [string, string][] = [['Value excluding tax', pkr(invoice.subtotal)]];
  if (invoice.taxTotal) rows.push(['Sales tax', pkr(invoice.taxTotal)]);
  rows.push(['Gross payable', pkr(invoice.grossPayable)]);
  if (invoice.amountPaid) rows.push(['Received', `- ${pkr(invoice.amountPaid)}`]);
  if (invoice.customerWhtTotal) rows.push(['Withholding tax deducted', `- ${pkr(invoice.customerWhtTotal)}`]);
  b.totals(rows, [invoice.balanceDue < invoice.grossPayable ? 'Balance due' : 'Total payable', invoice.balanceDue]);

  if (invoice.status === 'void_reversed' && invoice.creditNoteReason) {
    b.noteBox('Reversed by credit note', [`${invoice.creditNoteId ? `${invoice.creditNoteId}: ` : ''}${invoice.creditNoteReason}`], [254, 242, 242]);
  }

  b.noteBox('Payment details', [
    profile.bankAccountTitle && `Account title: ${profile.bankAccountTitle}`,
    [profile.bankName, profile.bankBranch].filter(Boolean).join(', '),
    profile.bankAccountNo && `Account no.: ${profile.bankAccountNo}`,
    profile.bankIban && `IBAN: ${profile.bankIban}`,
    profile.invoiceNotes || '',
  ].filter(Boolean) as string[]);

  if (invoice.notes) b.noteBox('Notes', [invoice.notes]);

  b.signatures([
    { label: 'Prepared by', name: invoice.postedBy || ' ' },
    { label: `For ${profile.shortName || profile.legalName}`, name: profile.signatoryName || ' ', sub: profile.signatoryTitle },
  ]);
  return b.finish();
}

async function buildReceipt(receipt: PaymentReceipt): Promise<jsPDF> {
  const invoice = dataService.getInvoiceById(receipt.invoiceId);
  const { b, profile } = await builder('Payment Receipt', receipt.receiptNumber, receipt.isReversed ? 'REVERSED' : undefined, undefined, {
    type: 'receipt', issued: receipt.paymentDate, client: receipt.customerName, clientIsPerson: invoice ? invoice.customerType !== 'company' : true,
    amount: receipt.totalCreditApplied || receipt.cashAmountReceived, status: receipt.isReversed ? 'reversed' : 'received',
  });
  b.titleBand([
    { label: 'Receipt No.', value: receipt.receiptNumber },
    { label: 'Date', value: formatDate(receipt.paymentDate) },
    { label: 'Against invoice', value: receipt.invoiceNumber },
  ]);
  b.parties(
    invoice ? clientParty(invoice.customerType, invoice.customerId, receipt.customerName, invoice.branchId, 'Received from') : { heading: 'Received from', name: receipt.customerName, lines: [] },
    {
      heading: 'Payment',
      name: statusLabel(receipt.paymentMode),
      lines: [
        receipt.bankName && `Bank: ${receipt.bankName}`,
        receipt.chequeNumber && `Cheque no.: ${receipt.chequeNumber}`,
        receipt.bankReferenceNo && `Reference: ${receipt.bankReferenceNo}`,
        receipt.chequeClearanceDate && `Cleared: ${formatDate(receipt.chequeClearanceDate)}`,
      ],
    }
  );
  const wht = receipt.customerWhtDeducted;
  b.table(
    ['Description', 'Amount (PKR)'],
    [
      ['Amount received', money(receipt.cashAmountReceived)],
      ...(wht?.isApplicable && wht.amountDeducted ? [[`Withholding tax ${wht.ratePercent}% (${wht.sectionCode})${wht.certificateNumber ? ` · Cert. ${wht.certificateNumber}` : ''}`, money(wht.amountDeducted)]] : []),
    ],
    { columnStyles: { 1: { halign: 'right', cellWidth: 45 } } }
  );
  const rows: [string, string][] = [];
  if (invoice) {
    rows.push(['Invoice total', pkr(invoice.grossPayable)]);
    rows.push(['Balance after this receipt', pkr(invoice.balanceDue)]);
  }
  b.totals(rows, ['Total credited', receipt.totalCreditApplied || receipt.cashAmountReceived + (wht?.amountDeducted || 0)]);
  b.signatures([
    { label: 'Received by', name: receipt.recordedByName },
    { label: `For ${profile.shortName || profile.legalName}`, name: profile.signatoryName || ' ', sub: profile.signatoryTitle },
  ]);
  return b.finish();
}

const PHOTO_LABEL: Record<string, string> = {
  before: 'Before treatment',
  after: 'After treatment',
  infestation_focus: 'Infestation evidence',
  bait_station: 'Bait station / device',
};

/** Loads up to 8 photos for a two-per-row grid; photos that fail to load are skipped. */
async function photoItems(list: SitePhoto[], label: (p: SitePhoto) => string) {
  const items = await Promise.all(
    list.slice(0, 8).map(async (p) => {
      const img = await loadImage(p.imageUrl, 900);
      return img ? { img, caption: `${label(p)} · ${formatDate(p.capturedAt)}` } : null;
    })
  );
  return items.filter(Boolean) as { img: Img; caption: string }[];
}

async function buildJobReport(job: ServiceJob): Promise<jsPDF> {
  const { b, profile } = await builder('Service Report', job.id, job.status === 'cancelled' ? 'CANCELLED' : undefined, undefined, {
    type: 'service_report', issued: job.scheduledDate, client: job.customerName, clientIsPerson: job.customerType !== 'company', status: job.status,
  });
  b.titleBand(
    [
      { label: 'Report / Job No.', value: job.id },
      { label: 'Service date', value: formatDate(job.scheduledDate) },
      { label: 'Time', value: statusLabel(job.timeSlot) },
      { label: 'Status', value: statusLabel(job.status) },
    ],
    job.serviceType
  );

  b.parties(clientParty(job.customerType, job.customerId, job.customerName, job.branchId), {
    heading: 'Service site',
    name: job.siteName,
    lines: [job.siteAddress, `Lead technician: ${job.leadPcoName}`, job.assignedTechnicianNames.length > 1 ? `Team: ${job.assignedTechnicianNames.join(', ')}` : false, job.contractId && `Contract: ${job.contractId}`],
  });

  b.keyValues([
    ['Target pests', job.targetPests.map((p) => statusLabel(p)).join(', ')],
    ['Service type', job.serviceType],
  ]);

  if (job.chemicalsUsed.length) {
    b.section('Materials applied');
    b.table(
      ['Product', 'Active ingredient', 'Target', 'Method', 'Dosage', 'Qty used', 'Batch'],
      job.chemicalsUsed.map((c) => [c.chemicalName, c.activeIngredient, statusLabel(c.targetPest), statusLabel(c.applicationMethod), c.dosageRate, `${c.quantityUsed} ${c.unit}`, c.batchNumber]),
      { columnStyles: { 0: { fontStyle: 'bold', cellWidth: 34 } } }
    );
  }

  if (job.checklists.length) {
    b.section('Service checklist');
    b.table(
      ['#', 'Task', 'Status', 'Remarks'],
      job.checklists.map((c, i) => [i + 1, c.taskDescription, c.isCompleted ? 'Completed' : 'Not done', c.notes || '']),
      {
        columnStyles: { 0: { cellWidth: 8, halign: 'center' }, 2: { cellWidth: 26 }, 3: { cellWidth: 46 } },
        didParseCell: (d) => {
          if (d.section === 'body' && d.column.index === 2) d.cell.styles.textColor = d.cell.raw === 'Completed' ? b.brand : [220, 38, 38];
        },
      }
    );
  }

  if (job.executionNotes) {
    b.section('Technician remarks');
    b.paragraph(job.executionNotes);
  }

  const photos = await photoItems(job.photoEvidence, (p) => {
    const kind = PHOTO_LABEL[p.type] || statusLabel(p.type);
    return `${kind}${p.caption && !p.caption.startsWith(kind) && p.caption !== PHOTO_LABEL[p.type] ? `: ${p.caption}` : ''}`;
  });
  if (photos.length) {
    b.section('Photo evidence', 72);
    b.photos(photos);
  }

  if (job.supervisorVerification) {
    const v = job.supervisorVerification;
    b.section('Quality verification');
    b.keyValues([
      ['Verified by', v.supervisorName],
      ['QC rating', statusLabel(v.qcRating)],
      ['Verified on', formatDate(v.verifiedAt)],
      ['Notes', v.supervisorNotes],
    ]);
  }

  const so = job.customerSignOff;
  const signature = so?.signatureDataUrl ? await loadImage(so.signatureDataUrl, 600, 'image/png') : null;
  if (so) {
    b.section('Customer acknowledgement');
    b.keyValues([
      ['Acknowledged by', `${so.acknowledgedByName}${so.customerDesignation ? ` (${so.customerDesignation})` : ''}`],
      ['Feedback rating', `${so.feedbackRating} / 5`],
      ['Comments', (so as { comments?: string }).comments],
      ['Signed on', formatDate(so.signedAt)],
    ]);
  }
  b.signatures([
    { label: 'Technician', name: job.leadPcoName, sub: profile.pcoLicense ? `PCO Licence: ${profile.pcoLicense}` : undefined },
    { label: 'Client representative', name: so?.acknowledgedByName || ' ', sub: so?.customerDesignation, image: signature },
  ]);
  return b.finish();
}

/** Risk assessment report: picture evidence, observation, risk and recommendation per finding. */
async function buildInspectionReport(lead: Lead): Promise<jsPDF> {
  const i = lead.inspection;
  const findings = i?.findings ?? [];
  const client = lead.companyName || lead.title;
  const title = findings.length ? 'Risk Assessment Report' : 'Site Inspection Report';
  const { b, profile } = await builder(title, i?.id || lead.id, i?.status === 'completed' ? undefined : 'SCHEDULED', undefined, {
    type: 'inspection_report', issued: i?.completedDate || i?.scheduledDate || lead.createdAt, client,
    clientIsPerson: lead.customerType !== 'company', status: i?.status || 'scheduled',
  });
  const primary = lead.contacts?.find((c) => c.isPrimary) ?? lead.contacts?.[0];
  const preparedBy = i?.findingsBy || i?.inspectorNames?.join(', ') || i?.inspectorName || '—';
  b.titleBand(
    [
      { label: 'Report No.', value: i?.id || '—' },
      { label: 'Date', value: formatDate(i?.completedDate || i?.scheduledDate) },
      { label: 'Branch / site', value: i?.siteName || [lead.area, lead.city].filter(Boolean).join(', ') || '—' },
      { label: 'Prepared by', value: preparedBy },
      { label: 'Observed by', value: i?.observedBy || '—' },
    ],
    i?.reportTitle || `${title} - ${client}`
  );
  b.parties(
    {
      heading: 'Client',
      name: client,
      lines: [
        primary && `Attn: ${primary.name}${primary.designation ? ` (${primary.designation})` : ''}`,
        [primary?.phone || lead.phone, primary?.email || lead.email].filter(Boolean).join('  ·  '),
        lead.industry,
      ],
    },
    { heading: 'Inspected site', name: i?.siteName || [lead.area, lead.city].filter(Boolean).join(', ') || lead.city, lines: [lead.propertyAddress, i?.teamName && `Team: ${i.teamName}`] }
  );
  if (i) {
    b.keyValues([
      ['Pests identified', i.pestTypesFound.map((p) => statusLabel(p)).join(', ')],
      ['Infestation level', statusLabel(i.infestationSeverity)],
      ['Area inspected', i.areaSqFt ? `${i.areaSqFt.toLocaleString()} sq ft` : undefined],
      ['Status', statusLabel(i.status)],
    ]);
  }

  if (findings.length) {
    // Table: picture evidence | observation | risk | recommendation
    const images = await Promise.all(findings.map((f) => (f.photo ? loadImage(f.photo.imageUrl, 700) : Promise.resolve(null))));
    const PIC_W = 42;
    const PIC_H = 34;
    b.section('Findings', 50);
    b.table(
      ['#', 'Picture evidence', 'Observation', 'Risk', 'Recommendation'],
      findings.map((f, idx) => [idx + 1, images[idx] ? '' : f.photo ? '(photo unavailable)' : '—', `${f.location ? `${f.location}\n` : ''}${f.observation}`, f.risk, f.recommendation]),
      {
        styles: { fontSize: 8, valign: 'top', cellPadding: 2.2, lineColor: RULE, lineWidth: 0.2, textColor: INK, font: 'helvetica' },
        alternateRowStyles: {},
        columnStyles: {
          0: { cellWidth: 8, halign: 'center' },
          1: { cellWidth: PIC_W + 4, minCellHeight: PIC_H + 4, halign: 'center' },
          2: { cellWidth: 46 },
          3: { cellWidth: 38 },
        },
        rowPageBreak: 'avoid',
        didDrawCell: (d) => {
          if (d.section !== 'body' || d.column.index !== 1) return;
          const img = images[d.row.index];
          if (!img) return;
          const scale = Math.min(PIC_W / img.w, PIC_H / img.h);
          const w = img.w * scale;
          const h = img.h * scale;
          b.doc.addImage(img.data, 'JPEG', d.cell.x + (d.cell.width - w) / 2, d.cell.y + 2, w, h, undefined, 'FAST');
        },
      }
    );
    if (i?.recommendedTreatment) {
      b.section('Recommended treatment');
      b.paragraph(i.recommendedTreatment);
    }
  } else if (i) {
    // Older inspections: free-text findings
    b.section('Findings');
    b.paragraph(i.criticalFindings || 'Findings pending.');
    if (i.recommendedTreatment) {
      b.section('Recommended treatment');
      b.paragraph(i.recommendedTreatment);
    }
  }

  const general = i?.photos?.length ? i.photos : findings.length ? [] : lead.sitePhotos ?? [];
  const photos = await photoItems(general, (p) => p.caption || statusLabel(p.type));
  if (photos.length) {
    b.section('Site photos', 72);
    b.photos(photos);
  }
  b.noteBox('Next step', [`${profile.legalName} will share a detailed proposal with pricing based on these findings.`], b.brandTint);
  b.signatures([
    { label: 'Prepared by', name: preparedBy },
    { label: 'Observed by', name: i?.observedBy || primary?.name || ' ', sub: i?.observedBy ? undefined : primary?.designation },
  ]);
  return b.finish();
}

/** Client SOP / Pest Management Plan from the template in ./sopTemplate.ts. */
async function buildSop(sop: SopInput): Promise<jsPDF> {
  const profile = companyProfile.get();
  const company = profile.shortName || profile.legalName;
  const { b } = await builder('Pest Management Plan', sop.documentNo);
  b.titleBand(
    [
      { label: 'Document No.', value: sop.documentNo },
      { label: 'Effective date', value: formatDate(sop.effectiveDate) },
      { label: 'Review date', value: sop.reviewDate ? formatDate(sop.reviewDate) : '—' },
      { label: 'Prepared by', value: sop.preparedBy },
    ],
    `Integrated Pest Management plan for ${sop.clientName}`
  );
  b.parties(
    { heading: 'Client', name: sop.clientName, lines: [sop.siteName && `Site: ${sop.siteName}`, sop.address] },
    { heading: 'Service provider', name: profile.legalName, lines: [[profile.address, profile.city].filter(Boolean).join(', '), [profile.phone, profile.email].filter(Boolean).join('  ·  '), profile.pcoLicense && `PCO Licence: ${profile.pcoLicense}`] }
  );
  const values = { client: sop.clientName, company, site: sop.siteName };
  documentTemplates.get().sopSections.forEach((sec, i) => {
    b.section(`${i + 1}. ${sec.title}`);
    sec.paragraphs.forEach((t) => b.paragraph(fillSop(t, values)));
    if (sec.bullets?.length) b.numbered(sec.bullets.map((t) => fillSop(t, values)));
  });

  if (sop.products.length) {
    b.section('Products used', 24);
    b.table(['#', 'Product', 'Used for'], sop.products.map((pr, i) => [i + 1, pr.name, pr.use || '—']), { columnStyles: { 0: { cellWidth: 9, halign: 'center' }, 1: { fontStyle: 'bold' } } });
    b.paragraph('The MSDS of each product is part of the onboarding pack.', 8, MUTED);
  }
  if (sop.authorizedPersons.length) {
    b.section('Authorised persons', 24);
    b.table(['Name', 'Designation', 'Organisation'], sop.authorizedPersons.map((a) => [a.name, a.designation || '—', a.organisation === 'ikpm' ? profile.legalName : sop.clientName]));
  }
  if (sop.contacts.length) {
    b.section('Contacts', 24);
    b.table(['Name', 'Role', 'Phone', 'Email'], sop.contacts.map((c) => [c.name, c.role || '—', c.phone || '—', c.email || '—']));
  }
  b.signatures([
    { label: 'Prepared by', name: sop.preparedBy, sub: profile.legalName },
    { label: 'Approved by (client)', name: sop.approvedBy || ' ', sub: sop.clientName },
  ]);
  return b.finish();
}

const prefix = () => companyProfile.get().shortName || 'Document';

/** Shared with src/lib/opsPdf.ts (layouts, monitoring sheets, trend reports, schedules). */
export const pdfKit = { builder, loadImage, MUTED };

export const pdfGenerator = {
  // Proposals
  async generateProposalPDF(proposal: Proposal) {
    (await buildProposal(proposal)).save(this.proposalFileName(proposal));
  },
  async proposalPDFBlob(proposal: Proposal): Promise<Blob> {
    return (await buildProposal(proposal)).output('blob');
  },
  proposalFileName(proposal: Proposal) {
    return safe(`${prefix()}_Proposal_${proposal.id}_R${proposal.revisionNumber}_${proposal.customerName}.pdf`);
  },

  // Invoices & receipts
  async generateInvoicePDF(invoice: Invoice) {
    (await buildInvoice(invoice)).save(safe(`${prefix()}_Invoice_${invoice.invoiceNumber}_${invoice.customerName}.pdf`));
  },
  async invoicePDFBlob(invoice: Invoice): Promise<Blob> {
    return (await buildInvoice(invoice)).output('blob');
  },
  async generateReceiptPDF(receipt: PaymentReceipt) {
    (await buildReceipt(receipt)).save(this.receiptFileName(receipt));
  },
  receiptFileName(receipt: PaymentReceipt) {
    return safe(`${prefix()}_Receipt_${receipt.receiptNumber}_${receipt.customerName}.pdf`);
  },
  async receiptPDFBlob(receipt: PaymentReceipt): Promise<Blob> {
    return (await buildReceipt(receipt)).output('blob');
  },

  // Field service & inspections
  async generateJobReportPDF(job: ServiceJob) {
    (await buildJobReport(job)).save(this.jobReportFileName(job));
  },
  jobReportFileName(job: ServiceJob) {
    return safe(`${prefix()}_Service_Report_${job.id}_${job.customerName}.pdf`);
  },
  async jobReportPDFBlob(job: ServiceJob): Promise<Blob> {
    return (await buildJobReport(job)).output('blob');
  },
  /** Sample document showing the current letterhead, opened in a new tab. */
  async previewLetterhead(override?: CompanyProfile) {
    const { b, profile } = await builder('Sample Document', 'PREVIEW', 'SAMPLE', override);
    b.titleBand([
      { label: 'Document No.', value: 'PREVIEW' },
      { label: 'Date', value: formatDate(new Date().toISOString()) },
    ], 'This is how your company details appear on proposals, invoices and reports');
    b.parties(
      { heading: 'Client', name: 'Sample Client (Pvt) Ltd', lines: ['Plot 1, Industrial Area', 'Karachi, Sindh', 'Attn: Client Contact (Operations Manager)', '0300 0000000  ·  client@example.com'] },
      { heading: 'Service site', name: 'Main premises', lines: ['Site address appears here'] }
    );
    b.table(['#', 'Service', 'Qty', 'Amount (PKR)'], [[1, 'General pest control (monthly)', 1, money(25000)]], { columnStyles: { 0: { cellWidth: 8 }, 3: { halign: 'right' } } });
    b.totals([['Subtotal', pkr(25000)], ['Sales tax (15%)', pkr(3750)]], ['Total payable', 28750]);
    b.noteBox('Payment details', [profile.bankAccountTitle && `Account title: ${profile.bankAccountTitle}`, profile.bankName, profile.bankAccountNo && `Account no.: ${profile.bankAccountNo}`, profile.bankIban && `IBAN: ${profile.bankIban}`].filter(Boolean) as string[]);
    b.signatures([{ label: `For ${profile.shortName}`, name: profile.signatoryName || ' ', sub: profile.signatoryTitle }, { label: 'Client', name: ' ' }]);
    window.open(URL.createObjectURL(b.finish().output('blob')), '_blank');
  },

  /** Drops cached images (e.g. after the logo changes). */
  clearImageCache() {
    imageCache.clear();
  },

  // Client SOP (onboarding pack)
  async sopPDFBlob(sop: SopInput): Promise<Blob> {
    return (await buildSop(sop)).output('blob');
  },
  async generateSopPDF(sop: SopInput) {
    (await buildSop(sop)).save(this.sopFileName(sop));
  },
  sopFileName(sop: SopInput) {
    return safe(`${prefix()}_Pest_Management_Plan_${sop.documentNo}_${sop.clientName}.pdf`);
  },

  async generateInspectionReportPDF(lead: Lead) {
    (await buildInspectionReport(lead)).save(this.inspectionReportFileName(lead));
  },
  async inspectionReportPDFBlob(lead: Lead): Promise<Blob> {
    return (await buildInspectionReport(lead)).output('blob');
  },
  inspectionReportFileName(lead: Lead) {
    const kind = lead.inspection?.findings?.length ? 'Risk_Assessment' : 'Inspection';
    return safe(`${prefix()}_${kind}_${lead.inspection?.id || lead.id}_${lead.companyName || lead.title}.pdf`);
  },
};
