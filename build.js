const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('===================================================');
console.log('  ⚡ AUTONEXIS Vercel Build Handler');
console.log('===================================================');
console.log('Current working directory:', process.cwd());

// Locate frontend directory regardless of whether invoked from root or api/
let frontendDir = path.join(process.cwd(), 'frontend');
if (!fs.existsSync(frontendDir)) {
  frontendDir = path.join(process.cwd(), '..', 'frontend');
}

if (!fs.existsSync(frontendDir)) {
  console.error('❌ Could not locate frontend directory at:', frontendDir);
  process.exit(1);
}

console.log('📁 Located frontend directory at:', frontendDir);

// 1. Install frontend dependencies with optional dependencies included
console.log('📦 Installing frontend dependencies (including optional)...');
execSync('npm install --include=optional', { cwd: frontendDir, stdio: 'inherit' });

// 2. Build frontend production assets
console.log('🔨 Building frontend production bundle...');
execSync('npm run build', { cwd: frontendDir, stdio: 'inherit' });

// 3. If running inside api/ folder, duplicate dist so Vercel finds outputDirectory
const cwdDist = path.join(process.cwd(), 'frontend', 'dist');
const builtDist = path.join(frontendDir, 'dist');

if (process.cwd().endsWith('api') && !fs.existsSync(cwdDist)) {
  console.log('📂 Mirroring dist to current api directory:', cwdDist);
  fs.mkdirSync(path.join(process.cwd(), 'frontend'), { recursive: true });
  fs.cpSync(builtDist, cwdDist, { recursive: true });
}

console.log('✅ Build completed successfully!');
