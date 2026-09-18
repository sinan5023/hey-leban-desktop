// src/main/windowManager.js — BrowserWindow setup with Kiosk Mode

const { BrowserWindow, app, globalShortcut, Menu, shell } = require('electron');
const path = require('path');

const POS_URL = 'https://hey-leban-frontend.vercel.app/';

// ── Kiosk mode flag ───────────────────────────────────────────────────────────
// Set to false to allow normal windowed mode (useful during development)
const IS_DEV = process.argv.includes('--dev');
const KIOSK_MODE = !IS_DEV;

/**
 * Creates and returns the main BrowserWindow in kiosk mode.
 * Kiosk mode:
 *   - Fullscreen, no titlebar or frame
 *   - All exit shortcuts (Cmd+Q, Cmd+W, Alt+F4, F11) are blocked
 *   - Right-click context menu is disabled
 *   - Window cannot be closed, minimized, or resized
 *   - App menu is completely removed
 *   - Auto-reloads on renderer crash
 */
function createMainWindow(store) {
  // ── Remove the native app menu entirely ────────────────────────────────
  Menu.setApplicationMenu(null);

  const win = new BrowserWindow({
    // ── Kiosk / fullscreen settings ──
    fullscreen: KIOSK_MODE,
    kiosk: KIOSK_MODE,           // true kiosk: blocks macOS Mission Control
    frame: false,                // no titlebar
    alwaysOnTop: KIOSK_MODE,
    closable: !KIOSK_MODE,       // prevent accidental close in kiosk
    minimizable: !KIOSK_MODE,
    maximizable: false,
    resizable: !KIOSK_MODE,
    movable: !KIOSK_MODE,

    // ── Window identity ──
    title: 'Hey Leban POS',
    icon: path.join(__dirname, '../../assets/icon.png'),
    backgroundColor: '#0f0f0f',  // dark bg while page loads (no white flash)
    show: false,

    // ── Dev mode fallback size ──
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
      // Disable default context menu in kiosk
      spellcheck: false,
    },
  });

  // ── Load the POS web app ────────────────────────────────────────────────
  win.loadURL(POS_URL);

  // ── Show window only when content is ready (no white flash) ────────────
  win.once('ready-to-show', () => {
    win.show();
    if (IS_DEV) {
      win.webContents.openDevTools({ mode: 'detach' });
    }
  });

  // ── Block all system exit shortcuts in kiosk mode ───────────────────────
  if (KIOSK_MODE) {
    _registerKioskShortcuts(win);
  }

  // ── Disable right-click context menu ───────────────────────────────────
  win.webContents.on('context-menu', (e) => {
    e.preventDefault();
  });

  // ── Prevent window close in kiosk (Cmd+Q still quits — blocked below) ──
  win.on('close', (e) => {
    if (KIOSK_MODE) {
      e.preventDefault(); // ignore OS-level close
    }
  });

  // ── Auto-reload if the renderer process crashes ─────────────────────────
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('[KIOSK] Renderer crashed:', details.reason, '— reloading...');
    setTimeout(() => {
      if (!win.isDestroyed()) {
        win.loadURL(POS_URL);
      }
    }, 1500);
  });

  // ── Auto-reload if page fails to load (network blip, etc.) ────────────
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    if (errorCode === -3) return; // -3 = user-aborted, ignore
    console.warn(`[KIOSK] Page load failed (${errorCode}: ${errorDescription}) — retrying in 5s`);
    setTimeout(() => {
      if (!win.isDestroyed()) {
        win.loadURL(POS_URL);
      }
    }, 5000);
  });

  // ── Security: keep new windows inside the app ───────────────────────────
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // ── Persist dev window bounds across sessions ───────────────────────────
  if (IS_DEV) {
    const { width = 1280, height = 800, x, y } = store.get('windowBounds', {});
    win.setBounds({ width, height, x: x || 0, y: y || 0 });

    function saveBounds() {
      if (!win.isMaximized() && !win.isMinimized()) {
        store.set('windowBounds', win.getBounds());
      }
    }
    win.on('resize', saveBounds);
    win.on('move', saveBounds);
  }

  return win;
}

// ── Block keyboard shortcuts that could escape kiosk ─────────────────────────
function _registerKioskShortcuts(win) {
  app.on('browser-window-focus', () => {
    // macOS
    globalShortcut.register('Command+Q', () => {});         // quit
    globalShortcut.register('Command+W', () => {});         // close tab
    globalShortcut.register('Command+M', () => {});         // minimize
    globalShortcut.register('Command+H', () => {});         // hide
    globalShortcut.register('Command+Option+H', () => {});  // hide others
    globalShortcut.register('Command+R', () => {});         // reload (allow ctrl below)
    globalShortcut.register('Command+Shift+Q', () => {});   // logout
    globalShortcut.register('Command+Control+F', () => {}); // enter fullscreen toggle

    // Windows / Linux
    globalShortcut.register('Alt+F4', () => {});            // close window
    globalShortcut.register('Control+W', () => {});         // close tab
    globalShortcut.register('Control+Q', () => {});         // quit
    globalShortcut.register('Control+Alt+Delete', () => {}); // task manager

    // DevTools — blocked in kiosk
    globalShortcut.register('F12', () => {});
    globalShortcut.register('Command+Option+I', () => {});
    globalShortcut.register('Control+Shift+I', () => {});

    // ── BUT allow a secret supervisor unlock combo: Ctrl+Shift+F10 ────────
    // Hold this to exit kiosk (for IT/admin use only)
    globalShortcut.register('Control+Shift+F10', () => {
      console.log('[KIOSK] Supervisor override — exiting kiosk mode');
      globalShortcut.unregisterAll();
      win.setKiosk(false);
      win.setFullScreen(false);
      win.setAlwaysOnTop(false);
      win.setClosable(true);
      win.setMinimizable(true);
      // Optionally open DevTools for debugging
      win.webContents.openDevTools({ mode: 'detach' });
    });
  });

  app.on('browser-window-blur', () => {
    globalShortcut.unregisterAll();
  });
}

module.exports = { createMainWindow };
