// src/renderer/settings.js
// Settings page JS — interacts with the main process via window.electronAPI

const dot        = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const btnTest    = document.getElementById('btn-test');
const testResult = document.getElementById('test-result');
const select     = document.getElementById('printer-interface');
const btnSave    = document.getElementById('btn-save');
const saveResult = document.getElementById('save-result');
const bridgeStatus = document.getElementById('bridge-status');
const platformInfo = document.getElementById('platform-info');

// ── Bridge / platform info ────────────────────────────────────────────────────
if (window.electronAPI) {
  bridgeStatus.textContent = 'Active ✓';
  bridgeStatus.className = 'badge badge-ok';
  platformInfo.textContent = window.electronAPI.platform;
} else {
  bridgeStatus.textContent = 'Not found';
  bridgeStatus.className = 'badge badge-err';
}

// ── Load saved config ─────────────────────────────────────────────────────────
async function loadConfig() {
  if (!window.electronAPI) return;
  const config = await window.electronAPI.getPrinterConfig();
  if (config?.interface) select.value = config.interface;
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
    await window.electronAPI.setPrinterConfig({ interface: select.value });
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
