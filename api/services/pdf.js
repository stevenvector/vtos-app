/* =====================================================
   VTOS — Proposal PDF Generator (pdfkit)
   ===================================================== */
'use strict';

const PDFDocument = require('pdfkit');

// ── Colours ───────────────────────────────────────────
const C = {
  bg:      '#0d0d14',
  surface: '#111118',
  green:   '#39FF14',
  blue:    '#1E6FD9',
  text:    '#1a1a2e',
  muted:   '#6b7280',
  border:  '#e5e7eb',
  stripe:  '#f9fafb',
  white:   '#ffffff',
  red:     '#dc2626',
};

// A4 in points
const PAGE_W  = 595.28;
const PAGE_H  = 841.89;
const MARGIN  = 48;
const CONTENT = PAGE_W - MARGIN * 2;

// Last y-coord we may draw at before bumping into the footer band.
// Footer is 52pt + a 20pt cushion.
const SAFE_BOTTOM = PAGE_H - 52 - 20;

function fmt(n) { return `R ${parseFloat(n || 0).toFixed(2)}`; }
function fmtDate(s) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('en-ZA', { day: '2-digit', month: 'long', year: 'numeric' });
}

// ── Draw a filled rectangle ───────────────────────────
function rect(doc, x, y, w, h, colour) {
  doc.rect(x, y, w, h).fill(colour);
}

// ── Horizontal rule ───────────────────────────────────
function rule(doc, y, colour = C.border, weight = 0.5) {
  doc.moveTo(MARGIN, y).lineTo(PAGE_W - MARGIN, y)
     .strokeColor(colour).lineWidth(weight).stroke();
}

// ── Label + value pair ────────────────────────────────
function labelValue(doc, label, value, x, y, opts = {}) {
  doc.fillColor(C.muted).font('Helvetica').fontSize(8)
     .text(label.toUpperCase(), x, y, { width: opts.width || 200 });
  doc.fillColor(opts.valueColor || C.text).font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.size || 10)
     .text(value, x, y + 11, { width: opts.width || 200 });
  return y + 11 + (opts.size || 10) + 4;
}

// ── Document kinds ────────────────────────────────────
// One renderer serves both the quote (proposal) and invoice PDFs — the
// differences are the number field, banner label and the deadline field.
const DOC_KINDS = {
  quote: {
    banner:    'FORMAL QUOTATION',
    subject:   'Formal Quotation',
    numberOf:  d => d.quote_number,
    dateLabel: 'VALID UNTIL',
    dateOf:    d => d.valid_until,
  },
  invoice: {
    banner:    'INVOICE',
    subject:   'Invoice',
    numberOf:  d => d.invoice_number,
    dateLabel: 'DUE DATE',
    dateOf:    d => d.due_date,
  },
};

