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

// ── Main export ───────────────────────────────────────
function generateProposalPDF(proposal) {
  return new Promise((resolve, reject) => {
    const doc    = new PDFDocument({
      size:        'A4',
      margin:      0,
      bufferPages: true, // needed so we can stamp the footer on every page at the end
      info: {
        Title:   `${proposal.quote_number} — ${proposal.title}`,
        Author:  'VTOS — Vector Online Solutions',
        Subject: 'Formal Quotation',
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

    // Quote number — top right
    doc.fillColor('#9ca3af').font('Helvetica').fontSize(9)
       .text(proposal.quote_number, MARGIN, 28, { width: CONTENT, align: 'right' });
    doc.fillColor(C.green).font('Helvetica-Bold').fontSize(9)
       .text('FORMAL QUOTATION', MARGIN, 42, { width: CONTENT, align: 'right' });

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
    if (proposal.valid_until) {
      doc.fillColor(C.muted).font('Helvetica').fontSize(8)
         .text('VALID UNTIL', rx, yR);
      doc.fillColor(C.red).font('Helvetica-Bold').fontSize(10)
         .text(fmtDate(proposal.valid_until), rx, yR + 11);
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
         .text(`${proposal.quote_number} — ${proposal.title} (continued)`,
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
           `Vector Online Solutions  ·  vtechonlinesolutions@gmail.com  ·  +27 73 418 5106  ·  ${(process.env.APP_URL || 'https://vtos.vercel.app').replace(/^https?:\/\//, '')}`,
           MARGIN, footerY + 12, { width: CONTENT, align: 'center' }
         );
      doc.fillColor('#374151').font('Helvetica').fontSize(8)
         .text(
           `${proposal.quote_number}  ·  Generated by VTOS`,
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

module.exports = { generateProposalPDF };
