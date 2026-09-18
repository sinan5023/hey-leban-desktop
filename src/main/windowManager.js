// src/main/windowManager.js — BrowserWindow setup
// Uses native OS fullscreen with frame:true so that:
//   • On Windows: hovering at the top reveals the native title bar + controls
//   • On macOS:   moving to the top reveals the traffic-light buttons
// No custom titlebar injection required.

const { BrowserWindow, app, globalShortcut, Menu, shell } = require('electron');
const path = require('path');

const POS_URL = 'https://hey-leban-frontend.vercel.app/';

// ── Dev flag ──────────────────────────────────────────────────────────────────
const IS_DEV = process.argv.includes('--dev');

function createMainWindow(store) {
  Menu.setApplicationMenu(null);

  const win = new BrowserWindow({
    // ── Native frame: gives us real OS close/minimise/maximise buttons ──
    frame: true,
    autoHideMenuBar: true,   // hide the menu bar (File/Edit/…) but keep frame

    // ── Fullscreen (the OS reveals the native title bar on hover) ──────
    fullscreen: !IS_DEV,
    // On Windows, fullscreen + frame = native immersive fullscreen where
    // moving to the top edge shows the title bar with native controls.

    // ── No lockdown — window is freely closable / minimisable ──────────
    closable: true,
    minimizable: true,
    maximizable: true,
    resizable: true,

    title: 'Hey Leban POS',
    icon: path.join(__dirname, '../../assets/icon.png'),
    backgroundColor: '#0f0f0f',
    show: false,

    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,

    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      spellcheck: false,
    },
  });

  win.loadURL(POS_URL);

  win.once('ready-to-show', () => {
    win.show();
    if (IS_DEV) {
      // In dev: start maximised so it resembles production without going fullscreen
      win.maximize();
      win.webContents.openDevTools({ mode: 'detach' });
    }
  });

  // Block devtools shortcuts in production
  if (!IS_DEV) {
    _registerProductionShortcuts();
  }

  // Disable right-click context menu
  win.webContents.on('context-menu', (e) => e.preventDefault());

  // Auto-reload on renderer crash
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('[POS] Renderer crashed:', details.reason, '— reloading...');
    setTimeout(() => { if (!win.isDestroyed()) win.loadURL(POS_URL); }, 1500);
  });

  // Auto-reload on network failure
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    if (errorCode === -3) return;
    console.warn(`[POS] Load failed (${errorCode}: ${errorDescription}) — retrying in 5s`);
    setTimeout(() => { if (!win.isDestroyed()) win.loadURL(POS_URL); }, 5000);
  });

  // Keep new-window navigations in-app
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Persist dev window bounds
  if (IS_DEV) {
    const { width = 1280, height = 800, x, y } = store.get('windowBounds', {});
    win.setBounds({ width, height, x: x || 0, y: y || 0 });
    const saveBounds = () => {
      if (!win.isMaximized() && !win.isMinimized()) {
        store.set('windowBounds', win.getBounds());
      }
    };
    win.on('resize', saveBounds);
    win.on('move', saveBounds);
  }

  return win;
}

// ── Block only devtools/reload shortcuts — never block close/minimise ─────────
function _registerProductionShortcuts() {
  app.on('browser-window-focus', () => {
    globalShortcut.register('F12', () => {});
    globalShortcut.register('Control+Shift+I', () => {});
    globalShortcut.register('Command+Option+I', () => {});
    globalShortcut.register('Control+R', () => {});
    globalShortcut.register('F5', () => {});
    globalShortcut.register('Command+R', () => {});
  });

  app.on('browser-window-blur', () => {
    globalShortcut.unregisterAll();
  });
}

// ── Cleanly quit (called from IPC handler) ────────────────────────────────────
function _quitApp(win) {
  globalShortcut.unregisterAll();
  win.setFullScreen(false);
  app.quit();
}

module.exports = { createMainWindow, _quitApp };
