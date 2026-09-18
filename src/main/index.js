// src/main/index.js — Electron main process entry point

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const { setupIpcHandlers } = require('./ipcHandlers');
const { createMainWindow } = require('./windowManager');
const Store = require('electron-store');

// ── Init persistent store ────────────────────────────────────────────────────
const store = new Store();

// ── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  const win = createMainWindow(store);
  setupIpcHandlers(store);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow(store);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// ── Security: prevent new windows from opening external URLs ─────────────────
app.on('web-contents-created', (_, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
});
