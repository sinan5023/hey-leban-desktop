// src/renderer/settings.js
// Settings page JS — interacts with the main process via window.electronAPI

const dot        = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const btnTest    = document.getElementById('btn-test');
const testResult = document.getElementById('test-result');
const select     = document.getElementById('printer-interface');
const btnSave    = document.getElementById('btn-save');
const saveResult = document.getElementById('save-result');
const btnLogs    = document.getElementById('btn-logs');

// ── Bridge / platform info ────────────────────────────────────────────────────
if (window.electronAPI) {
  bridgeStatus.textContent = 'Active ✓';
  bridgeStatus.className = 'badge badge-ok';
  platformInfo.textContent = window.electronAPI.platform;
} else {
  bridgeStatus.textContent = 'Not found';
  bridgeStatus.className = 'badge badge-err';
}

// ── Open logs ────────────────────────────────────────────────────────────────
if (btnLogs && window.electronAPI?.openLogs) {
  btnLogs.addEventListener('click', () => {
    window.electronAPI.openLogs();
  });
}

// ── Load saved config & detect system printers ───────────────────────────────
async function loadConfig() {
  if (!window.electronAPI) return;

  try {
    const config = await window.electronAPI.getPrinterConfig();
    const savedPrinter = config?.printerName || config?.interface || 'Essae PR -55';

    // Query system printers
    const printers = await window.electronAPI.getSystemPrinters();
    select.innerHTML = '';

    // Auto-detect option
    const autoOpt = document.createElement('option');
    autoOpt.value = 'auto';
    autoOpt.textContent = '⚡ Auto-Detect (Essae PR-55 / Default)';
    select.appendChild(autoOpt);

    // List detected system printers
    if (printers && printers.length > 0) {
      printers.forEach((p) => {
        const opt = document.createElement('option');
        opt.value = p.name;
        opt.textContent = `${p.name}${p.isDefault ? ' (Default)' : ''}`;
        select.appendChild(opt);
      });
    }

    // Network manual option
    const netOpt = document.createElement('option');
    netOpt.value = 'tcp://192.168.1.100:9100';
    netOpt.textContent = '🌐 Network — 192.168.1.100:9100';
    select.appendChild(netOpt);

    // Select the saved option
    if (savedPrinter) {
      let match = Array.from(select.options).find(o => o.value === savedPrinter);
      if (match) {
        select.value = savedPrinter;
      } else {
        const customOpt = document.createElement('option');
        customOpt.value = savedPrinter;
        customOpt.textContent = `🖨️ ${savedPrinter}`;
        select.appendChild(customOpt);
        select.value = savedPrinter;
      }
    }
  } catch (err) {
    console.error('Error loading printer config:', err);
  }
}
loadConfig();

// ── Test print ────────────────────────────────────────────────────────────────
btnTest.addEventListener('click', async () => {
  btnTest.disabled = true;
  btnTest.textContent = 'Sending...';
  testResult.textContent = '';
  testResult.className = 'hint';

  try {
    const result = await window.electronAPI.testPrint();
    if (result?.success) {
      dot.className = 'status-dot ok';
      statusText.textContent = 'Connected — test print sent!';
      testResult.textContent = '✓ Test page printed successfully.';
      testResult.className = 'hint success';
    } else {
      throw new Error(result?.message || 'Unknown error');
    }
  } catch (err) {
    dot.className = 'status-dot err';
    statusText.textContent = 'Printer error';
    testResult.textContent = `✕ ${err.message}`;
    testResult.className = 'hint error';
  } finally {
    btnTest.disabled = false;
    btnTest.textContent = '🖨️ Send Test Print';
  }
});

// ── Save config ───────────────────────────────────────────────────────────────
btnSave.addEventListener('click', async () => {
  btnSave.disabled = true;
  saveResult.textContent = '';
  saveResult.className = 'hint';

  try {
    const val = select.value;
    await window.electronAPI.setPrinterConfig({
      printerName: val === 'auto' ? '' : val,
      interface: val,
    });
    saveResult.textContent = '✓ Configuration saved.';
    saveResult.className = 'hint success';
  } catch (err) {
    saveResult.textContent = `✕ ${err.message}`;
    saveResult.className = 'hint error';
  } finally {
    btnSave.disabled = false;
    setTimeout(() => {
      saveResult.textContent = '';
      saveResult.className = 'hint';
    }, 3000);
  }
});
