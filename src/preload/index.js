// src/preload/index.js
// Runs in the renderer context with access to ipcRenderer.
//
// This script does two things:
//
//  1. MOCKS window.rnBridge  — The web app calls window.rnBridge.send(msg)
//     exactly like it would call the React Native WebView bridge.
//     We intercept it and forward via IPC to the main process.
//
//  2. LISTENS for rnbridge:response from the main process and dispatches
//     window 'rnMessage' CustomEvents so the web app's existing listener
//     in printHelpers.js receives ACK/RESULT callbacks as normal.

const { contextBridge, ipcRenderer } = require('electron');

// ── 1. Inject window.rnBridge ─────────────────────────────────────────────────
//
// The web app's printHelpers.js checks:
//   if (window.rnBridge && typeof window.rnBridge.send === 'function')
// and calls:
//   window.rnBridge.send({ type, requestId, payload })

contextBridge.exposeInMainWorld('rnBridge', {
  /**
   * Called by the web app to trigger a print action.
   * @param {{ type: string, requestId: string, payload: object }} message
   */
  send: (message) => {
    console.log('[PRELOAD] rnBridge.send intercepted:', message?.type, message?.requestId);
    ipcRenderer.invoke('rnbridge:print', message).catch((err) => {
      console.error('[PRELOAD] IPC invoke error:', err);
    });
  },
});

// ── 2. Forward IPC responses back to the web app ──────────────────────────────
//
// The main process sends 'rnbridge:response' events back.
// The web app listens for window 'rnMessage' CustomEvents with event.detail.
// We bridge them here.

ipcRenderer.on('rnbridge:response', (_event, response) => {
  console.log('[PRELOAD] rnbridge:response received:', response?.type, response?.requestId);
  const rnMessageEvent = new CustomEvent('rnMessage', { detail: response });
  window.dispatchEvent(rnMessageEvent);
});

// ── 3. Expose electronAPI for printer settings UI ─────────────────────────────
//
// This allows any settings page/component to access printer controls
// without going through the rnBridge channel.

contextBridge.exposeInMainWorld('electronAPI', {
  /** Sends a test print to the connected USB printer */
  testPrint: () => ipcRenderer.invoke('printer:test'),

  /** Gets the stored printer config */
  getPrinterConfig: () => ipcRenderer.invoke('printer:get-config'),

  /** Saves a new printer config */
  setPrinterConfig: (config) => ipcRenderer.invoke('printer:set-config', config),

  /** Platform info */
  platform: process.platform,

  /** Quit the app */
  quitApp: () => ipcRenderer.invoke('app:quit'),
});

console.log('[PRELOAD] Hey Leban desktop bridge loaded. window.rnBridge is ready.');
