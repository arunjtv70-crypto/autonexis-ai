const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function runBuild() {
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

  // 1. Install frontend dependencies (forcing development mode to include devDependencies & optional)
  console.log('📦 Installing frontend dependencies (including dev & optional)...');
  execSync('npm install --production=false --include=dev --include=optional', {
    cwd: frontendDir,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'development' }
  });

  // 2. Build frontend production assets
  console.log('🔨 Building frontend production bundle...');
  execSync('npm run build', {
    cwd: frontendDir,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'production' }
  });

  // 3. Mirror dist to current directory/frontend/dist if running in a subfolder (like api)
  const cwdDist = path.join(process.cwd(), 'frontend', 'dist');
  const builtDist = path.join(frontendDir, 'dist');

  if (path.resolve(cwdDist) !== path.resolve(builtDist)) {
    console.log('📂 Mirroring dist to current directory:', cwdDist);
    fs.mkdirSync(path.join(process.cwd(), 'frontend'), { recursive: true });
    fs.cpSync(builtDist, cwdDist, { recursive: true });
  }

  console.log('✅ Build completed successfully!');
}

if (require.main === module) {
  runBuild();
}

// Export handler so Vercel does not fail if treated as a Serverless Function
module.exports = (req, res) => {
  if (res && typeof res.status === 'function') {
    res.status(200).json({ status: 'ok', message: 'AUTONEXIS build handler' });
  }
};
