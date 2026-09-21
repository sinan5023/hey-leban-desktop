// src/main/ipcHandlers.js
// Registers all Electron IPC handlers. The preload bridge calls these
// from the renderer (web app) context via ipcRenderer.invoke().

const { ipcMain, BrowserWindow } = require('electron');
const { printBill, printKOT, printTest } = require('./printerService');
const { _quitApp } = require('./windowManager');

/**
 * IPC Channels:
 *
 *  Renderer → Main:
 *    'rnbridge:print'        — { type, requestId, payload }  → print receipt
 *    'printer:test'          — {}                            → test print
 *    'printer:get-config'    — {}                            → returns stored config
 *    'printer:set-config'    — { interface }                 → saves printer config
 *
 *  Main → Renderer (via webContents.send):
 *    'rnbridge:response'     — { type, requestId, success, message }
 *    'printer:status'        — { status, message }
 */

/**
 * @param {import('electron-store').default} store
 */
function setupIpcHandlers(store) {

  // ── Print handler ──────────────────────────────────────────────────────────
  ipcMain.handle('rnbridge:print', async (event, { type, requestId, payload }) => {
    console.log(`[IPC] Received print request: type=${type} requestId=${requestId}`);

    const printerConfig = store.get('printerConfig', {});
    const win = BrowserWindow.fromWebContents(event.sender);

    // Acknowledge receipt immediately so the web app doesn't time out
    _sendToRenderer(win, 'rnbridge:response', {
      type: 'PRINT_ACK',
      requestId,
      success: true,
      message: 'Print job received by desktop bridge.',
    });

    try {
      if (type === 'PRINT_BILL') {
        await printBill(payload, printerConfig);
      } else if (type === 'PRINT_KOT') {
        await printKOT(payload, printerConfig);
      } else if (type === 'PRINT_BOTH') {
        // Print KOT first, then bill
        await printKOT(payload, printerConfig);
        await printBill(payload, printerConfig);
      } else {
        throw new Error(`Unknown print type: ${type}`);
      }

      _sendToRenderer(win, 'rnbridge:response', {
        type: 'PRINT_RESULT',
        requestId,
        success: true,
        message: 'Print job completed successfully.',
      });
    } catch (err) {
      console.error(`[IPC] Print failed for ${requestId}:`, err.message);
      _sendToRenderer(win, 'rnbridge:response', {
        type: 'PRINT_RESULT',
        requestId,
        success: false,
        message: err.message || 'Unknown printer error.',
      });
    }
  });

  // ── Test print ─────────────────────────────────────────────────────────────
  ipcMain.handle('printer:test', async (event) => {
    const printerConfig = store.get('printerConfig', {});
    try {
      await printTest(printerConfig);
      return { success: true };
    } catch (err) {
      console.error('[IPC] Test print failed:', err.message);
      return { success: false, message: err.message };
    }
  });

  // ── Get printer config ─────────────────────────────────────────────────────
  ipcMain.handle('printer:get-config', () => {
    return store.get('printerConfig', { printerName: 'Essae PR -55' });
  });

  // ── Set printer config ─────────────────────────────────────────────────────
  ipcMain.handle('printer:set-config', (_, config) => {
    store.set('printerConfig', config);
    console.log('[IPC] Printer config updated:', config);
    return { success: true };
  });

  // ── Get installed system printers ─────────────────────────────────────────
  ipcMain.handle('printer:get-printers', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const { listSystemPrinters } = require('./windowsPrinter');
    return await listSystemPrinters(win);
  });

  // ── Open log file in default viewer (Notepad / TextEdit) ───────────────────
  ipcMain.handle('app:open-logs', () => {
    const { openLogFile } = require('./logger');
    openLogFile();
    return { success: true };
  });

  // ── Quit app (renderer-triggered) ─────────────────────────────────────────
  ipcMain.handle('app:quit', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) _quitApp(win);
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function _sendToRenderer(win, channel, data) {
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, data);
  }
}

module.exports = { setupIpcHandlers };
