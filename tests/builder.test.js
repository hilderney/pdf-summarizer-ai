const fs = require('fs/promises');
const path = require('path');
const { PdfSummarizerBuilder } = require('../src/pipeline/PdfSummarizerBuilder');
const { createTempDir, writeMinimalPdf } = require('./helpers/fixtures');

describe('PdfSummarizerBuilder', () => {
  let inputDir;
  let outputDir;
  let logsDir;

  beforeEach(async () => {
    inputDir = await createTempDir('builder-input-');
    outputDir = await createTempDir('builder-output-');
    logsDir = await createTempDir('builder-logs-');
    await writeMinimalPdf(inputDir, 'doc.pdf');
  });

  afterEach(async () => {
    await fs.rm(inputDir, { recursive: true, force: true });
    await fs.rm(outputDir, { recursive: true, force: true });
    await fs.rm(logsDir, { recursive: true, force: true });
  });

  test('executa pipeline completo com API fluente', async () => {
    const pipeline = PdfSummarizerBuilder.create()
      .fromDirectory(inputDir)
      .outputTo(outputDir)
      .withLogs(logsDir)
      .exportFormats(['csv', 'xlsx'])
      .withoutServer()
      .build();

    const summary = await pipeline.run();
    await pipeline.close();

    expect(summary.scanned).toBe(1);
    expect(summary.extracted).toBe(1);
    expect(summary.failed).toBe(0);
    expect(summary.exports.csv.filePath).toContain('.csv');
    expect(summary.exports.xlsx.filePath).toContain('.xlsx');
    await expect(fs.access(path.join(outputDir, 'doc.txt'))).resolves.toBeUndefined();
    await expect(fs.access(summary.logFile)).resolves.toBeUndefined();
  });
});