// ── Main renderer ─────────────────────────────────────
function generateDocumentPDF(proposal, kindName = 'quote') {
  const kind      = DOC_KINDS[kindName] || DOC_KINDS.quote;
  const docNumber = kind.numberOf(proposal);
  return new Promise((resolve, reject) => {
    const doc    = new PDFDocument({
      size:        'A4',
      margin:      0,
      bufferPages: true, // needed so we can stamp the footer on every page at the end
      info: {
        Title:   `${docNumber} — ${proposal.title}`,
        Author:  'VTOS — Vector Online Solutions',
        Subject: kind.subject,
      },
    });
    const chunks = [];
    doc.on('data',  c  => chunks.push(c));
    doc.on('end',   () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const items = Array.isArray(proposal.items)
      ? proposal.items
      : JSON.parse(proposal.items || '[]');

    const subtotal   = parseFloat(proposal.subtotal) || 0;
    const discount   = parseFloat(proposal.discount) || 0;
    const taxRate    = parseFloat(proposal.tax_rate)  || 0;
    const taxAmt     = (subtotal - discount) * (taxRate / 100);
    const total      = parseFloat(proposal.total)    || 0;

    // ══ HEADER BAND ══════════════════════════════════════
    rect(doc, 0, 0, PAGE_W, 72, C.surface);
    rect(doc, 0, 72, PAGE_W, 4, C.green);   // green underline

    // VTOS wordmark
    doc.fillColor(C.green).font('Helvetica-Bold').fontSize(26)
       .text('VTOS', MARGIN, 22, { continued: false });
    doc.fillColor('#9ca3af').font('Helvetica').fontSize(10)
       .text('Vector Online Solutions', MARGIN, 50);

    // Document number — top right
    doc.fillColor('#9ca3af').font('Helvetica').fontSize(9)
       .text(docNumber, MARGIN, 28, { width: CONTENT, align: 'right' });
    doc.fillColor(C.green).font('Helvetica-Bold').fontSize(9)
       .text(kind.banner, MARGIN, 42, { width: CONTENT, align: 'right' });

    let y = 96;

    // ══ TITLE ════════════════════════════════════════════
    doc.fillColor(C.text).font('Helvetica-Bold').fontSize(20)
       .text(proposal.title, MARGIN, y, { width: CONTENT });
    y = doc.y + 20;

    // ══ CLIENT & DATE BLOCK ═══════════════════════════════
    const halfW = CONTENT / 2 - 10;

    // Client
    labelValue(doc, 'Prepared for', proposal.client_name, MARGIN, y, { bold: true, size: 11 });
    let yL = doc.y + 2;
    if (proposal.client_company) {
      doc.fillColor(C.muted).font('Helvetica').fontSize(10)
         .text(proposal.client_company, MARGIN, yL);
      yL = doc.y + 2;
    }
    doc.fillColor(C.blue).font('Helvetica').fontSize(10)
       .text(proposal.client_email, MARGIN, yL);
    const yAfterClient = doc.y + 2;

    // Date / valid until (right column)
    const rx = MARGIN + halfW + 20;
    labelValue(doc, 'Issue Date', fmtDate(proposal.created_at), rx, y, { bold: false, size: 10 });
    let yR = doc.y + 8;
    const deadline = kind.dateOf(proposal);
    if (deadline) {
      doc.fillColor(C.muted).font('Helvetica').fontSize(8)
         .text(kind.dateLabel, rx, yR);
      doc.fillColor(C.red).font('Helvetica-Bold').fontSize(10)
         .text(fmtDate(deadline), rx, yR + 11);
    }

    y = Math.max(yAfterClient, doc.y) + 20;

    // ══ SECTION RULE ═════════════════════════════════════
    rule(doc, y, C.border, 1);
    y += 16;

    // ══ LINE ITEMS TABLE ══════════════════════════════════
    // Column x positions & widths
    const c = {
      desc:  { x: MARGIN,                  w: CONTENT * 0.50 },
      qty:   { x: MARGIN + CONTENT * 0.50, w: CONTENT * 0.10 },
      price: { x: MARGIN + CONTENT * 0.60, w: CONTENT * 0.20 },
      total: { x: MARGIN + CONTENT * 0.80, w: CONTENT * 0.20 },
    };

    // Helper: draw the table header band at a given y. Returns the new y.
    const drawTableHeader = (atY) => {
      rect(doc, MARGIN, atY, CONTENT, 22, '#1f2937');
      const thY = atY + 7;
      doc.fillColor('#9ca3af').font('Helvetica-Bold').fontSize(8);
      doc.text('DESCRIPTION',  c.desc.x  + 6, thY, { width: c.desc.w  - 6 });
      doc.text('QTY',          c.qty.x   + 4, thY, { width: c.qty.w   - 4, align: 'center' });
      doc.text('UNIT PRICE',   c.price.x + 4, thY, { width: c.price.w - 4, align: 'right' });
      doc.text('LINE TOTAL',   c.total.x + 4, thY, { width: c.total.w - 8, align: 'right' });
      return atY + 22;
    };

    // Helper: start a fresh page for table continuation. Returns new y.
    const continueTableOnNewPage = () => {
      doc.addPage();
      // Mini continuation header so the reader knows it's the same quote.
      doc.fillColor(C.muted).font('Helvetica').fontSize(9)
         .text(`${docNumber} — ${proposal.title} (continued)`,
               MARGIN, MARGIN, { width: CONTENT, align: 'right' });
      return drawTableHeader(MARGIN + 24);
    };

    // Table header
    y = drawTableHeader(y);

    // Line items — paginate when a row would cross SAFE_BOTTOM.
    items.forEach((item, i) => {
      const rowH = 22;
      if (y + rowH > SAFE_BOTTOM) {
        y = continueTableOnNewPage();
      }
      const lineTotal = (parseInt(item.quantity, 10) || 0) * (parseFloat(item.unit_price) || 0);

      // Alternate stripe
      if (i % 2 === 1) rect(doc, MARGIN, y, CONTENT, rowH, C.stripe);

      const tyR = y + 7;
      doc.fillColor(C.text).font('Helvetica').fontSize(10)
         .text(item.description || '', c.desc.x + 6, tyR, { width: c.desc.w - 12 });
      doc.text(String(parseInt(item.quantity, 10) || 1),
               c.qty.x + 4, tyR, { width: c.qty.w - 4, align: 'center' });
      doc.fillColor(C.muted)
         .text(fmt(item.unit_price), c.price.x + 4, tyR, { width: c.price.w - 4, align: 'right' });
      doc.fillColor(C.blue).font('Helvetica-Bold')
         .text(fmt(lineTotal), c.total.x + 4, tyR, { width: c.total.w - 8, align: 'right' });

      y += rowH;
    });

    // ══ TOTALS BLOCK ══════════════════════════════════════
    // Totals + grand total need ~110pt of headroom — push to a new page
    // if we're already too close to the footer.
    if (y + 110 > SAFE_BOTTOM) {
      doc.addPage();
      y = MARGIN;
    }
    y += 10;
    rule(doc, y, C.border, 0.5);
    y += 14;

    const totX  = MARGIN + CONTENT * 0.55;
    const totW  = CONTENT * 0.45;
    const labW  = totW * 0.55;
    const numW  = totW * 0.45;
    const numX  = totX + labW;
    const rowH  = 18;

    const totRow = (label, value, opts = {}) => {
      doc.fillColor(opts.labelColor || C.muted)
         .font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
         .fontSize(opts.size || 10)
         .text(label, totX, y, { width: labW });
      doc.fillColor(opts.numColor || C.text)
         .font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
         .fontSize(opts.size || 10)
         .text(value, numX, y, { width: numW, align: 'right' });
      y += rowH;
    };

    totRow('Subtotal', fmt(subtotal));
    if (discount > 0)  totRow('Discount', `-R ${discount.toFixed(2)}`, { numColor: C.red });
    if (taxRate > 0)   totRow(`VAT / Tax (${taxRate}%)`, fmt(taxAmt));

    // Grand total highlighted band
    y += 4;
    rect(doc, totX - 8, y - 4, totW + 8, 30, C.surface);
    doc.fillColor('#9ca3af').font('Helvetica-Bold').fontSize(10)
       .text('TOTAL DUE', totX, y + 6, { width: labW });
    doc.fillColor(C.green).font('Helvetica-Bold').fontSize(14)
       .text(fmt(total), numX, y + 4, { width: numW, align: 'right' });
    y += 38;

    // ══ BANKING / PAYMENT DETAILS ═════════════════════════
    const banking = (() => {
      const b = proposal.banking_details;
      if (!b) return null;
      try { return typeof b === 'string' ? JSON.parse(b) : b; }
      catch { return null; }
    })();

    if (banking && Object.keys(banking).length) {
      const rows = [
        ['Bank',           banking.bank_name],
        ['Account Holder', banking.account_holder],
        ['Account Number', banking.account_number],
        ['Account Type',   banking.account_type],
        ['Branch Code',    banking.branch_code],
        ['Reference',      banking.reference || docNumber],
      ].filter(([, v]) => v);

      const perCol   = Math.ceil(rows.length / 2);
      const boxH     = 34 + perCol * 28;

      if (y + boxH + 10 > SAFE_BOTTOM) {
        doc.addPage();
        y = MARGIN;
      }

      rect(doc, MARGIN, y, CONTENT, boxH, C.stripe);
      doc.rect(MARGIN, y, CONTENT, boxH).strokeColor(C.border).lineWidth(0.5).stroke();
      rect(doc, MARGIN, y, 3, boxH, C.green);

      doc.fillColor(C.text).font('Helvetica-Bold').fontSize(9)
         .text('PAYMENT DETAILS', MARGIN + 16, y + 12);

      const colW = (CONTENT - 32) / 2;
      rows.forEach(([label, value], i) => {
        const cx = MARGIN + 16 + (i < perCol ? 0 : colW);
        const cy = y + 30 + (i % perCol) * 28;
        doc.fillColor(C.muted).font('Helvetica').fontSize(7.5)
           .text(label.toUpperCase(), cx, cy, { width: colW - 12 });
        doc.fillColor(C.text).font('Helvetica-Bold').fontSize(10)
           .text(String(value), cx, cy + 10, { width: colW - 12 });
      });

      y += boxH + 14;
    }

    // ══ NOTES ═════════════════════════════════════════════
    if (proposal.notes) {
      // Break to a new page if the notes header itself wouldn't fit.
      if (y + 40 > SAFE_BOTTOM) {
        doc.addPage();
        y = MARGIN;
      }
      y += 10;
      rule(doc, y, C.border, 0.5);
      y += 14;
      doc.fillColor(C.muted).font('Helvetica-Bold').fontSize(8)
         .text('NOTES & TERMS', MARGIN, y);
      y += 13;
      // Constrain text height so a very long notes block paginates cleanly
      // via pdfkit's built-in flow rather than overlapping the footer.
      doc.fillColor(C.text).font('Helvetica').fontSize(10)
         .text(proposal.notes, MARGIN, y, {
           width:  CONTENT,
           height: SAFE_BOTTOM - y,
         });
    }

    // ══ FOOTER BAND ═══════════════════════════════════════
    // Draw the footer on every page so the bottom band is consistent.
    const drawFooter = () => {
      const footerY = PAGE_H - 52;
      rect(doc, 0, footerY, PAGE_W, 52, C.surface);
      rect(doc, 0, footerY, PAGE_W, 3, C.green);
      doc.fillColor('#6b7280').font('Helvetica').fontSize(8.5)
         .text(
           `Vector Online Solutions  ·  info@vtos.co.za  ·  +27 71 360 1539  ·  +27 82 975 0630  ·  ${(process.env.APP_URL || 'https://vtos.vercel.app').replace(/^https?:\/\//, '')}`,
           MARGIN, footerY + 12, { width: CONTENT, align: 'center' }
         );
      doc.fillColor('#374151').font('Helvetica').fontSize(8)
         .text(
           `${docNumber}  ·  Generated by VTOS`,
           MARGIN, footerY + 30, { width: CONTENT, align: 'center' }
         );
    };

    // Iterate through all pages and stamp the footer.
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      drawFooter();
    }

    doc.end();
  });
}

