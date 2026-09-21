// src/main/printerService.js
// Handles USB thermal printer discovery, connection, and ESC/POS printing.
// Mirrors the receipt format from the Android printFormatter.ts exactly.

const { ThermalPrinter, PrinterTypes, CharacterSet } = require('node-thermal-printer');
const path = require('path');
const fs = require('fs');
const { printBuffer } = require('./windowsPrinter');

// ── Printer config (mirrors constants/index.ts) ───────────────────────────────
const PRINTER_CHAR_WIDTH = 48;
const W = PRINTER_CHAR_WIDTH;
const MARGIN = '  '; // 2-space left margin

// Path to the logo image — pre-scaled to 384px wide PNG for 80mm thermal printer
const LOGO_PATH = path.join(__dirname, '../../assets/logo-print.png');

// ── String helpers (mirrors printFormatter.ts) ────────────────────────────────
function padEnd(str, len) {
  const s = String(str);
  if (s.length >= len) return s.slice(0, len);
  return s + ' '.repeat(len - s.length);
}

function padStart(str, len) {
  const s = String(str);
  if (s.length >= len) return s.slice(0, len);
  return ' '.repeat(len - s.length) + s;
}

function wordWrap(text, maxLen) {
  const words = String(text).split(' ');
  const lines = [];
  let currentLine = '';
  for (const word of words) {
    if ((currentLine + word).length > maxLen) {
      if (currentLine.length > 0) {
        lines.push(currentLine.trim());
        currentLine = word + ' ';
      } else {
        lines.push(word.substring(0, maxLen));
        currentLine = word.substring(maxLen) + ' ';
      }
    } else {
      currentLine += word + ' ';
    }
  }
  if (currentLine.trim().length > 0) lines.push(currentLine.trim());
  return lines;
}

function safeMoney(val) {
  return Number(val || 0).toFixed(2);
}

// ── Low-level printer builder ─────────────────────────────────────────────────

/**
 * Creates an in-memory node-thermal-printer instance to generate ESC/POS byte commands.
 */
function createPrinter() {
  return new ThermalPrinter({
    type: PrinterTypes.EPSON, // standard ESC/POS compatible
    characterSet: CharacterSet.PC437_USA,
    removeSpecialCharacters: false,
    lineCharacter: '-',
    width: PRINTER_CHAR_WIDTH,
  });
}

// ── Receipt formatters ────────────────────────────────────────────────────────

/**
 * Prints a BILL receipt.
 * Mirrors formatBill() from printFormatter.ts.
 */
