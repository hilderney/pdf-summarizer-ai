const fs = require('fs/promises');
const path = require('path');
const { ExportError } = require('../errors');
const { createCsvWriterAdapter } = require('../adapters/csvWriterAdapter');
const { createXmlBuilderAdapter } = require('../adapters/xmlBuilderAdapter');

const CSV_HEADERS = [
  { id: 'filename', title: 'filename' },
  { id: 'source_pdf', title: 'source_pdf' },
  { id: 'extracted_at', title: 'extracted_at' },
  { id: 'content', title: 'content' },
];

function assertNonEmptyResults(results) {
  if (!Array.isArray(results) || results.length === 0) {
    throw new ExportError('Export requires at least one extraction result');
  }
}

function toExportRows(results) {
  return results.map((result) => ({
    filename: path.basename(result.outputFile),
    source_pdf: result.inputFile,
    extracted_at: result.extractedAt || new Date().toISOString(),
    content: result.text || '',
  }));
}

function buildExportFileName(extension) {
  const date = new Date().toISOString().slice(0, 10);
  return `export_${date}.${extension}`;
}

async function exportCsv(results, outputDir, options = {}) {
  assertNonEmptyResults(results);

  const {
    fileName = buildExportFileName('csv'),
    csvWriterAdapter = createCsvWriterAdapter(),
    fsImpl = fs,
  } = options;

  const absoluteOutputDir = path.resolve(outputDir);
  const filePath = path.join(absoluteOutputDir, fileName);
  const rows = toExportRows(results);

  try {
    await csvWriterAdapter.write(filePath, rows, CSV_HEADERS);
  } catch (error) {
    throw new ExportError(`Failed to write CSV: ${filePath}`, error);
  }

  return { filePath: path.resolve(filePath) };
}

async function exportXml(results, outputDir, options = {}) {
  assertNonEmptyResults(results);

  const {
    fileName = buildExportFileName('xml'),
    xmlBuilderAdapter = createXmlBuilderAdapter(),
    fsImpl = fs,
  } = options;

  const absoluteOutputDir = path.resolve(outputDir);
  const filePath = path.join(absoluteOutputDir, fileName);
  const rows = toExportRows(results);

  try {
    await xmlBuilderAdapter.write(filePath, {
      generatedAt: new Date().toISOString(),
      items: rows.map((row) => ({
        filename: row.filename,
        sourcePdf: row.source_pdf,
        extractedAt: row.extracted_at,
        content: row.content,
      })),
    });
  } catch (error) {
    throw new ExportError(`Failed to write XML: ${filePath}`, error);
  }

  return { filePath: path.resolve(filePath) };
}

module.exports = {
  exportCsv,
  exportXml,
  CSV_HEADERS,
};