const generateProposalPDF = (proposal) => generateDocumentPDF(proposal, 'quote');
const generateInvoicePDF  = (invoice)  => generateDocumentPDF(invoice,  'invoice');

// ══════════════════════════════════════════════════════
//  Narrative documents (Client Reports / Work Proposals)
// ══════════════════════════════════════════════════════
// Unlike the line-item PDFs above (margin:0, absolute layout), these
// carry long flowing text, so we give pdfkit real margins and let it
// auto-paginate. A 'pageAdded' handler stamps a continuation strip and
// resets the cursor below it; the footer band is stamped on every page
// at the end (with bottom margin zeroed so the stamp itself can't
// trigger another page break).

const FLOW_TOP    = 64;  // top margin on continuation pages (clears the strip)
const FLOW_BOTTOM = 84;  // bottom margin (clears the 52pt footer band + cushion)
const FLOW_MAX_Y  = PAGE_H - FLOW_BOTTOM;

function makeFlowDoc(info, continuationLabel) {
  const doc = new PDFDocument({
    size:        'A4',
    margins:     { top: FLOW_TOP, bottom: FLOW_BOTTOM, left: MARGIN, right: MARGIN },
    bufferPages: true,
    info,
  });
  doc.on('pageAdded', () => {
    doc.fillColor(C.muted).font('Helvetica').fontSize(9)
       .text(continuationLabel, MARGIN, 24, { width: CONTENT, align: 'right', lineBreak: false });
    doc.x = MARGIN;
    doc.y = FLOW_TOP;
  });
  return doc;
}

