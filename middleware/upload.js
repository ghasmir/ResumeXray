const multer = require('multer');
const path = require('path');

// Allowed MIME types
const ALLOWED_TYPES = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword': 'doc',
  'text/plain': 'txt',
};

const MAX_SIZE = 5 * 1024 * 1024; // 5MB — reduced from 10MB for security

const storage = multer.memoryStorage();

/**
 * Magic byte validation — checks file headers to prevent spoofed MIME types.
 * PDF: %PDF (0x25504446)
 * DOCX/ZIP: PK (0x504B0304)
 */
function validateMagicBytes(buffer, mimetype) {
  if (!buffer || buffer.length < 4) return false;

  if (mimetype === 'application/pdf') {
    // PDF magic: %PDF
    return buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;
  }

  if (mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    // DOCX is a ZIP archive: PK\x03\x04
    return buffer[0] === 0x50 && buffer[1] === 0x4B && buffer[2] === 0x03 && buffer[3] === 0x04;
  }

  if (mimetype === 'application/msword') {
    // Legacy .doc (OLE2 Compound Document): \xD0\xCF\x11\xE0
    return buffer[0] === 0xD0 && buffer[1] === 0xCF && buffer[2] === 0x11 && buffer[3] === 0xE0;
  }

  if (mimetype === 'text/plain') {
    // Plain text — no magic bytes to validate, accept all
    return true;
  }

  return false;
}

const upload = multer({
  storage,
  limits: { 
    fileSize: MAX_SIZE,
    files: 1,          // Only 1 file per request
    fields: 10,        // Max 10 non-file fields
    fieldSize: 50000,  // Max 50KB per field (prevents JD text bombs)
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();

    // Strict: must match BOTH extension AND MIME type
    if (ext === '.pdf' && file.mimetype === 'application/pdf') {
      cb(null, true);
    } else if (ext === '.docx' && file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      cb(null, true);
    } else if (ext === '.doc' && file.mimetype === 'application/msword') {
      cb(null, true);
    } else if (ext === '.txt' && file.mimetype === 'text/plain') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF, DOCX, DOC, and TXT files are allowed. The file extension must match its type.'), false);
    }
  },
});

module.exports = { upload, ALLOWED_TYPES, MAX_SIZE, validateMagicBytes };
