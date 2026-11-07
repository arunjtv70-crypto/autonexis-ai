const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('===================================================');
console.log('  ⚡ AUTONEXIS Vercel Build Handler (api subfolder)');
console.log('===================================================');
console.log('Current working directory:', process.cwd());

let frontendDir = path.join(process.cwd(), '..', 'frontend');
if (!fs.existsSync(frontendDir)) {
  frontendDir = path.join(process.cwd(), 'frontend');
}

if (!fs.existsSync(frontendDir)) {
  console.error('❌ Could not locate frontend directory at:', frontendDir);
  process.exit(1);
}

console.log('📁 Located frontend directory at:', frontendDir);

console.log('📦 Installing frontend dependencies...');
execSync('npm install', { cwd: frontendDir, stdio: 'inherit' });

console.log('🔨 Building frontend production bundle...');
execSync('npm run build', { cwd: frontendDir, stdio: 'inherit' });

// Mirror dist to api/frontend/dist so Vercel's outputDirectory matches
const cwdDist = path.join(process.cwd(), 'frontend', 'dist');
const builtDist = path.join(frontendDir, 'dist');
console.log('📂 Mirroring dist to current api directory:', cwdDist);
fs.mkdirSync(path.join(process.cwd(), 'frontend'), { recursive: true });
fs.cpSync(builtDist, cwdDist, { recursive: true });

console.log('✅ Build completed successfully!');