function drawFlowHeaderBand(doc, number, kindLabel) {
  rect(doc, 0, 0, PAGE_W, 72, C.surface);
  rect(doc, 0, 72, PAGE_W, 4, C.green);
  doc.fillColor(C.green).font('Helvetica-Bold').fontSize(26)
     .text('VTOS', MARGIN, 22, { lineBreak: false });
  doc.fillColor('#9ca3af').font('Helvetica').fontSize(10)
     .text('Vector Online Solutions', MARGIN, 50, { lineBreak: false });
  doc.fillColor('#9ca3af').font('Helvetica').fontSize(9)
     .text(number, MARGIN, 28, { width: CONTENT, align: 'right', lineBreak: false });
  doc.fillColor(C.green).font('Helvetica-Bold').fontSize(9)
     .text(kindLabel, MARGIN, 42, { width: CONTENT, align: 'right', lineBreak: false });
}

function stampFlowFooters(doc, number) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0; // so the footer stamp can't trigger a page break
    const footerY = PAGE_H - 52;
    rect(doc, 0, footerY, PAGE_W, 52, C.surface);
    rect(doc, 0, footerY, PAGE_W, 3, C.green);
    doc.fillColor('#6b7280').font('Helvetica').fontSize(8.5)
       .text(
         `Vector Online Solutions  ·  info@vtos.co.za  ·  +27 71 360 1539  ·  +27 82 975 0630  ·  ${(process.env.APP_URL || 'https://vtos.vercel.app').replace(/^https?:\/\//, '')}`,
         MARGIN, footerY + 12, { width: CONTENT, align: 'center', lineBreak: false }
       );
    doc.fillColor('#374151').font('Helvetica').fontSize(8)
       .text(
         `${number}  ·  Page ${i - range.start + 1} of ${range.count}  ·  Generated by VTOS`,
         MARGIN, footerY + 30, { width: CONTENT, align: 'center', lineBreak: false }
       );
  }
}