async function printBill(payload, printerConfig = {}) {
  const printer = createPrinter();

  const { shop, order, summary, payment, items, notes, footerMessage, cashierName } = payload;

  // ── Logo (Centered) ──
  printer.alignCenter();
  if (fs.existsSync(LOGO_PATH)) {
    try {
      await printer.printImage(LOGO_PATH);
    } catch (err) {
      console.warn('[PRINTER] Failed to add logo to receipt (non-fatal):', err.message);
    }
  }
  printer.newLine();

  // ── Shop header ──
  printer.alignCenter();
  printer.bold(true);
  printer.setTextSize(1, 1); // "big" equivalent
  printer.println(shop?.name || 'Hey Leban');
  printer.bold(false);
  printer.setTextNormal();
  if (shop?.address) printer.println(shop.address);
  if (shop?.phone) printer.println(shop.phone);
  printer.newLine();

  // ── Sep === ──
  printer.drawLine('=');
  printer.newLine();

  // ── Order info ──
  printer.alignLeft();
  // Two-column rows
  _twoCol(printer, `Order: ${order.orderNo}`, `Token: ${order.tokenNo}`);
  _twoCol(printer, `Type: ${(order.orderType || '').replace(/_/g, ' ')}`, `Cashier: ${cashierName || '-'}`);
  if (order.createdAt) {
    const dt = new Date(order.createdAt).toLocaleString();
    printer.println(`${MARGIN}Date: ${dt}`);
  }

  printer.drawLine();
  printer.newLine();

  // ── Item table header ──
  printer.alignLeft();
  printer.bold(true);
  const itemHeader = padEnd('Item', W - 12) + padStart('Qty', 4) + '  ' + padStart('Total', 6);
  printer.println(MARGIN + itemHeader);
  printer.bold(false);
  printer.drawLine();
  printer.newLine();

  // ── Items ──
  for (const item of items) {
    const right = `${item.qty}x ${safeMoney(item.total)}`;
    const rightLen = right.length;
    const leftLen = W - rightLen;
    const nameLines = wordWrap(item.name, leftLen);

    const firstLine = nameLines[0] || '';
    const row = padEnd(firstLine, leftLen) + padStart(right, rightLen);
    printer.println(MARGIN + row);

    for (let i = 1; i < nameLines.length; i++) {
      printer.println(MARGIN + nameLines[i]);
    }
    if (item.note) {
      printer.println(`${MARGIN}  * ${item.note}`);
    }
  }

  printer.drawLine();
  printer.newLine();

  // ── Totals ──
  printer.alignRight();
  printer.println(`Subtotal : ${safeMoney(summary.subtotal)}${MARGIN}`);
  if (Number(summary.discountAmount || 0) > 0) {
    printer.println(`Discount : -${safeMoney(summary.discountAmount)}${MARGIN}`);
  }
  if (Number(summary.tax || 0) > 0) {
    printer.println(`Tax      : ${safeMoney(summary.tax)}${MARGIN}`);
  }

  printer.alignCenter();
  printer.bold(true);
  printer.setTextSize(1, 1);
  printer.println(`TOTAL: ${safeMoney(summary.totalAmount)}`);
  printer.bold(false);
  printer.setTextNormal();

  printer.alignLeft();
  printer.println(`${MARGIN}Paid     : ${safeMoney(summary.totalPaid)}`);
  printer.println(`${MARGIN}Balance  : ${safeMoney(summary.balanceDue)}`);

  if (Number(summary.balanceDue) > 0 && Number(summary.balanceDue) === Number(summary.totalAmount)) {
    printer.newLine();
    printer.alignCenter();
    printer.bold(true);
    printer.setTextSize(1, 1);
    printer.println('NOT PAID');
    printer.bold(false);
    printer.setTextNormal();
  }

  // ── Payment methods ──
  if (payment?.methodBreakdown?.length > 0) {
    printer.drawLine();
    printer.newLine();
    printer.alignLeft();
    printer.bold(true);
    printer.println(`${MARGIN}Payment:`);
    printer.bold(false);
    for (const m of payment.methodBreakdown) {
      if (Number(m.amount || 0) > 0) {
        _twoCol(printer, `  ${m.method}`, safeMoney(m.amount));
      }
    }
  }

  printer.drawLine('=');
  printer.newLine();

  // ── Notes ──
  if (notes) {
    printer.alignLeft();
    printer.println(`${MARGIN}Note: ${notes}`);
    printer.drawLine();
    printer.newLine();
  }

  // ── Footer ──
  printer.alignCenter();
  printer.bold(true);
  printer.setTextSize(1, 1);
  const maxBigChars = Math.floor(PRINTER_CHAR_WIDTH / 2);
  const footerLines = wordWrap(footerMessage || 'Thank you!', maxBigChars);
  for (const line of footerLines) {
    printer.println(line);
  }
  printer.bold(false);
  printer.setTextNormal();

  // Paper feed
  printer.newLine();
  printer.newLine();
  printer.newLine();
  printer.cut();

  const buffer = printer.getBuffer();
  const target = printerConfig.printerName || printerConfig.interface || 'Essae PR -55';
  await printBuffer(target, buffer);
  console.log('[PRINTER] Bill printed successfully.');
}

/**
 * Prints a KOT ticket.
 * Mirrors formatKOT() from printFormatter.ts.
 */
