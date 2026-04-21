const fs = require('fs');
const os = require('os');
const path = require('path');

function getUploadsRoot() {
  const override = process.env.UPLOADS_DIR?.trim();
  if (override) return path.resolve(override);

  if (process.env.NODE_ENV === 'production') {
    return path.join(os.tmpdir(), 'resumexray-uploads');
  }

  return path.join(__dirname, '..', 'public', 'uploads');
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  return dirPath;
}

function ensureUploadsRoot() {
  return ensureDir(getUploadsRoot());
}

function getAvatarUploadsDir() {
  return ensureDir(path.join(getUploadsRoot(), 'avatars'));
}

function uploadUrlToPath(uploadUrl) {
  if (typeof uploadUrl !== 'string' || !uploadUrl.startsWith('/uploads/')) {
    return null;
  }

  const relativePath = uploadUrl.replace(/^\/uploads\//, '');
  if (!relativePath) return null;

  const uploadsRoot = path.resolve(getUploadsRoot());
  const diskPath = path.resolve(uploadsRoot, relativePath);
  if (!diskPath.startsWith(`${uploadsRoot}${path.sep}`) && diskPath !== uploadsRoot) {
    return null;
  }

  return diskPath;
}

module.exports = {
  ensureUploadsRoot,
  getAvatarUploadsDir,
  getUploadsRoot,
  uploadUrlToPath,
};
