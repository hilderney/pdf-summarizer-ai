const fs = require('fs/promises');
const path = require('path');
const { stagePdfFiles } = require('../src/modules/stagingUpload');
const { createValidPdfBuffer, createTempDir } = require('./helpers/fixtures');

describe('stagingUpload', () => {
  let stagingRoot;

  beforeEach(async () => {
    stagingRoot = await createTempDir('staging-upload-');
  });

  afterEach(async () => {
    await fs.rm(stagingRoot, { recursive: true, force: true });
  });

  test('stagePdfFiles grava PDFs e retorna inputDir', async () => {
    const buffer = await createValidPdfBuffer('upload test');
    const result = await stagePdfFiles(
      [{ name: 'sample.pdf', data: buffer.toString('base64') }],
      stagingRoot,
    );

    expect(result.pdfCount).toBe(1);
    expect(result.inputDir).toContain(stagingRoot);

    const files = await fs.readdir(result.inputDir);
    expect(files.some((name) => name.endsWith('.pdf'))).toBe(true);
  });

  test('stagePdfFiles rejeita arquivos não-PDF', async () => {
    await expect(
      stagePdfFiles([{ name: 'notes.txt', data: Buffer.from('x').toString('base64') }], stagingRoot),
    ).rejects.toThrow('Only PDF files are allowed');
  });
});