async function printKOT(payload, printerConfig = {}) {
  const printer = createPrinter();

  const { shop, order, items, notes } = payload;
  const kotInfo = payload.kot;

  // ── Header ──
  printer.alignCenter();
  printer.bold(true);
  printer.setTextSize(1, 1);

  if (kotInfo?.status === 'REPRINTED') {
    printer.println('================');
    printer.println('*** REPRINT ***');
    printer.println('================');
  }
  printer.println('*** KOT ***');
  printer.bold(false);
  printer.setTextNormal();
  printer.println(shop?.name || 'Hey Leban');

  printer.drawLine('=');
  printer.newLine();

  // ── Order identifiers ──
  printer.alignLeft();
  printer.bold(true);
  printer.setTextSize(1, 1);
  if (kotInfo?.kotNo) {
    printer.println(`${MARGIN}KOT #: ${kotInfo.kotNo}`);
    printer.println(`${MARGIN}Order #: ${order.orderNo}`);
  } else {
    printer.println(`${MARGIN}Order #: ${order.orderNo}`);
  }
  printer.println(`${MARGIN}Type: ${(order.orderType || '').replace(/_/g, ' ')}`);
  printer.println(`${MARGIN}Token: ${order.tokenNo}`);
  printer.bold(false);
  printer.setTextNormal();

  if (order.createdAt) {
    const dt = new Date(order.createdAt).toLocaleString();
    printer.println(`${MARGIN}${dt}`);
  }

  printer.drawLine();
  printer.newLine();

  // ── Item table header ──
  printer.bold(true);
  const kotHeader = padEnd('Item', W - 5) + padStart('Qty', 5);
  printer.println(`${MARGIN}${kotHeader}`);
  printer.bold(false);
  printer.drawLine();
  printer.newLine();

  // ── Items (bold + big for kitchen visibility) ──
  const BIG_ITEM_W = 20;
  const NAME_MAX_W = BIG_ITEM_W - 3;

  for (const item of items) {
    const nameLines = wordWrap(item.name, NAME_MAX_W);
    const firstLine = nameLines[0] || '';
    const kotRow = padEnd(firstLine, NAME_MAX_W) + padStart(String(item.qty), 3);

    printer.bold(true);
    printer.setTextSize(1, 1);
    printer.println(kotRow);

    for (let i = 1; i < nameLines.length; i++) {
      printer.println(nameLines[i]);
    }

    printer.bold(false);
    printer.setTextNormal();

    if (item.note) {
      printer.println(`${MARGIN}  >> ${item.note}`);
    }
  }

  printer.drawLine('=');
  printer.newLine();

  // ── Notes ──
  if (notes) {
    printer.bold(true);
    printer.setTextSize(1, 1);
    printer.println(`${MARGIN}Notes:`);
    printer.bold(false);
    printer.setTextNormal();
    printer.println(`${MARGIN}${notes}`);
    printer.newLine();
  }

  printer.alignCenter();
  printer.println('Please prepare immediately.');

  printer.newLine();
  printer.newLine();
  printer.cut();

  const buffer = printer.getBuffer();
  const target = printerConfig.printerName || printerConfig.interface || 'Essae PR -55';
  await printBuffer(target, buffer);
  console.log('[PRINTER] KOT printed successfully.');
}

/**
 * Prints a test page to verify the printer is working.
 */
async function printTest(printerConfig = {}) {
  const printer = createPrinter();

  const now = new Date().toLocaleString();

  printer.alignCenter();
  printer.bold(true);
  printer.setTextSize(1, 1);
  printer.println('TEST PRINT');
  printer.bold(false);
  printer.setTextNormal();
  printer.println('Hey Leban POS Bridge');
  printer.drawLine();
  printer.newLine();

  printer.alignLeft();
  printer.println(`${MARGIN}Printer:  OK`);
  printer.println(`${MARGIN}Model:    Essae PR-55`);
  printer.println(`${MARGIN}ESC/POS:  OK`);
  printer.drawLine();
  printer.newLine();

  printer.alignCenter();
  printer.println(now);
  printer.println('Ready to print!');
  printer.newLine();
  printer.newLine();
  printer.newLine();
  printer.cut();

  const buffer = printer.getBuffer();
  const target = printerConfig.printerName || printerConfig.interface || 'Essae PR -55';
  await printBuffer(target, buffer);
  console.log('[PRINTER] Test print sent successfully.');
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Prints a two-column line: left text left-aligned, right text right-aligned.
 * @param {ThermalPrinter} printer
 * @param {string} left
 * @param {string} right
 */
function _twoCol(printer, left, right) {
  const rightLen = right.length;
  const leftLen = W - rightLen;
  const row = padEnd(left, leftLen) + padStart(right, rightLen);
  printer.alignLeft();
  printer.println(MARGIN + row);
}

module.exports = { printBill, printKOT, printTest };
