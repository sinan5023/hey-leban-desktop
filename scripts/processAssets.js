// scripts/processAssets.js
// Runs automatically after `npm install` (postinstall hook).
// Converts assets to the formats needed by the app:
//   assets/icon.jpg  → assets/icon.png       (1024×1024, for Electron app icon)
//   assets/logo.jpg  → assets/logo-print.jpg (384px wide, for thermal printer)

const fs = require('fs');
const path = require('path');

const assetsDir = path.join(__dirname, '../assets');

async function run() {
  // sharp is a prod dependency so it's always available after install
  let sharp;
  try {
    sharp = require('sharp');
  } catch {
    console.log('[assets] sharp not available yet — skipping image processing.');
    return;
  }

  // ── icon.jpg → icon.png ──────────────────────────────────────────────────
  const iconSrc = path.join(assetsDir, 'icon.jpg');
  const iconDst = path.join(assetsDir, 'icon.png');
  if (fs.existsSync(iconSrc)) {
    await sharp(iconSrc).resize(1024, 1024).png().toFile(iconDst);
    console.log('[assets] ✅ icon.png generated from icon.jpg');
  } else if (!fs.existsSync(iconDst)) {
    console.warn('[assets] ⚠️  No icon.jpg or icon.png found in assets/ — app icon will be missing.');
  }

  // ── logo.jpg → logo-print.jpg ────────────────────────────────────────────
  const logoSrc = path.join(assetsDir, 'logo.jpg');
  const logoDst = path.join(assetsDir, 'logo-print.jpg');
  if (fs.existsSync(logoSrc)) {
    await sharp(logoSrc)
      .resize(384, null, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toFile(logoDst);
    console.log('[assets] ✅ logo-print.jpg generated (384px wide for 80mm thermal printer)');
  } else {
    console.warn('[assets] ⚠️  No logo.jpg found in assets/ — receipt will print without logo.');
  }
}

run().catch((err) => {
  // Non-fatal: don't break npm install if asset processing fails
  console.warn('[assets] ⚠️  Asset processing failed (non-fatal):', err.message);
});
