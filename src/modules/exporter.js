const fs = require('fs/promises');
const path = require('path');
const { ExportError } = require('../errors');
const { createCsvWriterAdapter } = require('../adapters/csvWriterAdapter');
const { createExcelWriterAdapter } = require('../adapters/excelWriterAdapter');
const {
  createTableParserAdapter,
  TABLE_EXPORT_HEADERS,
} = require('../adapters/tableParserAdapter');
const { buildOutputBaseName } = require('../utils/paths');
const { parseUnimedMetadata } = require('./unimedMetadataParser');
const { buildUnimedSpreadsheet } = require('./unimedSpreadsheetLayout');

const LEGACY_HEADERS = [
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

function buildExportFileNameFromPdf(inputFile, extension) {
  return `${buildOutputBaseName(inputFile, 'pdf')}.${extension}`;
}

function resolveExportFileName(results, extension, fileName) {
  if (fileName) {
    return fileName;
  }

  if (results.length === 1) {
    return buildExportFileNameFromPdf(results[0].inputFile, extension);
  }

  const date = new Date().toISOString().slice(0, 10);
  return `export_${date}.${extension}`;
}

function toLegacyRows(results) {
  return results.map((result) => ({
    filename: path.basename(result.outputFile),
    source_pdf: result.inputFile,
    extracted_at: result.extractedAt || new Date().toISOString(),
    content: result.text || '',
  }));
}

function toTableRows(results, options = {}) {
  const {
    tableParserAdapter = createTableParserAdapter('auto'),
    tableOnly = true,
  } = options;

  const exportRows = [];

  for (const result of results) {
    const parsed = tableParserAdapter.parse(result.text || '');
    for (const row of parsed.rows) {
      if (!row.guia || !row.codigo_procedimento) {
        if (!tableOnly) {
          exportRows.push({
            source_pdf: result.inputFile,
            guia: row.guia || '',
            dt_emis: row.dt_emis || '',
            beneficiario: row.beneficiario || row.content || '',
            id_beneficiario: row.id_beneficiario || '',
            pl: row.pl || '',
            medico: row.medico || '',
            requisicao: row.requisicao || '',
            codigo_procedimento: row.codigo_procedimento || '',
            procedimento: row.procedimento || '',
            qt: row.qt || '',
          });
        }
        continue;
      }

      exportRows.push({
        source_pdf: result.inputFile,
        guia: row.guia,
        dt_emis: row.dt_emis,
        beneficiario: row.beneficiario,
        id_beneficiario: row.id_beneficiario,
        pl: row.pl,
        medico: row.medico,
        requisicao: row.requisicao,
        codigo_procedimento: row.codigo_procedimento,
        procedimento: row.procedimento,
        qt: row.qt,
      });
    }
  }

  return exportRows;
}

function resolveExportFormat(options = {}) {
  if (options.format === 'legacy') {
    return 'legacy';
  }
  return 'unimed-report';
}

function collectTableRowsFromResults(results, options = {}) {
  const {
    tableParserAdapter = createTableParserAdapter('auto'),
    tableOnly = true,
  } = options;

  const exportRows = [];

  for (const result of results) {
    const parsed = tableParserAdapter.parse(result.text || '');
    for (const row of parsed.rows) {
      if (!row.guia || !row.codigo_procedimento) {
        if (!tableOnly) {
          exportRows.push(row);
        }
        continue;
      }
      exportRows.push(row);
    }
  }

  return exportRows;
}

function resolveUnimedSheet(results, options = {}) {
  const tableRows = collectTableRowsFromResults(results, options);
  let sourceText = '';

  for (const result of results) {
    const metadata = parseUnimedMetadata(result.text || '');
    if (metadata.prestador) {
      sourceText = result.text || '';
      break;
    }
  }

  if (!sourceText && results.length > 0) {
    sourceText = results[0].text || '';
  }

  return buildUnimedSpreadsheet({ text: sourceText, rows: tableRows });
}

function resolveExportRows(results, options = {}) {
  const {
    tableOnly = true,
    fallbackToRaw = true,
    tableParserAdapter = createTableParserAdapter('auto'),
  } = options;

  const tableRows = toTableRows(results, { tableOnly, tableParserAdapter });

  if (tableRows.length > 0) {
    return {
      rows: tableRows,
      headers: TABLE_EXPORT_HEADERS,
      mode: 'table',
    };
  }

  if (tableOnly && !fallbackToRaw) {
    throw new ExportError('No table rows found in extraction results');
  }

  return {
    rows: toLegacyRows(results),
    headers: LEGACY_HEADERS,
    mode: 'raw',
  };
}

async function exportCsv(results, outputDir, options = {}) {
  assertNonEmptyResults(results);

  const { csvWriterAdapter = createCsvWriterAdapter(), fileName } = options;
  const resolvedFileName = resolveExportFileName(results, 'csv', fileName);
  const absoluteOutputDir = path.resolve(outputDir);
  const filePath = path.join(absoluteOutputDir, resolvedFileName);
  const resolved = resolveExportRows(results, options);
  const format = resolveExportFormat(options);

  try {
    if (resolved.mode === 'table' && format === 'unimed-report') {
      const sheet = resolveUnimedSheet(results, options);
      await csvWriterAdapter.writeSheet(filePath, sheet.sheetRows, options);
      return {
        filePath: path.resolve(filePath),
        rowCount: sheet.dataRowCount,
        sourcePdf: results.length === 1 ? results[0].inputFile : null,
        format: 'unimed-report',
      };
    }

    await csvWriterAdapter.write(filePath, resolved.rows, resolved.headers);
  } catch (error) {
    throw new ExportError(`Failed to write CSV: ${filePath}`, error);
  }

  return {
    filePath: path.resolve(filePath),
    rowCount: resolved.rows.length,
    sourcePdf: results.length === 1 ? results[0].inputFile : null,
    format: resolved.mode === 'table' ? 'legacy' : resolved.mode,
  };
}

async function exportXlsx(results, outputDir, options = {}) {
  assertNonEmptyResults(results);

  const { excelWriterAdapter = createExcelWriterAdapter(), fileName } = options;
  const resolvedFileName = resolveExportFileName(results, 'xlsx', fileName);
  const absoluteOutputDir = path.resolve(outputDir);
  const filePath = path.join(absoluteOutputDir, resolvedFileName);
  const resolved = resolveExportRows(results, options);
  const format = resolveExportFormat(options);

  try {
    if (resolved.mode === 'table' && format === 'unimed-report') {
      const sheet = resolveUnimedSheet(results, options);
      await excelWriterAdapter.writeSheet(filePath, sheet.sheetRows, options);
      return {
        filePath: path.resolve(filePath),
        rowCount: sheet.dataRowCount,
        sourcePdf: results.length === 1 ? results[0].inputFile : null,
        format: 'unimed-report',
      };
    }

    await excelWriterAdapter.write(filePath, resolved.rows, resolved.headers);
  } catch (error) {
    throw new ExportError(`Failed to write Excel: ${filePath}`, error);
  }

  return {
    filePath: path.resolve(filePath),
    rowCount: resolved.rows.length,
    sourcePdf: results.length === 1 ? results[0].inputFile : null,
    format: resolved.mode === 'table' ? 'legacy' : resolved.mode,
  };
}

module.exports = {
  exportCsv,
  exportXlsx,
  resolveExportRows,
  resolveUnimedSheet,
  resolveExportFormat,
  toTableRows,
  buildExportFileNameFromPdf,
  resolveExportFileName,
  EXPORT_HEADERS: TABLE_EXPORT_HEADERS,
  CSV_HEADERS: TABLE_EXPORT_HEADERS,
  LEGACY_HEADERS,
};
