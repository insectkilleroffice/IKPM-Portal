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
import { billingAccountOf, type ClientStatement, type Invoice, type PaymentReceipt, type TaxJurisdiction } from '../types/finance';
import type { Lead } from '../types/crm';
import { formatDate } from './formatters';
import { companyProfile, DEFAULT_ACCENT_COLOR, DEFAULT_BRAND_COLOR, type CompanyProfile } from '../services/companyProfile';
import { dataService } from '../services/dataService';
import { planPricing } from './proposalPlan';
import { fillSop } from './sopTemplate';
import { fillTemplate } from './templateFill';
import { documentTemplates } from '../services/documentTemplates';
import type { SopInput } from '../types/document';
import type { EmployeeLetter } from '../types/hr';
import type { QualityAudit } from '../types/audits';

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
  fbr_sales_tax: 'Federal Board of Revenue (FBR - Sales Tax)',
  fbr_cash: 'Federal Board of Revenue (FBR - Cash / Retail)',
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
    // Professional alignment for every table: serial numbers and short codes centred, money and
    // numbers right-aligned, text left. Headers follow their column. A table's own columnStyles win.
    const rows = body.map((r) => r.map((c) => (typeof c === 'number' ? String(c) : c)));
    const given = (opts.columnStyles ?? {}) as Record<number, { halign?: 'left' | 'center' | 'right'; cellWidth?: number | 'auto' | 'wrap' }>;
    const numeric = (v: unknown) => typeof v === 'string' && v.trim() !== '' && /^(PKR\s*)?[-+]?[\d,]+(\.\d+)?\s*%?$|^[-–—]$/.test(v.trim());
    const alignOf = (h: string, col: number): 'left' | 'center' | 'right' => {
      const t = h.trim().toLowerCase();
      if (/^(#|no\.?|s\.?\s?no\.?|sr\.?(\s?no\.?)?)$/.test(t)) return 'center';
      if (/(pkr|amount|rate|price|total|value|balance|paid|charges|cost|sales tax|wht|net|gross|incl\.|excl\.)/.test(t)) return 'right';
      if (/^(qty|quantity|unit|units|%|tax %|visits?|frequency|date|status|time|sq\s?ft|area)\b/.test(t)) return 'center';
      const cells = rows.map((r) => r[col]).filter((c) => c !== undefined && String(c).trim() !== '');
      return cells.length > 0 && cells.every(numeric) ? 'right' : 'left';
    };
    const columnStyles: Record<number, object> = {};
    const headAlign: ('left' | 'center' | 'right')[] = [];
    head.forEach((h, i) => {
      const auto = alignOf(h, i);
      const halign = given[i]?.halign ?? auto;
      headAlign[i] = halign;
      columnStyles[i] = {
        ...(/^(#|no\.?|sr\.?)$/i.test(h.trim()) && given[i]?.cellWidth === undefined ? { cellWidth: 9 } : {}),
        ...given[i],
        halign,
      };
    });
    const userParse = opts.didParseCell;
    autoTable(this.doc, {
      startY: this.y,
      head: [head],
      body: rows,
      margin: { left: M, right: M, top: 20, bottom: FOOTER_H + 6 },
      theme: 'grid',
      styles: { font: 'helvetica', fontSize: 8.2, cellPadding: { top: 2.2, bottom: 2.2, left: 2.5, right: 2.5 }, textColor: INK, lineColor: RULE, lineWidth: 0.2, valign: 'middle', overflow: 'linebreak' },
      headStyles: { fillColor: this.navy, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.8, lineColor: this.navy, valign: 'middle' },
      alternateRowStyles: { fillColor: TINT },
      ...opts,
      columnStyles,
      didParseCell: (data) => {
        if (data.section === 'head') data.cell.styles.halign = headAlign[data.column.index] ?? 'left';
        userParse?.(data);
      },
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

  /**
   * Company stamp block: company authorized-signatory line on the left (with stamp
   * image above it when available) and a client acceptance line on the right.
   */
  stampBlock(stamp: Img | null, clientLabel = 'Accepted by client', attName?: string, attDesignation?: string) {
    const h = 32;
    this.ensure(h + 4);
    const half = (CONTENT_W - 10) / 2;
    const lineY = this.y + h - 8;

    // Left side — company authorized signatory
    if (stamp) {
      const maxSide = 20;
      const scale = Math.min(maxSide / stamp.w, maxSide / stamp.h);
      const sw = stamp.w * scale;
      const sh = stamp.h * scale;
      this.doc.addImage(stamp.data, 'PNG', M, this.y + (lineY - this.y - sh) / 2, sw, sh, undefined, 'FAST');
    }
    this.color([148, 163, 184], 'draw');
    this.doc.setLineWidth(0.3);
    this.doc.line(M, lineY, M + half, lineY);
    this.font(7.2, 'bold', MUTED);
    this.doc.text('AUTHORIZED SIGNATORY', M, lineY + 4, { charSpace: 0.2 });
    this.font(7.5, 'normal', MUTED);
    this.doc.text(`${this.profile.shortName || this.profile.legalName} · signature & stamp`, M, lineY + 8.5, { maxWidth: half });

    // Right side — client acceptance line
    const rx = M + half + 10;
    this.color([148, 163, 184], 'draw');
    this.doc.setLineWidth(0.3);
    this.doc.line(rx, lineY, rx + half, lineY);
    this.font(7.2, 'bold', MUTED);
    this.doc.text(clientLabel.toUpperCase(), rx, lineY + 4, { charSpace: 0.2 });
    if (attName) {
      this.font(8.6, 'bold', INK);
      this.doc.text(attName, rx, lineY + 8.5, { maxWidth: half });
    }
    this.font(7.5, 'normal', MUTED);
    this.doc.text(attDesignation ? `${attDesignation} · signature, stamp & date` : 'Name, signature, stamp & date', rx, attName ? lineY + 12 : lineY + 8.5, { maxWidth: half });
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

  /** "Our valued clients": logos in evenly spaced tiles, up to 6 per row, name under each. */
  logoStrip(heading: string, items: { img: Img; name: string }[]) {
    if (!items.length) return;
    const perRow = Math.min(6, items.length);
    const gap = 4;
    const w = (CONTENT_W - gap * (perRow - 1)) / perRow;
    const tileH = 16;
    const rows = Math.ceil(items.length / perRow);
    this.ensure(10 + rows * (tileH + 7));
    this.font(7, 'bold', this.brand);
    this.doc.text(heading.toUpperCase(), M, this.y, { charSpace: 0.3 });
    this.y += 3;
    for (let r = 0; r < rows; r++) {
      items.slice(r * perRow, r * perRow + perRow).forEach((it, j) => {
        const x = M + j * (w + gap);
        this.color(RULE, 'draw');
        this.color([255, 255, 255], 'fill');
        this.doc.roundedRect(x, this.y, w, tileH, 1.2, 1.2, 'FD');
        const scale = Math.min((w - 4) / it.img.w, (tileH - 4) / it.img.h);
        const iw = it.img.w * scale;
        const ih = it.img.h * scale;
        this.doc.addImage(it.img.data, 'PNG', x + (w - iw) / 2, this.y + (tileH - ih) / 2, iw, ih, undefined, 'FAST');
        this.font(6.4, 'normal', MUTED);
        this.doc.text(it.name, x + w / 2, this.y + tileH + 3.2, { align: 'center', maxWidth: w });
      });
      this.y += tileH + 7;
    }
    this.y += 2;
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

async function builder(title: string, ref: string, watermark?: string, override?: CompanyProfile, verify?: VerifyInput, cashAccount = false) {
  const base = override ?? companyProfile.get();
  // Cash memos come from the second (cash) account: its trade name, no tax registration numbers
  const profile: CompanyProfile = cashAccount
    ? { ...base, legalName: base.cashAccount?.tradeName || base.legalName, ntn: undefined, strn: undefined, provincialTaxNo: undefined }
    : base;
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
// Proposal presentation (shared by both proposal layouts)
// ---------------------------------------------------------------------------
const SVC_LABEL: Record<string, string> = {
  general_fumigation: 'General fumigation', cockroach_gel: 'Cockroach gel', rodent_control: 'Rodent control',
  termite_treatment: 'Termite treatment', bedbug_treatment: 'Bedbug treatment', mosquito_fogging: 'Mosquito / fly fogging',
  ant_treatment: 'Ant treatment', stored_grain_pest: 'Stored grain pest control', snake_reptile: 'Snake / reptile control',
  monitoring_visit: 'Monitoring visit',
};
const svcLabel = (s: string) => SVC_LABEL[s] || s.replace(/_/g, ' ');

/** Every branch / site the proposal covers, with services, visits and monthly charges. */
function branchSchedule(b: DocBuilder, proposal: Proposal) {
  const rows = proposal.branchBreakdowns ?? [];
  if (!rows.length) return;
  b.section(`Branches covered (${rows.length})`, 40);
  b.table(
    ['#', 'Branch / site', 'Services / treatments', 'Visits\n/month', 'Monthly\ncharges (PKR)'],
    rows.map((br, i) => [
      i + 1,
      br.branchName + (br.address ? `\n${br.address}` : ''),
      (br.services || []).map((sv) => `${svcLabel(sv.service)}${sv.formula?.trim() ? ` — ${sv.formula.trim()}` : ''}${sv.frequency ? ` (${sv.frequency})` : ''}`).join('\n') || br.treatment || '—',
      String(br.visitsPerMonth ?? 1),
      money(br.monthlyAmount),
    ]),
    { columnStyles: { 0: { cellWidth: 8, halign: 'center' }, 1: { fontStyle: 'bold', cellWidth: 48 }, 2: { cellWidth: 66 }, 3: { halign: 'center', cellWidth: 16 }, 4: { halign: 'right' } } }
  );
  b.keyValues([['Total monthly charges (all branches)', pkr(rows.reduce((s, br) => s + (br.monthlyAmount || 0), 0))]], 2);
}

/** "Why choose us" box + "Our valued clients" logo strip, both from Settings → Company. */
async function proposalCredentials(b: DocBuilder, profile: CompanyProfile) {
  const points = (profile.proposalHighlights || '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (points.length) b.noteBox(`Why choose ${profile.shortName || profile.legalName}`, points.map((p) => `•  ${p}`), b.brandTint);
  const logos = (await Promise.all(
    (profile.clientLogos ?? []).slice(0, 12).map(async (c) => {
      const img = await loadImage(c.url, 400, 'image/png');
      return img ? { img, name: c.name } : null;
    })
  )).filter(Boolean) as { img: Img; name: string }[];
  b.logoStrip('Our valued clients', logos);
}

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
    proposal.branchBreakdowns?.length
      ? `${proposal.branchBreakdowns.length} branch${proposal.branchBreakdowns.length === 1 ? '' : 'es'}: ${proposal.branchBreakdowns.map((br) => br.branchName).join(', ')}`
      : proposal.branchName ? `${proposal.branchName}` : '',
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
  // The formula / brand column appears only when at least one row has one
  const planRows = proposal.servicePlan ?? [];
  const withFormula = planRows.some((row) => row.formula?.trim());
  b.table(
    withFormula ? ['#', 'Treatment / service', 'Formula / brand', 'Frequency'] : ['#', 'Service', 'Frequency'],
    planRows.map((row, i) => (withFormula ? [i + 1, row.service, row.formula?.trim() || '—', row.frequency] : [i + 1, row.service, row.frequency])),
    {
      columnStyles: withFormula
        ? { 0: { cellWidth: 9, halign: 'center' }, 1: { fontStyle: 'bold' }, 2: { cellWidth: 46 }, 3: { cellWidth: 42 } }
        : { 0: { cellWidth: 9, halign: 'center' }, 1: { fontStyle: 'bold' }, 2: { cellWidth: 52 } },
    }
  );
  b.keyValues([
    ['Total service visits per month', proposal.serviceVisitsPerMonth ? String(proposal.serviceVisitsPerMonth) : undefined],
    ['Follow-up visits per month', proposal.followUpVisitsPerMonth ? String(proposal.followUpVisitsPerMonth) : undefined],
    ['PCOs per visit', 'As per requirement'],
  ], 3);
  if (proposal.documentationIncluded?.length) b.noteBox('Documentation included', proposal.documentationIncluded.map((d) => `•  ${d}`));

  branchSchedule(b, proposal);

  b.section('Charges & tenure', 40);
  const taxLabel = proposal.taxPercent > 0 ? `Sales tax (${proposal.taxPercent}%)` : 'Sales tax';
  const months = proposal.tenureMonths ?? 12;
  b.table(
    ['Description', 'Amount (PKR)'],
    [
      [`Monthly charges${proposal.taxMode === 'inclusive' ? ' (excluding tax)' : ''}`, money(pricing.monthlyBase)],
      [`${taxLabel} per month`, money(pricing.monthlyTax)],
      ['Monthly charges including tax', money(pricing.monthlyTotal)],
      [`Tenure`, `${months} month${months === 1 ? '' : 's'}`],
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

  // Exclusions and device ownership are included in the Terms list (no separate note box)

  await proposalCredentials(b, profile);

  b.paragraph(`We look forward to serving you. For any questions please contact ${proposal.preparedByName}${profile.phone ? ` at ${profile.phone}` : ''}.`);
  const stamp = profile.stampUrl ? await loadImage(profile.stampUrl, 400, 'image/png') : null;
  b.stampBlock(stamp, 'Accepted by client', att?.name || undefined, att?.designation);
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

  const branches = proposal.branchBreakdowns ?? [];
  b.parties(
    clientParty(proposal.customerType, proposal.customerId, proposal.customerName, proposal.branchId, 'Prepared for'),
    branches.length > 1
      ? {
          heading: 'Service sites',
          name: `${branches.length} branches`,
          lines: [...branches.slice(0, 5).map((br) => `•  ${br.branchName}`), branches.length > 5 ? `…and ${branches.length - 5} more (see table)` : false],
        }
      : {
          heading: 'Service site',
          name: branches[0]?.branchName || proposal.branchName || 'Main premises',
          lines: [branches[0]?.address || proposal.siteAddress, proposal.warrantyPeriodMonths ? `Warranty: ${proposal.warrantyPeriodMonths} months` : false, `Payment terms: ${proposal.paymentTerms}`],
        }
  );

  b.section('Scope of work');
  b.paragraph(proposal.scopeOfWork);

  branchSchedule(b, proposal);

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
  // Move exclusions/device ownership into the terms list if present
  const extraTerms: string[] = [];
  if (proposal.exclusions) extraTerms.push(`Exclusions: ${proposal.exclusions}`);
  if (proposal.deviceOwnership) extraTerms.push(`Devices: ${proposal.deviceOwnership}`);
  b.numbered([
    `Payment terms: ${proposal.paymentTerms}.`,
    `This proposal is valid for ${proposal.validityDays || 30} days from the date above.`,
    proposal.warrantyPeriodMonths ? `Warranty: ${proposal.warrantyPeriodMonths} months. Free re-treatment if the targeted pests recur within the warranty period, subject to agreed hygiene recommendations.` : '',
    ...(profile.proposalTerms || '').split('\n'),
    ...extraTerms,
  ]);

  await proposalCredentials(b, profile);

  const stamp2 = profile.stampUrl ? await loadImage(profile.stampUrl, 400, 'image/png') : null;
  b.stampBlock(stamp2, 'Accepted by client');
  return b.finish();
}

async function buildInvoice(invoice: Invoice): Promise<jsPDF> {
  const isCash = billingAccountOf(invoice) === 'cash';
  const isTax = !isCash && (invoice.invoiceType === 'statutory_sales_tax_invoice' || invoice.taxTotal > 0);
  const watermark = invoice.status === 'void_reversed' ? 'VOID' : invoice.status === 'draft' ? 'DRAFT' : invoice.status === 'paid' ? 'PAID' : undefined;
  const { b, profile } = await builder(isCash ? 'Cash Memo' : isTax ? 'Sales Tax Invoice' : 'Invoice', invoice.invoiceNumber, watermark, undefined, {
    type: 'invoice', issued: invoice.issueDate, client: invoice.customerName, clientIsPerson: invoice.customerType !== 'company', amount: invoice.grossPayable, status: invoice.status,
  }, isCash);

  b.titleBand(
    [
      { label: isCash ? 'Memo No.' : 'Invoice No.', value: invoice.invoiceNumber },
      ...(invoice.poNumber ? [{ label: 'Your PO No.', value: invoice.poNumber }] : []),
      { label: isCash ? 'Date' : 'Invoice date', value: formatDate(invoice.issueDate) },
      { label: 'Due date', value: formatDate(invoice.dueDate) },
      { label: 'Status', value: statusLabel(invoice.status) },
    ],
    isTax ? `Tax jurisdiction: ${JURISDICTION[invoice.jurisdiction] || invoice.jurisdiction}` : undefined
  );
  // Voided: this PDF is the credit note reversing it
  if (invoice.status === 'void_reversed') {
    b.noteBox('Credit note', [
      `${invoice.creditNoteId ? `Credit note No. ${invoice.creditNoteId}` : 'Credit note'}${invoice.creditNoteDate ? ` dated ${formatDate(invoice.creditNoteDate)}` : ''} reverses this invoice in full (${pkr(invoice.grossPayable)}).`,
      `Reason: ${invoice.creditNoteReason || '—'}`,
    ]);
  }

  const bill = clientParty(invoice.customerType, invoice.customerId, invoice.customerName, invoice.branchId, 'Bill to');
  // clientParty lines: [branch, address, city, attn, phone/email, tax numbers]
  if (invoice.billingAddress) bill.lines[1] = invoice.billingAddress;
  if (isCash) {
    bill.lines[5] = false; // no tax numbers on a cash memo
  } else if (invoice.customerNtn || invoice.customerStrn) {
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
      !isCash && [profile.ntn && `Our NTN: ${profile.ntn}`, profile.strn && `Our STRN: ${profile.strn}`].filter(Boolean).join('  ·  '),
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

  const rows: [string, string][] = isCash ? [] : [['Value excluding tax', pkr(invoice.subtotal)]];
  if (!isCash && invoice.taxTotal) rows.push(['Sales tax', pkr(invoice.taxTotal)]);
  rows.push([isCash ? 'Total amount' : 'Gross payable', pkr(invoice.grossPayable)]);
  if (invoice.amountPaid) rows.push(['Received', `- ${pkr(invoice.amountPaid)}`]);
  if (invoice.customerWhtTotal) rows.push(['Withholding tax deducted', `- ${pkr(invoice.customerWhtTotal)}`]);
  b.totals(rows, [invoice.balanceDue < invoice.grossPayable ? 'Balance due' : 'Total payable', invoice.balanceDue]);

  if (invoice.status === 'void_reversed' && invoice.creditNoteReason) {
    b.noteBox('Reversed by credit note', [`${invoice.creditNoteId ? `${invoice.creditNoteId}: ` : ''}${invoice.creditNoteReason}`], [254, 242, 242]);
  }

  // Tax invoices show the tax account; cash memos the cash account (or "paid in cash")
  const acct = isCash
    ? profile.cashAccount ?? {}
    : { bankName: profile.bankName, bankAccountTitle: profile.bankAccountTitle, bankAccountNo: profile.bankAccountNo, bankIban: profile.bankIban, bankBranch: profile.bankBranch, notes: profile.invoiceNotes };
  const payLines = [
    acct.bankAccountTitle && `Account title: ${acct.bankAccountTitle}`,
    [acct.bankName, acct.bankBranch].filter(Boolean).join(', '),
    acct.bankAccountNo && `Account no.: ${acct.bankAccountNo}`,
    acct.bankIban && `IBAN: ${acct.bankIban}`,
    acct.notes || '',
  ].filter(Boolean) as string[];
  b.noteBox('Payment details', payLines.length ? payLines : ['Payable in cash to our authorised representative against this memo.']);

  const invStamp = profile.stampUrl ? await loadImage(profile.stampUrl, 400, 'image/png') : null;
  b.stampBlock(invStamp);
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
  const recStamp = profile.stampUrl ? await loadImage(profile.stampUrl, 400, 'image/png') : null;
  b.stampBlock(recStamp);
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
  const verified = Boolean(job.supervisorVerification?.isVerified);
  const visitTime = job.windowStart && job.windowEnd ? `${job.windowStart} - ${job.windowEnd}` : job.scheduledTime;
  const outcome: Record<string, string> = { completed: 'Completed', partial: 'Partially completed', client_blocked: 'Not done: no site access', postponed: 'Postponed' };
  b.titleBand(
    [
      { label: 'Report No.', value: job.id },
      { label: 'Service date', value: formatDate(job.scheduledDate) },
      { label: 'Time', value: visitTime || statusLabel(job.timeSlot) },
      { label: 'Visit', value: job.visitOutcome ? outcome[job.visitOutcome] : statusLabel(job.status) },
      { label: 'Quality check', value: verified ? 'Verified' : job.status === 'completed' ? 'Pending' : '—' },
    ],
    job.visitKind === 'follow_up' ? 'Follow-up visit report' : 'Pest control service report'
  );

  // Branch is the service location for company clients; fall back to the site record
  const branch = job.branchId ? dataService.getBranchById(job.branchId) : undefined;
  const pcos = dataService.pcoNames(job.performedByPcoIds?.length ? job.performedByPcoIds : job.assignedPcoEmployeeIds);
  const tlName = job.assignedTeamLeaderName || (job.leadPcoName !== 'Unassigned' ? job.leadPcoName : '');
  b.parties(clientParty(job.customerType, job.customerId, job.customerName), {
    heading: 'Service location',
    name: branch?.branchName || job.branchName || job.siteName,
    lines: [
      branch?.physicalAddress || job.siteAddress,
      tlName && `Supervisor: ${tlName}`,
      pcos.length > 0 && `Technicians: ${pcos.join(', ')}`,
      job.contractId && `Contract: ${job.contractId}`,
      job.challanNumber && `Signed challan No.: ${job.challanNumber}`,
    ],
  });

  const services = job.visitServices?.length ? job.visitServices.join(', ') : job.serviceType;
  b.keyValues([
    ['Services performed', services],
    ['Target pests', job.targetPests.length ? job.targetPests.map((p) => statusLabel(p)).join(', ') : undefined],
  ]);

  if (job.preCheck) {
    b.noteBox('Safety & readiness check', [
      `Team in uniform, safety gear (PPE) checked and chemicals issued from store before starting. Confirmed by ${job.preCheck.confirmedByName}.`,
    ]);
  }

  if (job.chemicalsUsed.length) {
    // Only print columns that were actually filled in (no placeholder values)
    const chems = job.chemicalsUsed;
    const has = (f: (c: (typeof chems)[number]) => string | undefined) => chems.some((c) => (f(c) || '').trim() && f(c) !== 'As applied');
    const cols: [string, (c: (typeof chems)[number]) => string][] = [
      ['Product', (c) => c.chemicalName],
      ...(has((c) => c.activeIngredient) ? [['Active ingredient', (c: (typeof chems)[number]) => c.activeIngredient] as [string, (c: (typeof chems)[number]) => string]] : []),
      ...(has((c) => c.dosageRate) ? [['Dosage', (c: (typeof chems)[number]) => c.dosageRate] as [string, (c: (typeof chems)[number]) => string]] : []),
      ['Quantity used', (c) => `${c.quantityUsed} ${c.unit.replace('_', ' ')}`],
      ...(has((c) => c.batchNumber) ? [['Batch', (c: (typeof chems)[number]) => c.batchNumber] as [string, (c: (typeof chems)[number]) => string]] : []),
    ];
    b.section('Materials applied');
    b.table(
      ['#', ...cols.map(([h]) => h)],
      chems.map((c, i) => [i + 1, ...cols.map(([, f]) => f(c) || '')]),
      { columnStyles: { 0: { cellWidth: 8, halign: 'center' }, 1: { fontStyle: 'bold' } } }
    );
  }

  // A checklist nobody ticked would print a column of red "Not done"; show it only when used
  if (job.checklists.some((c) => c.isCompleted)) {
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
    b.section('Findings & remarks');
    b.paragraph(job.executionNotes);
  }
  if (job.status === 'cancelled' && job.cancellationReason) {
    b.noteBox('Visit not carried out', [job.cancellationReason]);
  }

  const photos = await photoItems(job.photoEvidence, (p) => {
    const kind = PHOTO_LABEL[p.type] || statusLabel(p.type);
    return `${kind}${p.caption && !p.caption.startsWith(kind) && p.caption !== PHOTO_LABEL[p.type] ? `: ${p.caption}` : ''}`;
  });
  if (photos.length) {
    b.section('Photo evidence', 72);
    b.photos(photos);
  }

  // Signed service challan: its number and the scanned copy (PDF scans can't be embedded, so the number is shown)
  if (job.challanNumber || job.challanFileUrl) {
    const isPdf = /\.pdf($|\?)/i.test(job.challanFileUrl || '') || /^data:application\/pdf/i.test(job.challanFileUrl || '');
    const challanImg = job.challanFileUrl && !isPdf ? await loadImage(job.challanFileUrl, 1200) : null;
    b.section('Signed service challan', challanImg ? 72 : 18);
    b.keyValues([
      ['Challan No.', job.challanNumber || 'Not recorded'],
      ['Copy', challanImg ? 'Attached below' : job.challanFileUrl ? 'Scanned copy filed in the client folder' : 'Not attached'],
    ]);
    if (challanImg) b.photos([{ img: challanImg, caption: `Signed challan${job.challanNumber ? ` No. ${job.challanNumber}` : ''}` }]);
  }

  // Only a passed QC is shown to the client; send-backs are internal
  if (verified) {
    const v = job.supervisorVerification!;
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
    { label: 'Supervisor', name: tlName || ' ', sub: profile.pcoLicense ? `${profile.shortName || profile.legalName} · PCO Licence: ${profile.pcoLicense}` : profile.shortName || profile.legalName },
    { label: 'Client representative', name: so?.acknowledgedByName || ' ', sub: so?.customerDesignation || 'Name, signature & stamp', image: signature },
  ]);
  return b.finish();
}

/**
 * Job sheet (work order) for a visit that is not finished yet: what the team must do on site.
 * The full service report is only available once the visit is done and has passed the quality check.
 */
async function buildJobSheet(job: ServiceJob): Promise<jsPDF> {
  const { b } = await builder('Job Sheet', job.id, 'WORK ORDER');
  const visitTime = job.windowStart && job.windowEnd ? `${job.windowStart} - ${job.windowEnd}` : job.scheduledTime;
  b.titleBand(
    [
      { label: 'Job No.', value: job.id },
      { label: 'Visit date', value: formatDate(job.scheduledDate) },
      { label: 'Time', value: visitTime || statusLabel(job.timeSlot) },
      { label: 'Visit type', value: job.visitKind === 'follow_up' ? 'Follow-up' : 'Service' },
      { label: 'Status', value: statusLabel(job.status) },
    ],
    'What to do on this visit'
  );

  const branch = job.branchId ? dataService.getBranchById(job.branchId) : undefined;
  const pcos = dataService.pcoNames(job.assignedPcoEmployeeIds?.length ? job.assignedPcoEmployeeIds : job.performedByPcoIds);
  const tlName = job.assignedTeamLeaderName || (job.leadPcoName !== 'Unassigned' ? job.leadPcoName : '');
  b.parties(clientParty(job.customerType, job.customerId, job.customerName, job.branchId), {
    heading: 'Service location',
    name: branch?.branchName || job.branchName || job.siteName,
    lines: [
      branch?.physicalAddress || job.siteAddress,
      branch?.branchManagerName && `On-site contact: ${branch.branchManagerName}${branch.branchManagerPhone ? ` (${branch.branchManagerPhone})` : ''}`,
      job.contractId && `Contract: ${job.contractId}`,
    ],
  });

  b.keyValues([
    ['Services to perform', job.visitServices?.length ? job.visitServices.join(', ') : job.serviceType],
    ['Target pests', job.targetPests.length ? job.targetPests.map((p) => statusLabel(p)).join(', ') : undefined],
    ['Supervisor', tlName || 'To be assigned'],
    ['Technicians (PCOs)', pcos.length ? pcos.join(', ') : 'As assigned by the Supervisor'],
  ]);

  // Treatments and formulas agreed in the contract
  const contract = job.contractId ? dataService.getContractById(job.contractId) : undefined;
  if (contract?.servicePlan?.length) {
    b.section('Agreed treatments (contract service plan)');
    b.table(
      ['#', 'Treatment', 'Formula / product', 'Frequency'],
      contract.servicePlan.map((r, i) => [i + 1, r.service, r.formula || '', r.frequency || '']),
      { columnStyles: { 0: { cellWidth: 8, halign: 'center' }, 1: { fontStyle: 'bold' } } }
    );
  }
  if (contract?.chemicals?.length) b.keyValues([['Approved chemicals', contract.chemicals.join(', ')]], 1);
  if (contract?.exclusions) b.keyValues([['Exclusions', contract.exclusions]], 1);

  if (job.checklists.length) {
    b.section('Tasks on site');
    b.table(
      ['#', 'Task', 'Done', 'Remarks'],
      job.checklists.map((c, i) => [i + 1, c.taskDescription, '[   ]', '']),
      { columnStyles: { 0: { cellWidth: 8, halign: 'center' }, 2: { cellWidth: 16, halign: 'center' }, 3: { cellWidth: 50 } } }
    );
  }

  b.noteBox('Before you start', [
    '•  Team in uniform with safety gear (PPE); chemicals issued from the store.',
    '•  Take "before" photos of the treated areas.',
    '•  Follow the label dosage; keep food, people and pets away from treated areas.',
  ]);
  b.noteBox('Before you leave', [
    '•  Take "after" photos and record the chemicals and quantities used in the portal.',
    '•  Get the service challan signed and stamped by the client, and note its number.',
    '•  Report any pest activity, damage or access problems in the findings.',
  ]);
  if (job.rescheduledReason) b.noteBox('Rescheduled', [job.rescheduledReason]);

  b.signatures([
    { label: 'Supervisor', name: tlName || ' ', sub: 'Name & signature' },
    { label: 'Client representative', name: ' ', sub: 'Name, signature & stamp' },
  ]);
  return b.finish();
}

/**
 * HR letters on the company letterhead: offer letter (at hiring), employment contract (on joining)
 * and confirmation letter (end of probation). Terms come from the letter, frozen when it was issued.
 */
async function buildEmployeeLetter(letter: EmployeeLetter): Promise<jsPDF> {
  const t = letter.terms;
  const emp = dataService.getEmployeeById(letter.employeeId);
  const priv = dataService.getEmployeePrivate(letter.employeeId);
  const title = { offer_letter: 'Offer Letter', employment_contract: 'Employment Contract', confirmation_letter: 'Confirmation Letter' }[letter.kind];
  const { b, profile } = await builder(title, letter.refNo, letter.status === 'withdrawn' ? 'WITHDRAWN' : undefined);
  const company = profile.legalName;
  const name = letter.employeeName;
  const issued = formatDate(letter.issuedAt);
  const probationEnd = t.probationEndDate ? formatDate(t.probationEndDate) : `${t.probationMonths} month(s) after joining`;
  const extra = (t.extraTerms || '').split('\n').map((x) => x.trim()).filter(Boolean);
  const payRows = (gross: number) => [
    ['Basic salary', pkr(t.basicSalary)],
    ...t.allowances.filter((a) => a.amount > 0).map((a) => [a.label, pkr(a.amount)]),
    ['Gross monthly salary', pkr(gross)],
  ];
  const subtitle = { offer_letter: 'Offer of employment', employment_contract: 'Contract of employment', confirmation_letter: 'Confirmation of employment' }[letter.kind];
  b.titleBand([
    { label: 'Ref. No.', value: letter.refNo },
    { label: 'Date', value: issued },
    { label: 'Employee ID', value: letter.employeeId },
  ], subtitle);
  b.parties({
    heading: letter.kind === 'employment_contract' ? 'Employee' : 'To',
    name,
    lines: [
      priv?.fatherName && `S/O, D/O: ${priv.fatherName}`,
      priv?.cnic && `CNIC: ${priv.cnic}`,
      priv?.residentialAddress,
      emp?.phone && `Phone: ${emp.phone}`,
    ],
  });

  if (letter.kind === 'offer_letter') {
    b.paragraph(`Dear ${name},`);
    b.paragraph(`We are pleased to offer you the position of ${t.designation} in the ${t.department} department of ${company}, on the terms set out below.`);
    b.keyValues([
      ['Position', t.designation],
      ['Department', t.department],
      ['Reports to', t.reportingTo],
      ['Joining date', formatDate(t.joiningDate)],
      ['Probation', `${t.probationMonths} month(s), until ${probationEnd}`],
      ['Working hours', t.workingHours],
    ]);
    b.section('Monthly compensation');
    b.table(['Component', 'Amount'], payRows(t.grossSalary), { columnStyles: { 1: { halign: 'right', cellWidth: 50 } } });
    b.section('Terms of this offer');
    b.numbered([
      `During probation either side may end the employment with ${t.noticeDaysProbation} day(s) notice. On confirmation the notice period becomes ${t.noticeDaysPermanent} day(s).`,
      'Salary is paid monthly by bank transfer on the company payroll cycle, after statutory deductions where applicable.',
      'The attendance allowance is paid only for a month with fewer than two late marks or absences.',
      'On joining please bring: copy of your CNIC, two passport-size photographs, educational and experience certificates, and a police character certificate.',
      'This offer is subject to verification of the documents and information you have given. The full terms will be in the Employment Contract you sign on joining.',
      ...extra,
    ]);
    b.paragraph(`To accept, please sign and return a copy of this letter${t.offerValidUntil ? ` by ${formatDate(t.offerValidUntil)}, after which this offer lapses` : ''}.`);
    b.signatures([
      { label: `For ${profile.shortName || company}`, name: letter.issuedByName, sub: 'Human Resources' },
      { label: 'Accepted by', name, sub: 'Signature & date' },
    ]);
    return b.finish();
  }

  if (letter.kind === 'employment_contract') {
    const parties = [
      `This Employment Contract is made on ${issued} between ${company}${profile.address ? `, ${profile.address}` : ''} ("the Company"),`,
      `and ${name}${priv?.fatherName ? `, son / daughter of ${priv.fatherName}` : ''}${priv?.cnic ? `, CNIC ${priv.cnic}` : ''}${priv?.residentialAddress ? `, residing at ${priv.residentialAddress}` : ''} ("the Employee").`,
    ].join(' ');
    b.paragraph(parties);
    b.section('Terms and conditions');
    b.numbered([
      `Position and duties. The Employee is employed as ${t.designation} in the ${t.department} department${t.reportingTo ? `, reporting to ${t.reportingTo}` : ''}, and will perform the duties assigned from time to time, including field work at client sites.`,
      `Commencement and probation. Employment starts on ${formatDate(t.joiningDate)}. The first ${t.probationMonths} month(s), until ${probationEnd}, are a probation period. During probation either party may end this contract with ${t.noticeDaysProbation} day(s) notice. Confirmation will be given in writing.`,
      `Remuneration. The gross monthly salary is ${pkr(t.grossSalary)} as detailed below, paid monthly by bank transfer on the company payroll cycle, less income tax and other deductions required by law.`,
      `Working hours. ${t.workingHours}. Overtime, where approved, is paid as per company policy.`,
      'Attendance and leave. The Employee must mark attendance daily and be punctual. The attendance allowance is not paid for a month with two or more late marks or absences. Leave is granted as per company policy and applicable law.',
      'Safety and conduct. The Employee will follow the company SOPs, wear the uniform and protective equipment (PPE) provided, and handle, store and apply pesticides strictly as per label directions and applicable regulations. Misuse or removal of chemicals is gross misconduct.',
      'Company property. Uniforms, equipment, chemicals, devices and any vehicle provided remain company property and must be returned in good condition on request or when employment ends.',
      'Confidentiality. Client details, prices, formulas and company records are confidential, during and after employment, and may not be used or shared except for company work.',
      `Termination. After confirmation either party may end this contract with ${t.noticeDaysPermanent} day(s) notice or salary in lieu of notice. The Company may end employment without notice for gross misconduct (including theft, fraud, violence or a serious safety breach), after giving the Employee a chance to explain.`,
      'Governing law. This contract is governed by the laws of Pakistan.',
      ...extra,
    ]);
    b.section('Monthly compensation');
    b.table(['Component', 'Amount'], payRows(t.grossSalary), { columnStyles: { 1: { halign: 'right', cellWidth: 50 } } });
    b.paragraph('Both parties have read and understood this contract and sign it of their own free will.');
    b.signatures([
      { label: `For ${profile.shortName || company}`, name: letter.issuedByName, sub: 'Authorised signatory' },
      { label: 'Employee', name, sub: priv?.cnic ? `CNIC ${priv.cnic}` : 'Signature & date' },
    ]);
    b.signatures([
      { label: 'Witness 1', sub: 'Name, CNIC & signature' },
      { label: 'Witness 2', sub: 'Name, CNIC & signature' },
    ]);
    return b.finish();
  }

  // Confirmation letter
  const revised = Boolean(t.revisedGrossSalary && t.revisedGrossSalary > 0 && t.revisedGrossSalary !== t.grossSalary);
  const gross = revised ? t.revisedGrossSalary! : t.grossSalary;
  const confirmedFrom = formatDate(t.confirmationDate || letter.issuedAt);
  b.paragraph(`Dear ${name},`);
  b.paragraph(`We are pleased to inform you that you have successfully completed your probation period (${formatDate(t.joiningDate)} to ${probationEnd}). Your employment as ${t.designation} in the ${t.department} department is confirmed with effect from ${confirmedFrom}.`);
  b.keyValues([
    ['Designation', t.designation],
    ['Department', t.department],
    ['Confirmed from', confirmedFrom],
    ['Gross monthly salary', `${pkr(gross)}${revised ? ' (revised)' : ''}`],
    ['Notice period', `${t.noticeDaysPermanent} day(s)`],
  ]);
  if (extra.length) b.numbered(extra);
  b.paragraph('All other terms of your Employment Contract remain unchanged. We thank you for your work so far and wish you continued success with us.');
  b.signatures([
    { label: `For ${profile.shortName || company}`, name: letter.issuedByName, sub: 'Human Resources' },
    { label: 'Received by', name, sub: 'Signature & date' },
  ]);
  return b.finish();
}

/**
 * Client statement: one per contract billing period. Page 1 lists the period's visit invoices,
 * any earlier unpaid balance and the total due; then each visit invoice in detail.
 */
async function buildStatement(st: ClientStatement): Promise<jsPDF> {
  const draft = st.status !== 'approved';
  const { b, profile } = await builder('Invoice', st.statementNumber, draft ? 'DRAFT' : undefined, undefined, undefined, st.customerType !== 'company');
  const invoices = st.invoiceIds.map((id) => dataService.getInvoiceById(id)).filter((i): i is Invoice => Boolean(i) && i!.status !== 'void_reversed');
  const previous = st.previousInvoiceIds.map((id) => dataService.getInvoiceById(id)).filter((i): i is Invoice => Boolean(i) && i!.balanceDue > 0);
  const cycle = !st.billingCycleDays ? 'Monthly' : st.billingCycleDays === 90 ? 'Quarterly' : `Every ${st.billingCycleDays} days`;
  b.titleBand([
    { label: 'Invoice No.', value: st.statementNumber },
    ...(st.poNumber ? [{ label: 'Your PO No.', value: st.poNumber }] : []),
    { label: 'Date', value: formatDate(st.issueDate) },
    { label: 'Period', value: `${formatDate(st.periodStart)} – ${formatDate(st.periodEnd)}` },
    ...(st.contractId ? [{ label: 'Billing', value: cycle }] : []),
    { label: 'Due by', value: formatDate(st.dueDate) },
  ], st.contractId ? `Services under contract ${st.contractId}` : `${invoices.length} service job(s)`);
  b.parties(clientParty(st.customerType, st.customerId, st.customerName, st.branchId, 'Bill to'));

  b.section(`Jobs on this invoice (${invoices.length})`);
  b.table(
    ['#', 'Job invoice', 'Visit / services', 'Amount', 'Tax', 'Total'],
    invoices.map((inv, i) => [
      i + 1,
      inv.invoiceNumber.startsWith('DRAFT-') ? 'Draft' : inv.invoiceNumber,
      inv.lineItems.map((l) => l.description).join('; '),
      pkr(inv.subtotal),
      pkr(inv.taxTotal),
      pkr(inv.grossPayable),
    ]),
    { columnStyles: { 0: { cellWidth: 8, halign: 'center' }, 1: { cellWidth: 34 }, 3: { halign: 'right', cellWidth: 24 }, 4: { halign: 'right', cellWidth: 20 }, 5: { halign: 'right', cellWidth: 26 } } }
  );
  const periodTotal = invoices.reduce((s, i) => s + i.grossPayable, 0);
  const periodPaid = invoices.reduce((s, i) => s + (i.amountPaid || 0) + (i.customerWhtTotal || 0), 0);
  const previousDue = previous.reduce((s, i) => s + i.balanceDue, 0);
  if (previous.length) {
    b.section('Earlier unpaid invoices');
    b.table(
      ['Invoice No.', 'Date', 'Due', 'Balance'],
      previous.map((i) => [i.invoiceNumber, formatDate(i.issueDate), formatDate(i.dueDate), pkr(i.balanceDue)]),
      { columnStyles: { 3: { halign: 'right', cellWidth: 30 } } }
    );
  }
  b.totals([
    ['This period (incl. tax)', pkr(periodTotal)],
    ...(periodPaid > 0 ? [['Received on this period', `- ${pkr(periodPaid)}`] as [string, string]] : []),
    ...(previousDue > 0 ? [['Earlier unpaid balance', pkr(previousDue)] as [string, string]] : []),
  ], ['Total due', periodTotal - periodPaid + previousDue]);
  b.noteBox('Payment', [
    `Please pay by ${formatDate(st.dueDate)}, quoting invoice ${st.statementNumber}.`,
    'Sales tax is charged on each job invoice; this invoice totals them.',
  ]);

  // Each visit invoice in detail
  invoices.forEach((inv) => {
    b.section(`Invoice ${inv.invoiceNumber.startsWith('DRAFT-') ? '(draft)' : inv.invoiceNumber} · ${formatDate(inv.issueDate)}`, 40);
    b.table(
      ['Description', 'Qty', 'Rate', 'Tax', 'Total'],
      inv.lineItems.map((l) => [l.description, l.quantity, pkr(l.unitPrice), `${pkr(l.taxAmount)} (${l.taxRatePercent}%)`, pkr(l.totalWithTax)]),
      { columnStyles: { 1: { cellWidth: 12, halign: 'center' }, 2: { halign: 'right', cellWidth: 26 }, 3: { halign: 'right', cellWidth: 30 }, 4: { halign: 'right', cellWidth: 26 } } }
    );
  });

  b.signatures([
    { label: `For ${profile.shortName || profile.legalName}`, name: st.approvedBy || ' ', sub: draft ? 'Draft — not yet approved' : `Approved ${st.approvedAt ? formatDate(st.approvedAt) : ''}` },
    { label: 'Received by', name: ' ', sub: 'Name, signature & stamp' },
  ]);
  return b.finish();
}

/** Quality audit report by the entomologist, verified by the super admin. */
async function buildAuditReport(a: QualityAudit): Promise<jsPDF> {
  const r = a.report;
  const { b, profile } = await builder('Quality Audit Report', a.auditNumber, a.status === 'verified' ? undefined : 'DRAFT');
  const levelText: Record<string, string> = { none: 'None', low: 'Low', moderate: 'Moderate', high: 'High' };
  b.titleBand([
    { label: 'Audit No.', value: a.auditNumber },
    { label: 'Visit date', value: formatDate(r?.visitedAt || a.scheduledDate) },
    { label: 'Entomologist', value: a.entomologistName },
    { label: 'Score', value: r ? `${r.score} / 5` : '—' },
    { label: 'Status', value: a.status === 'verified' ? 'Verified' : statusLabel(a.status) },
  ], 'Independent pest management quality audit');
  b.parties(clientParty(a.customerType, a.customerId, a.customerName, a.branchId), {
    heading: 'Audited site',
    name: a.siteName,
    lines: [
      a.siteAddress,
      a.contractId && `Contract: ${a.contractId}`,
      a.lastJobDate && `Last service visit: ${formatDate(a.lastJobDate)}${a.lastJobId ? ` (${a.lastJobId})` : ''}`,
    ],
  });
  if (!r) {
    b.noteBox('Report', ['The entomologist has not submitted the report yet.']);
    return b.finish();
  }
  if (r.summary) {
    b.section('Summary');
    b.paragraph(r.summary);
  }
  if (r.pestActivity.length) {
    b.section('Pest activity found');
    b.table(['#', 'Area', 'Pest', 'Activity', 'Notes'],
      r.pestActivity.map((p, i) => [i + 1, p.area, p.pest, levelText[p.level] || p.level, p.notes || '']),
      { columnStyles: { 0: { cellWidth: 8, halign: 'center' }, 3: { cellWidth: 22 } } });
  }
  if (r.checks.length) {
    b.section('Service quality checks');
    b.table(['#', 'Check', 'Result', 'Notes'],
      r.checks.map((c, i) => [i + 1, c.item, c.ok === undefined ? '—' : c.ok ? 'OK' : 'Not OK', c.notes || '']),
      {
        columnStyles: { 0: { cellWidth: 8, halign: 'center' }, 2: { cellWidth: 20 }, 3: { cellWidth: 50 } },
        didParseCell: (d) => {
          if (d.section === 'body' && d.column.index === 2) d.cell.styles.textColor = d.cell.raw === 'OK' ? b.brand : d.cell.raw === 'Not OK' ? [220, 38, 38] : [100, 116, 139];
        },
      });
  }
  if (r.findings.length) {
    b.section('Findings and recommendations');
    b.table(['#', 'Observation', 'Risk', 'Recommendation'],
      r.findings.map((f, i) => [i + 1, f.observation, statusLabel(f.risk), f.recommendation]),
      { columnStyles: { 0: { cellWidth: 8, halign: 'center' }, 2: { cellWidth: 18 } } });
  }
  const photos = (await Promise.all(r.photos.slice(0, 8).map(async (p) => {
    const img = await loadImage(p.url, 900);
    return img ? { img, caption: p.caption || 'Audit photo' } : null;
  }))).filter(Boolean) as { img: Img; caption: string }[];
  if (photos.length) {
    b.section('Photo evidence', 72);
    b.photos(photos);
  }
  if (a.status === 'verified') {
    b.section('Verification');
    b.keyValues([['Verified by', a.verifiedBy], ['Verified on', a.verifiedAt ? formatDate(a.verifiedAt) : undefined], ['Notes', a.verifierNote]]);
  }
  b.signatures([
    { label: 'Entomologist', name: a.entomologistName, sub: profile.shortName || profile.legalName },
    { label: 'Verified by', name: a.verifiedBy || ' ', sub: 'For the management' },
  ]);
  return b.finish();
}

/** Risk assessment report: picture evidence, observation, risk and recommendation per finding. */
async function buildMeetingReport(lead: Lead): Promise<jsPDF> {
  const i = lead.inspection;
  const client = lead.companyName || lead.title;
  const title = 'Client Meeting Report';
  const meetingDate = i?.completedDate || i?.scheduledDate || lead.updatedAt;
  const { b, profile } = await builder(title, i?.id || `MTG-${lead.id}`, undefined, undefined, {
    type: 'inspection_report', issued: meetingDate, client,
    clientIsPerson: lead.customerType !== 'company', status: i?.status || 'completed',
  });
  const primary = lead.contacts?.find((c) => c.isPrimary) ?? lead.contacts?.[0];
  const conductedBy = i?.inspectorName || i?.assignedTeamLeaderName || 'Operations Staff';
  b.titleBand(
    [
      { label: 'Meeting No.', value: i?.id || `MTG-${lead.id}` },
      { label: 'Date', value: formatDate(meetingDate) },
      { label: 'Meeting Type', value: i?.meetingType ? i.meetingType.toUpperCase() : 'CLIENT MEETING' },
      { label: 'Conducted By', value: conductedBy },
      { label: 'Client Rep', value: i?.observedBy || primary?.name || '—' },
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
    { heading: 'Meeting Location', name: i?.siteName || lead.propertyAddress || [lead.area, lead.city].filter(Boolean).join(', ') || 'Client Facility', lines: [lead.propertyAddress] }
  );

  const decisionLabel = i?.tlStatus === 'send_proposal' ? 'Send Proposal (Approved)' : 'Completed';
  b.keyValues([
    ['Meeting Outcome', decisionLabel],
    ['Pests Discussed', (i?.pestTypesFound?.length ? i.pestTypesFound : lead.pestIssues ?? []).map((p) => statusLabel(p)).join(', ') || 'General Pest Control'],
    ['Treatment Scope', i?.recommendedTreatment || 'General treatment'],
    ['Follow-up Actions', i?.meetingFollowUps?.length ? i.meetingFollowUps.join(', ') : 'Prepare formal commercial proposal'],
  ]);

  if (i?.teamLeaderNotes || i?.meetingReportNote) {
    b.section('Meeting Discussion & Findings');
    b.paragraph([i.meetingReportNote, i.teamLeaderNotes].filter(Boolean).join('\n\n'));
  }

  if (lead.branches?.length) {
    b.section('Sites / Facility Locations Discussed');
    b.table(['#', 'Branch / Site Name', 'Address'], lead.branches.map((br, idx) => [idx + 1, br.name, br.address || '—']));
  }

  b.noteBox('Next Step & Action Items', [
    'CRO Department will prepare and issue the comprehensive commercial proposal.'
  ], b.brandTint);

  b.signatures([
    { label: 'Report Prepared by', name: conductedBy },
    { label: 'Client Acknowledgment', name: i?.observedBy || primary?.name || ' ' },
  ]);

  return b.finish();
}

async function buildInspectionReport(lead: Lead): Promise<jsPDF> {
  const i = lead.inspection;
  const si = lead.siteInspection;
  const findings = i?.findings ?? si?.findings ?? [];
  const client = lead.companyName || lead.title;
  const title = findings.length ? 'Risk Assessment Report' : 'Site Inspection Report';
  const completedDate = i?.completedDate || si?.completedDate;
  const scheduledDate = i?.scheduledDate || si?.scheduledDate;
  const isDone = i?.status === 'completed' || si?.status === 'completed';
  const { b, profile } = await builder(title, i?.id || si?.id || lead.id, isDone ? undefined : 'SCHEDULED', undefined, {
    type: 'inspection_report', issued: completedDate || scheduledDate || lead.createdAt, client,
    clientIsPerson: lead.customerType !== 'company', status: isDone ? 'completed' : 'scheduled',
  });
  const primary = lead.contacts?.find((c) => c.isPrimary) ?? lead.contacts?.[0];
  const preparedBy = i?.findingsBy || i?.inspectorNames?.join(', ') || i?.inspectorName || si?.teamLeaderName || si?.assignedTechNames?.join(', ') || 'Staff';
  b.titleBand(
    [
      { label: 'Report No.', value: i?.id || si?.id || '—' },
      { label: 'Date', value: formatDate(completedDate || scheduledDate) },
      { label: 'Branch / site', value: i?.siteName || si?.branchName || [lead.area, lead.city].filter(Boolean).join(', ') || '—' },
      { label: 'Prepared by', value: preparedBy },
      { label: 'Observed by', value: i?.observedBy || si?.observedBy || '—' },
    ],
    i?.reportTitle || si?.reportTitle || `${title} - ${client}`
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
    { heading: 'Inspected site', name: i?.siteName || si?.branchName || [lead.area, lead.city].filter(Boolean).join(', ') || lead.city, lines: [lead.propertyAddress, i?.teamName && `Team: ${i.teamName}`].filter(Boolean) as string[] }
  );

  const activePests = i?.pestTypesFound ?? si?.pestTypesFound ?? [];
  const activeSeverity = i?.infestationSeverity ?? si?.infestationSeverity ?? 'moderate';
  const activeArea = i?.areaSqFt ?? si?.areaSqFt;
  b.keyValues([
    ['Pests identified', activePests.map((p) => statusLabel(p)).join(', ') || 'None reported'],
    ['Infestation level', statusLabel(activeSeverity)],
    ['Area inspected', activeArea ? `${activeArea.toLocaleString()} sq ft` : undefined],
    ['Status', isDone ? 'Completed' : 'Scheduled'],
  ]);

  if (findings.length) {
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
    const recTr = i?.recommendedTreatment || si?.recommendedTreatment;
    if (recTr) {
      b.section('Recommended treatment');
      b.paragraph(recTr);
    }
  } else {
    const crit = i?.criticalFindings || si?.criticalFindings;
    b.section('Findings');
    b.paragraph(crit || 'Findings pending.');
    const recTr = i?.recommendedTreatment || si?.recommendedTreatment;
    if (recTr) {
      b.section('Recommended treatment');
      b.paragraph(recTr);
    }
  }

  const general = i?.photos?.length ? i.photos : (si?.photos?.length ? si.photos : (findings.length ? [] : lead.sitePhotos ?? []));
  const photos = await photoItems(general, (p) => p.caption || statusLabel(p.type));
  if (photos.length) {
    b.section('Site photos', 72);
    b.photos(photos);
  }
  b.noteBox('Next step', [`${profile.legalName} will share a detailed proposal with pricing based on these findings.`], b.brandTint);
  b.signatures([
    { label: 'Prepared by', name: preparedBy },
    { label: 'Observed by', name: i?.observedBy || si?.observedBy || primary?.name || ' ', sub: (i?.observedBy || si?.observedBy) ? undefined : primary?.designation },
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
  // Quality audit reports (entomologist)
  async auditReportPDFBlob(audit: QualityAudit): Promise<Blob> {
    return (await buildAuditReport(audit)).output('blob');
  },
  async generateAuditReportPDF(audit: QualityAudit) {
    (await buildAuditReport(audit)).save(safe(`${prefix()}_Quality_Audit_${audit.auditNumber}_${audit.customerName}.pdf`));
  },
  // Client statements (one per contract billing period)
  async statementPDFBlob(statement: ClientStatement): Promise<Blob> {
    return (await buildStatement(statement)).output('blob');
  },
  async generateStatementPDF(statement: ClientStatement) {
    (await buildStatement(statement)).save(safe(`${prefix()}_Statement_${statement.statementNumber}_${statement.customerName}.pdf`));
  },
  // HR letters (offer letter, employment contract, confirmation letter)
  employeeLetterFileName(letter: EmployeeLetter) {
    const kind = { offer_letter: 'Offer_Letter', employment_contract: 'Employment_Contract', confirmation_letter: 'Confirmation_Letter' }[letter.kind];
    return safe(`${prefix()}_${kind}_${letter.employeeId}_${letter.employeeName}.pdf`);
  },
  async generateEmployeeLetterPDF(letter: EmployeeLetter) {
    (await buildEmployeeLetter(letter)).save(this.employeeLetterFileName(letter));
  },
  async employeeLetterPDFBlob(letter: EmployeeLetter): Promise<Blob> {
    return (await buildEmployeeLetter(letter)).output('blob');
  },
  /** Work order for a visit that isn't finished / verified yet (the report itself is not available then). */
  async generateJobSheetPDF(job: ServiceJob) {
    (await buildJobSheet(job)).save(safe(`${prefix()}_Job_Sheet_${job.id}_${job.customerName}.pdf`));
  },
  /** The full service report exists only once the visit is completed and has passed the quality check. */
  isJobReportReady(job: Pick<ServiceJob, 'status' | 'supervisorVerification'>) {
    return job.status === 'completed' && Boolean(job.supervisorVerification?.isVerified);
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
    const kind = (lead.siteInspection?.findings?.length || lead.inspection?.findings?.length) ? 'Risk_Assessment' : 'Inspection';
    const id = lead.siteInspection?.id || lead.inspection?.id || lead.id;
    return safe(`${prefix()}_${kind}_${id}_${lead.companyName || lead.title}.pdf`);
  },

  async generateMeetingReportPDF(lead: Lead) {
    (await buildMeetingReport(lead)).save(this.meetingReportFileName(lead));
  },
  async meetingReportPDFBlob(lead: Lead): Promise<Blob> {
    return (await buildMeetingReport(lead)).output('blob');
  },
  meetingReportFileName(lead: Lead) {
    const id = lead.inspection?.id || lead.id;
    return safe(`${prefix()}_Meeting_Report_${id}_${lead.companyName || lead.title}.pdf`);
  },
};
