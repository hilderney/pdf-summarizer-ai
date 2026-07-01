const fs = require('fs/promises');
const path = require('path');
const ExcelJS = require('exceljs');
const { exportCsv, exportXlsx } = require('../src/modules/exporter');
const { ExportError } = require('../src/errors');
const { createTempDir } = require('./helpers/fixtures');

function buildResults(overrides = {}) {
  return [
    {
      inputFile: 'doc.pdf',
      outputFile: '/tmp/output/doc.txt',
      pageCount: 2,
      charCount: 20,
      text: 'Texto extraído...',
      extractedAt: '2026-06-29T15:00:00.000Z',
      ...overrides,
    },
  ];
}

async function readWorksheet(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  return workbook.getWorksheet('documents');
}

describe('exporter — CSV', () => {
  let outputDir;

  beforeEach(async () => {
    outputDir = await createTempDir('exporter-csv-');
  });

  afterEach(async () => {
    await fs.rm(outputDir, { recursive: true, force: true });
  });

  test('[RED-19] deve gerar um arquivo .csv com cabeçalho: filename, source_pdf, extracted_at, content', async () => {
    const { filePath } = await exportCsv(buildResults(), outputDir, {
      fileName: 'export.csv',
    });
    const content = await fs.readFile(filePath, 'utf8');

    expect(content).toContain('filename');
    expect(content).toContain('source_pdf');
    expect(content).toContain('extracted_at');
    expect(content).toContain('content');
    expect(content.trim().split('\n')[0]).toMatch(/filename.*source_pdf.*extracted_at.*content/);
  });

  test('[RED-20] deve aceitar array de resultados de extração como entrada', async () => {
    const results = [
      buildResults()[0],
      {
        ...buildResults()[0],
        inputFile: 'other.pdf',
        outputFile: '/tmp/output/other.txt',
        text: 'Outro texto',
      },
    ];

    const { filePath } = await exportCsv(results, outputDir, { fileName: 'export.csv' });
    const lines = (await fs.readFile(filePath, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(3);
  });

  test('[RED-21] deve escapar corretamente campos com vírgula, aspas e quebras de linha no CSV', async () => {
    const results = buildResults({
      text: 'Linha 1, com vírgula\n"aspas" e quebra',
    });

    const { filePath } = await exportCsv(results, outputDir, { fileName: 'export.csv' });
    const content = await fs.readFile(filePath, 'utf8');

    expect(content).toContain('"Linha 1, com vírgula\n""aspas"" e quebra"');
  });

  test('[RED-22] deve retornar o caminho absoluto do arquivo .csv gerado', async () => {
    const { filePath } = await exportCsv(buildResults(), outputDir, {
      fileName: 'export.csv',
    });

    expect(path.isAbsolute(filePath)).toBe(true);
    expect(filePath).toBe(path.join(outputDir, 'export.csv'));
  });

  test('[RED-23] deve lançar ExportError se o array de entrada estiver vazio', async () => {
    await expect(exportCsv([], outputDir)).rejects.toThrow(ExportError);
  });
});

describe('exporter — Excel', () => {
  let outputDir;

  beforeEach(async () => {
    outputDir = await createTempDir('exporter-xlsx-');
  });

  afterEach(async () => {
    await fs.rm(outputDir, { recursive: true, force: true });
  });

  test('[RED-24] deve gerar um arquivo .xlsx com planilha documents', async () => {
    const { filePath } = await exportXlsx(buildResults(), outputDir, {
      fileName: 'export.xlsx',
    });

    const worksheet = await readWorksheet(filePath);
    expect(worksheet).toBeDefined();
    expect(worksheet.name).toBe('documents');
  });

  test('[RED-25] deve incluir cabeçalhos filename, source_pdf, extracted_at e content', async () => {
    const { filePath } = await exportXlsx(buildResults(), outputDir, {
      fileName: 'export.xlsx',
    });
    const worksheet = await readWorksheet(filePath);
    const headerRow = worksheet.getRow(1).values.slice(1);

    expect(headerRow).toEqual(['filename', 'source_pdf', 'extracted_at', 'content']);
  });

  test('[RED-26] o conteúdo extraído deve estar na coluna content', async () => {
    const { filePath } = await exportXlsx(buildResults(), outputDir, {
      fileName: 'export.xlsx',
    });
    const worksheet = await readWorksheet(filePath);
    const dataRow = worksheet.getRow(2).values.slice(1);

    expect(dataRow[0]).toBe('doc.txt');
    expect(dataRow[1]).toBe('doc.pdf');
    expect(dataRow[2]).toBe('2026-06-29T15:00:00.000Z');
    expect(dataRow[3]).toBe('Texto extraído...');
  });

  test('[RED-27] o arquivo Excel gerado deve ser válido (parseável por exceljs)', async () => {
    const { filePath } = await exportXlsx(buildResults(), outputDir, {
      fileName: 'export.xlsx',
    });

    await expect(readWorksheet(filePath)).resolves.toBeDefined();
  });

  test('[RED-28] deve retornar o caminho absoluto do arquivo .xlsx gerado', async () => {
    const { filePath } = await exportXlsx(buildResults(), outputDir, {
      fileName: 'export.xlsx',
    });

    expect(path.isAbsolute(filePath)).toBe(true);
    expect(filePath).toBe(path.join(outputDir, 'export.xlsx'));
  });

  test('[RED-29] deve lançar ExportError se o array de entrada estiver vazio', async () => {
    await expect(exportXlsx([], outputDir)).rejects.toThrow(ExportError);
  });
});
