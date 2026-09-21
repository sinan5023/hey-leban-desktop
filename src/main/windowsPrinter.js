// src/main/windowsPrinter.js
// Handles sending raw ESC/POS command buffers directly to Windows printers
// (such as the Essae PR -55) via the Windows Print Spooler (winspool.drv).
//
// Does not require Zadig, WinUSB, or native C++ addons.

const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const { execFile } = require('child_process');
const { BrowserWindow } = require('electron');

/**
 * Lists all system printers installed in the OS.
 * @param {BrowserWindow} [win]
 * @returns {Promise<Array<{ name: string, displayName: string, isDefault: boolean, status: number }>>}
 */
async function listSystemPrinters(win) {
  try {
    const targetWin = win || BrowserWindow.getAllWindows()[0];
    if (targetWin && targetWin.webContents) {
      const printers = await targetWin.webContents.getPrintersAsync();
      console.log(`[PRINTER] Detected ${printers.length} installed printer(s):`, printers.map(p => `${p.name}${p.isDefault ? ' (Default)' : ''}`));
      return printers;
    }
  } catch (err) {
    console.warn('[PRINTER] getPrintersAsync failed:', err.message);
  }
  return [];
}

/**
 * Automatically resolves the best printer to use.
 * Prioritizes Essae PR-55, POS/Thermal printers, or the default printer.
 * @param {Array<any>} printers
 * @param {string} [configuredName]
 * @returns {string} The resolved printer name
 */
function resolvePrinterName(printers, configuredName) {
  if (!printers || printers.length === 0) {
    return configuredName || 'Essae PR -55';
  }

  // 1. Exact match with user's configured name
  if (configuredName && configuredName !== 'auto' && configuredName !== 'usb') {
    const exact = printers.find(p => p.name.trim().toLowerCase() === configuredName.trim().toLowerCase());
    if (exact) return exact.name;
    const partial = printers.find(p => p.name.toLowerCase().includes(configuredName.toLowerCase()));
    if (partial) return partial.name;
  }

  // 2. Auto-detect Essae PR-55
  const essae = printers.find(p => /essae|pr[- ]?55/i.test(p.name));
  if (essae) {
    console.log(`[PRINTER] Auto-detected Essae printer: "${essae.name}"`);
    return essae.name;
  }

  // 3. Auto-detect any thermal/POS printer
  const thermal = printers.find(p => /pos|thermal|receipt|xp-|rp/i.test(p.name));
  if (thermal) {
    console.log(`[PRINTER] Auto-detected POS/thermal printer: "${thermal.name}"`);
    return thermal.name;
  }

  // 4. Default OS printer
  const def = printers.find(p => p.isDefault);
  if (def) {
    console.log(`[PRINTER] Using system default printer: "${def.name}"`);
    return def.name;
  }

  // 5. First printer in list
  return printers[0].name;
}

/**
 * Sends a raw ESC/POS buffer directly to a Windows printer queue via winspool.drv.
 * @param {string} printerName Name of the Windows printer (e.g. 'Essae PR -55')
 * @param {Buffer} buffer Raw ESC/POS byte buffer
 * @returns {Promise<void>}
 */
function sendRawToWindowsPrinter(printerName, buffer) {
  return new Promise((resolve, reject) => {
    const tempFile = path.join(os.tmpdir(), `print_hl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.bin`);

    try {
      fs.writeFileSync(tempFile, buffer);
    } catch (err) {
      return reject(new Error(`Failed to write temp print file: ${err.message}`));
    }

    // PowerShell script that uses winspool.drv to send RAW bytes
    const psScript = `
$ErrorActionPreference = "Stop"
$PrinterName = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String("${Buffer.from(printerName, 'utf8').toString('base64')}"))
$FilePath = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String("${Buffer.from(tempFile, 'utf8').toString('base64')}"))

$signature = @"
using System;
using System.Runtime.InteropServices;

namespace RawPrinter {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    public class DOCINFOA {
        [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
    }

    public class Helper {
        [DllImport("winspool.Drv", EntryPoint = "OpenPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
        public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);

        [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
        public static extern bool ClosePrinter(IntPtr hPrinter);

        [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
        public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);

        [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
        public static extern bool EndDocPrinter(IntPtr hPrinter);

        [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
        public static extern bool StartPagePrinter(IntPtr hPrinter);

        [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
        public static extern bool EndPagePrinter(IntPtr hPrinter);

        [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
        public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

        public static void SendBytes(string printerName, byte[] bytes) {
            IntPtr hPrinter = IntPtr.Zero;
            DOCINFOA di = new DOCINFOA();
            di.pDocName = "Hey Leban Receipt";
            di.pDataType = "RAW";

            if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero)) {
                throw new Exception("Unable to open printer '" + printerName + "'. Check that printer is connected and installed in Windows. Win32 Error: " + Marshal.GetLastWin32Error());
            }

            try {
                if (!StartDocPrinter(hPrinter, 1, di)) {
                    throw new Exception("StartDocPrinter failed. Win32 Error: " + Marshal.GetLastWin32Error());
                }
                if (!StartPagePrinter(hPrinter)) {
                    throw new Exception("StartPagePrinter failed. Win32 Error: " + Marshal.GetLastWin32Error());
                }

                IntPtr pUnmanagedBytes = Marshal.AllocCoTaskMem(bytes.Length);
                Marshal.Copy(bytes, 0, pUnmanagedBytes, bytes.Length);
                int written = 0;
                bool success = WritePrinter(hPrinter, pUnmanagedBytes, bytes.Length, out written);
                Marshal.FreeCoTaskMem(pUnmanagedBytes);

                EndPagePrinter(hPrinter);
                EndDocPrinter(hPrinter);

                if (!success || written != bytes.Length) {
                    throw new Exception("WritePrinter wrote " + written + " of " + bytes.Length + " bytes. Win32 Error: " + Marshal.GetLastWin32Error());
                }
            } finally {
                ClosePrinter(hPrinter);
            }
        }
    }
}
"@

try {
    Add-Type -TypeDefinition $signature -ErrorAction SilentlyContinue
} catch {}

$bytes = [System.IO.File]::ReadAllBytes($FilePath)
[RawPrinter.Helper]::SendBytes($PrinterName, $bytes)
Write-Output "SUCCESS"
`;

    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psScript], (error, stdout, stderr) => {
      // Always cleanup temp file
      try { fs.unlinkSync(tempFile); } catch {}

      if (error) {
        console.error(`[PRINTER] Windows spooler error for "${printerName}":`, stderr || error.message);
        return reject(new Error(stderr?.trim() || error.message));
      }

      console.log(`[PRINTER] Successfully spooled ${buffer.length} bytes directly to "${printerName}" via Windows Spooler.`);
      resolve();
    });
  });
}

