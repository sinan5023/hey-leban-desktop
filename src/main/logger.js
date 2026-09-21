// src/main/logger.js
// Persistent file logger for Hey Leban POS.
// Writes all console.log/info/warn/error to app.log on disk.

const fs = require('fs');
const path = require('path');
const { app, shell } = require('electron');

let logFilePath = null;
let logStream = null;

function initLogger() {
  try {
    const userDataPath = app.getPath('userData');
    if (!fs.existsSync(userDataPath)) {
      fs.mkdirSync(userDataPath, { recursive: true });
    }
    logFilePath = path.join(userDataPath, 'app.log');

    // Keep log file under 5MB by truncating if needed
    if (fs.existsSync(logFilePath)) {
      const stats = fs.statSync(logFilePath);
      if (stats.size > 5 * 1024 * 1024) {
        fs.writeFileSync(logFilePath, `--- Log rotated at ${new Date().toISOString()} ---\n`);
      }
    }

    logStream = fs.createWriteStream(logFilePath, { flags: 'a', encoding: 'utf8' });

    const originalLog = console.log;
    const originalInfo = console.info;
    const originalWarn = console.warn;
    const originalError = console.error;

    function formatMsg(level, args) {
      const timestamp = new Date().toISOString();
      const text = args.map(arg => {
        if (arg instanceof Error) return `${arg.message}\n${arg.stack}`;
        if (typeof arg === 'object') {
          try { return JSON.stringify(arg); } catch { return String(arg); }
        }
        return String(arg);
      }).join(' ');
      return `[${timestamp}] [${level}] ${text}\n`;
    }

    console.log = (...args) => {
      originalLog(...args);
      if (logStream) logStream.write(formatMsg('INFO', args));
    };

    console.info = (...args) => {
      originalInfo(...args);
      if (logStream) logStream.write(formatMsg('INFO', args));
    };

    console.warn = (...args) => {
      originalWarn(...args);
      if (logStream) logStream.write(formatMsg('WARN', args));
    };

    console.error = (...args) => {
      originalError(...args);
      if (logStream) logStream.write(formatMsg('ERROR', args));
    };

    process.on('uncaughtException', (err) => {
      console.error('[CRASH] Uncaught Exception:', err);
    });

    process.on('unhandledRejection', (reason) => {
      console.error('[CRASH] Unhandled Rejection:', reason);
    });

    console.log('====================================================');
    console.log(`Hey Leban POS starting — App Version: ${app.getVersion()}`);
    console.log(`Platform: ${process.platform} (${process.arch}) | Electron: ${process.versions.electron} | Node: ${process.versions.node}`);
    console.log(`Log File Path: ${logFilePath}`);
    console.log('====================================================');
  } catch (err) {
    console.error('Failed to initialize file logger:', err);
  }
}

function getLogPath() {
  return logFilePath;
}

function openLogFile() {
  if (logFilePath && fs.existsSync(logFilePath)) {
    shell.openPath(logFilePath);
  }
}

module.exports = { initLogger, getLogPath, openLogFile };
