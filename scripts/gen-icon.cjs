const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const pngToIco = require('png-to-ico').default;

const logoPath = path.join(__dirname, '..', 'public', 'assets', 'logo.png');
const buildDir = path.join(__dirname, '..', 'build');
if (!fs.existsSync(buildDir)) fs.mkdirSync(buildDir, { recursive: true });

(async () => {
  // Pad to square with dark background matching logo
  const squarePng = path.join(buildDir, 'icon-square.png');
  await sharp(logoPath)
    .resize(512, 512, { fit: 'contain', background: { r: 10, g: 10, b: 15, alpha: 1 } })
    .png()
    .toFile(squarePng);
  console.log('Square PNG created:', squarePng);

  const buf = await pngToIco(squarePng);
  const icoPath = path.join(buildDir, 'icon.ico');
  fs.writeFileSync(icoPath, buf);
  console.log('ICO written:', icoPath, buf.length, 'bytes');
  fs.copyFileSync(icoPath, path.join(__dirname, '..', 'electron', 'icon.ico'));
  console.log('Copied to electron/icon.ico');
})().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