/**
 * Sends a raw ESC/POS buffer to a network printer via TCP socket.
 */
function sendRawToNetworkPrinter(host, port, buffer) {
  return new Promise((resolve, reject) => {
    const client = new net.Socket();
    client.setTimeout(5000);

    client.connect(port || 9100, host, () => {
      client.write(buffer, () => {
        client.end();
        console.log(`[PRINTER] Sent ${buffer.length} bytes to network printer ${host}:${port || 9100}`);
        resolve();
      });
    });

    client.on('error', (err) => {
      client.destroy();
      reject(new Error(`Network printer error: ${err.message}`));
    });

    client.on('timeout', () => {
      client.destroy();
      reject(new Error(`Network printer connection to ${host}:${port || 9100} timed out`));
    });
  });
}

/**
 * Universal dispatcher to send raw ESC/POS bytes to the printer.
 * Handles Windows Spooler, Network (TCP), and macOS/Linux test fallback.
 * @param {string} targetInterface Or printer name
 * @param {Buffer} buffer Raw ESC/POS bytes
 */
async function printBuffer(targetInterface, buffer) {
  if (!buffer || buffer.length === 0) {
    throw new Error('Print buffer is empty');
  }

  // Network printer: tcp://192.168.1.100:9100
  if (targetInterface && targetInterface.startsWith('tcp://')) {
    const url = new URL(targetInterface);
    return await sendRawToNetworkPrinter(url.hostname, parseInt(url.port || '9100', 10), buffer);
  }

  // Windows: Send directly to Windows Print Spooler
  if (process.platform === 'win32') {
    const printers = await listSystemPrinters();
    const resolvedName = resolvePrinterName(printers, targetInterface);
    console.log(`[PRINTER] Dispatching print job to Windows printer: "${resolvedName}" (${buffer.length} bytes)`);
    return await sendRawToWindowsPrinter(resolvedName, buffer);
  }

  // macOS / Linux development fallback
  if (process.platform === 'darwin') {
    console.log(`[PRINTER (macOS)] Received ${buffer.length} bytes for printer "${targetInterface}".`);
    // Attempt lp if a printer is available
    const tempFile = path.join(os.tmpdir(), `print_mac_${Date.now()}.bin`);
    try {
      fs.writeFileSync(tempFile, buffer);
      return new Promise((resolve) => {
        const cmd = targetInterface && targetInterface !== 'usb' && targetInterface !== 'auto'
          ? `lp -d "${targetInterface}" -o raw "${tempFile}"`
          : `lp -o raw "${tempFile}"`;
        execFile('/bin/sh', ['-c', cmd], (err) => {
          try { fs.unlinkSync(tempFile); } catch {}
          if (err) {
            console.warn('[PRINTER (macOS)] lp command failed (dev mode, non-fatal):', err.message);
          } else {
            console.log('[PRINTER (macOS)] Spooled successfully with lp.');
          }
          resolve(); // Resolve so dev flow continues
        });
      });
    } catch (e) {
      console.warn('[PRINTER (macOS)] Dev fallback:', e.message);
      return;
    }
  }

  console.log(`[PRINTER (Simulated)] Spooled ${buffer.length} bytes for "${targetInterface}"`);
}

module.exports = {
  listSystemPrinters,
  resolvePrinterName,
  printBuffer,
};
