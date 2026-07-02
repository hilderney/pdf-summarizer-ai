const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { ValidationError } = require('../errors');
const { sanitizeBaseName } = require('../utils/paths');
const { isPdfFile } = require('./fsBrowser');

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;

async function stagePdfFiles(files, stagingRoot = './staging') {
  if (!Array.isArray(files) || files.length === 0) {
    throw new ValidationError('At least one PDF file is required');
  }

  const sessionId = crypto.randomUUID();
  const inputDir = path.resolve(stagingRoot, sessionId);
  await fs.mkdir(inputDir, { recursive: true });

  const saved = [];
  let totalBytes = 0;

  for (const file of files) {
    if (!file?.name || !file?.data) {
      throw new ValidationError('Each file must have name and data');
    }

    if (!isPdfFile(file.name)) {
      throw new ValidationError(`Only PDF files are allowed: ${file.name}`);
    }

    const buffer = Buffer.from(file.data, 'base64');
    if (buffer.length > MAX_FILE_BYTES) {
      throw new ValidationError(`File too large (max 50MB): ${file.name}`);
    }

    totalBytes += buffer.length;
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new ValidationError('Total upload size exceeds 200MB');
    }

    const safeName = `${sanitizeBaseName(file.name)}.pdf`;
    const targetPath = path.join(inputDir, safeName);
    await fs.writeFile(targetPath, buffer);

    saved.push({
      name: safeName,
      path: targetPath,
      sizeBytes: buffer.length,
    });
  }

  return {
    inputDir,
    sessionId,
    pdfCount: saved.length,
    files: saved,
  };
}

module.exports = {
  stagePdfFiles,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
};