// Break early if fewer than `needed` points remain — keeps headings from
// being orphaned at the bottom of a page.
function ensureRoom(doc, needed) {
  if (doc.y + needed > FLOW_MAX_Y) doc.addPage();
}

// ── Client Report PDF ─────────────────────────────────
const REPORT_TYPE_LABELS = {
  general:     'CLIENT REPORT',
  progress:    'PROGRESS REPORT',
  completion:  'COMPLETION REPORT',
  diagnostic:  'DIAGNOSTIC REPORT',
  maintenance: 'MAINTENANCE REPORT',
};

function generateReportPDF(report) {
  return new Promise((resolve, reject) => {
    const kindLabel = REPORT_TYPE_LABELS[report.report_type] || 'CLIENT REPORT';
    const doc = makeFlowDoc(
      {
        Title:   `${report.report_number} — ${report.title}`,
        Author:  'VTOS — Vector Online Solutions',
        Subject: kindLabel,
      },
      `${report.report_number} — ${report.title} (continued)`
    );
    const chunks = [];
    doc.on('data',  c  => chunks.push(c));
    doc.on('end',   () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const sections = Array.isArray(report.sections)
      ? report.sections
      : JSON.parse(report.sections || '[]');

    drawFlowHeaderBand(doc, report.report_number, kindLabel);

    // ── Title + meta ──
    doc.x = MARGIN;
    doc.y = 96;
    doc.fillColor(C.text).font('Helvetica-Bold').fontSize(20)
       .text(report.title, { width: CONTENT });
    doc.y += 16;

    let y = doc.y;
    labelValue(doc, 'Prepared for', report.client_name, MARGIN, y, { bold: true, size: 11 });
    let yL = doc.y + 2;
    if (report.client_company) {
      doc.fillColor(C.muted).font('Helvetica').fontSize(10)
         .text(report.client_company, MARGIN, yL);
      yL = doc.y + 2;
    }
    doc.fillColor(C.blue).font('Helvetica').fontSize(10)
       .text(report.client_email, MARGIN, yL);
    const yAfterClient = doc.y;

    const rx = MARGIN + CONTENT / 2 + 10;
    labelValue(doc, 'Report Date', fmtDate(report.report_date || report.created_at), rx, y, { size: 10 });

    doc.x = MARGIN;
    doc.y = Math.max(yAfterClient, doc.y) + 16;

    // ── Summary (optional) ──
    if (report.summary) {
      ensureRoom(doc, 70);
      rule(doc, doc.y, C.border, 1);
      doc.y += 14;
      doc.fillColor(C.muted).font('Helvetica-Bold').fontSize(8)
         .text('EXECUTIVE SUMMARY', MARGIN, doc.y);
      doc.y += 5;
      doc.fillColor(C.text).font('Helvetica').fontSize(10)
         .text(report.summary, MARGIN, doc.y, { width: CONTENT, lineGap: 2 });
      doc.y += 10;
    }

    // ── Sections ──
    sections.forEach((s, i) => {
      ensureRoom(doc, 80); // heading + at least a couple of lines together
      rule(doc, doc.y, C.border, 0.5);
      doc.y += 14;
      doc.fillColor(C.green).font('Helvetica-Bold').fontSize(9)
         .text(String(i + 1).padStart(2, '0'), MARGIN, doc.y, { continued: true, lineBreak: false });
      doc.fillColor(C.text).font('Helvetica-Bold').fontSize(12)
         .text(`   ${s.heading || ''}`, { width: CONTENT });
      doc.y += 6;
      doc.fillColor(C.text).font('Helvetica').fontSize(10)
         .text(s.body || '', MARGIN, doc.y, { width: CONTENT, lineGap: 2 });
      doc.y += 14;
    });

    stampFlowFooters(doc, report.report_number);
    doc.end();
  });
}

// ── Work Proposal PDF ─────────────────────────────────
function generateWorkProposalPDF(proposal) {
  return new Promise((resolve, reject) => {
    const doc = makeFlowDoc(
      {
        Title:   `${proposal.proposal_number} — ${proposal.title}`,
        Author:  'VTOS — Vector Online Solutions',
        Subject: 'Work Proposal',
      },
      `${proposal.proposal_number} — ${proposal.title} (continued)`
    );
    const chunks = [];
    doc.on('data',  c  => chunks.push(c));
    doc.on('end',   () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const items = Array.isArray(proposal.work_items)
      ? proposal.work_items
      : JSON.parse(proposal.work_items || '[]');

    drawFlowHeaderBand(doc, proposal.proposal_number, 'WORK PROPOSAL');

    // ── Title + meta ──
    doc.x = MARGIN;
    doc.y = 96;
    doc.fillColor(C.text).font('Helvetica-Bold').fontSize(20)
       .text(proposal.title, { width: CONTENT });
    doc.y += 16;

    let y = doc.y;
    labelValue(doc, 'Prepared for', proposal.client_name, MARGIN, y, { bold: true, size: 11 });
    let yL = doc.y + 2;
    if (proposal.client_company) {
      doc.fillColor(C.muted).font('Helvetica').fontSize(10)
         .text(proposal.client_company, MARGIN, yL);
      yL = doc.y + 2;
    }
    doc.fillColor(C.blue).font('Helvetica').fontSize(10)
       .text(proposal.client_email, MARGIN, yL);
    const yAfterClient = doc.y;

    const rx = MARGIN + CONTENT / 2 + 10;
    labelValue(doc, 'Issue Date', fmtDate(proposal.created_at), rx, y, { size: 10 });
    if (proposal.valid_until) {
      const yR = doc.y + 8;
      doc.fillColor(C.muted).font('Helvetica').fontSize(8)
         .text('VALID UNTIL', rx, yR);
      doc.fillColor(C.red).font('Helvetica-Bold').fontSize(10)
         .text(fmtDate(proposal.valid_until), rx, yR + 11);
    }

    doc.x = MARGIN;
    doc.y = Math.max(yAfterClient, doc.y) + 16;

    // ── Overview (optional) ──
    if (proposal.overview) {
      ensureRoom(doc, 70);
      rule(doc, doc.y, C.border, 1);
      doc.y += 14;
      doc.fillColor(C.muted).font('Helvetica-Bold').fontSize(8)
         .text('OVERVIEW', MARGIN, doc.y);
      doc.y += 5;
      doc.fillColor(C.text).font('Helvetica').fontSize(10)
         .text(proposal.overview, MARGIN, doc.y, { width: CONTENT, lineGap: 2 });
      doc.y += 10;
    }

    // ── Proposed work items ──
    ensureRoom(doc, 60);
    rule(doc, doc.y, C.border, 1);
    doc.y += 14;
    doc.fillColor(C.muted).font('Helvetica-Bold').fontSize(8)
       .text('PROPOSED WORK', MARGIN, doc.y);
    doc.y += 10;

    items.forEach((item, i) => {
      ensureRoom(doc, 90); // number chip + title + a few lines together

      // Number chip + title row
      const chipY = doc.y;
      rect(doc, MARGIN, chipY, 22, 22, C.surface);
      doc.fillColor(C.green).font('Helvetica-Bold').fontSize(11)
         .text(String(i + 1), MARGIN, chipY + 5, { width: 22, align: 'center', lineBreak: false });
      doc.fillColor(C.text).font('Helvetica-Bold').fontSize(12)
         .text(item.title || '', MARGIN + 32, chipY + 4, { width: CONTENT - 32 });
      doc.y = Math.max(doc.y, chipY + 22) + 6;

      // Description (flows/paginates)
      doc.fillColor(C.text).font('Helvetica').fontSize(10)
         .text(item.description || '', MARGIN + 32, doc.y, { width: CONTENT - 32, lineGap: 2 });
      doc.y += 5;

      // Timeline / estimate meta line
      const metaBits = [
        item.timeline ? `Timeline: ${item.timeline}` : null,
        item.estimate ? `Estimate: ${item.estimate}` : null,
      ].filter(Boolean);
      if (metaBits.length) {
        ensureRoom(doc, 20);
        doc.fillColor(C.blue).font('Helvetica-Bold').fontSize(9)
           .text(metaBits.join('    ·    '), MARGIN + 32, doc.y, { width: CONTENT - 32 });
        doc.y += 4;
      }
      doc.y += 12;
    });

    // ── Notes ──
    if (proposal.notes) {
      ensureRoom(doc, 60);
      rule(doc, doc.y, C.border, 0.5);
      doc.y += 14;
      doc.fillColor(C.muted).font('Helvetica-Bold').fontSize(8)
         .text('NOTES & TERMS', MARGIN, doc.y);
      doc.y += 5;
      doc.fillColor(C.text).font('Helvetica').fontSize(10)
         .text(proposal.notes, MARGIN, doc.y, { width: CONTENT, lineGap: 2 });
    }

    stampFlowFooters(doc, proposal.proposal_number);
    doc.end();
  });
}

module.exports = { generateProposalPDF, generateInvoicePDF, generateReportPDF, generateWorkProposalPDF };
