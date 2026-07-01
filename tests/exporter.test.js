const fs = require('fs/promises');
const path = require('path');
const ExcelJS = require('exceljs');
const { exportCsv, exportXlsx, resolveExportRows } = require('../src/modules/exporter');
const { ExportError } = require('../src/errors');
const { createTempDir } = require('./helpers/fixtures');

const UNIMED_SAMPLE_PATH = path.join(__dirname, 'fixtures', 'unimed-guias-sample.txt');

function buildResult(overrides = {}) {
  return {
    inputFile: 'doc.pdf',
    outputFile: '/tmp/output/doc.txt',
    pageCount: 2,
    charCount: 20,
    text: 'Texto extraído...',
    extractedAt: '2026-06-29T15:00:00.000Z',
    ...overrides,
  };
}

async function readWorksheet(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  return workbook.worksheets[0];
}

describe('exporter — CSV', () => {
  let outputDir;

  beforeEach(async () => {
    outputDir = await createTempDir('exporter-csv-');
  });

  afterEach(async () => {
    await fs.rm(outputDir, { recursive: true, force: true });
  });

  test('[RED-19] deve gerar um arquivo .csv com cabeçalho de tabela quando houver linhas de dados', async () => {
    const sampleText = await fs.readFile(UNIMED_SAMPLE_PATH, 'utf8');
    const { filePath } = await exportCsv(
      [buildResult({ inputFile: 'unimed.pdf', text: sampleText })],
      outputDir,
      { fileName: 'export.csv' },
    );
    const content = await fs.readFile(filePath, 'utf8');

    expect(content).toContain('guia');
    expect(content).toContain('beneficiario');
    expect(content).toContain('codigo_procedimento');
    expect(content).toContain('7063165');
    expect(content).not.toContain('Controle de Guias');
    expect(content).not.toContain('Total de beneficiários');
  });

  test('[RED-20] deve aceitar array de resultados de extração como entrada', async () => {
    const sampleText = await fs.readFile(UNIMED_SAMPLE_PATH, 'utf8');
    const results = [
      buildResult({ inputFile: 'a.pdf', text: sampleText }),
      buildResult({ inputFile: 'b.pdf', text: sampleText }),
    ];

    const { filePath, rowCount } = await exportCsv(results, outputDir, { fileName: 'export.csv' });
    const lines = (await fs.readFile(filePath, 'utf8')).trim().split('\n');

    expect(rowCount).toBe(8);
    expect(lines).toHaveLength(9);
  });

  test('[RED-21] deve escapar corretamente campos com vírgula, aspas e quebras de linha no CSV', async () => {
    const text = [
      '7063165 28/05/202 MARIA, DA SILVA 25 13 DR. TESTE REQUISIÇÃO: 604643990',
      '50000470 PROCEDIMENTO COM "ASPAS" POR 1',
    ].join('\n');

    const { filePath } = await exportCsv([buildResult({ text })], outputDir, { fileName: 'export.csv' });
    const content = await fs.readFile(filePath, 'utf8');

    expect(content).toContain('MARIA, DA SILVA');
    expect(content).toContain('PROCEDIMENTO COM ""ASPAS""');
  });

  test('[RED-22] deve retornar o caminho absoluto do arquivo .csv gerado', async () => {
    const { filePath } = await exportCsv([buildResult({ inputFile: 'relatorio.pdf' })], outputDir);

    expect(path.isAbsolute(filePath)).toBe(true);
    expect(path.basename(filePath)).toBe('relatorio.csv');
  });

  test('nome padrão do arquivo deve seguir o nome do PDF de origem', async () => {
    const sampleText = await fs.readFile(UNIMED_SAMPLE_PATH, 'utf8');
    const { filePath } = await exportCsv(
      [buildResult({ inputFile: 'Produção unimed pgto070726.PDF', text: sampleText })],
      outputDir,
    );

    expect(path.basename(filePath)).toBe('Produ__o_unimed_pgto070726.csv');
  });

  test('[RED-23] deve lançar ExportError se o array de entrada estiver vazio', async () => {
    await expect(exportCsv([], outputDir)).rejects.toThrow(ExportError);
  });

  test('usa fallback raw quando não há tabela e fallback está habilitado', async () => {
    const resolved = resolveExportRows([buildResult()], { fallbackToRaw: true });
    expect(resolved.mode).toBe('raw');
    expect(resolved.rows[0].content).toBe('Texto extraído...');
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
    const sampleText = await fs.readFile(UNIMED_SAMPLE_PATH, 'utf8');
    const { filePath } = await exportXlsx(
      [buildResult({ text: sampleText })],
      outputDir,
      { fileName: 'export.xlsx' },
    );

    const worksheet = await readWorksheet(filePath);
    expect(worksheet).toBeDefined();
    expect(worksheet.name).toBe('documents');
  });

  test('[RED-25] deve incluir cabeçalhos das colunas da tabela extraída', async () => {
    const sampleText = await fs.readFile(UNIMED_SAMPLE_PATH, 'utf8');
    const { filePath } = await exportXlsx(
      [buildResult({ text: sampleText })],
      outputDir,
      { fileName: 'export.xlsx' },
    );
    const worksheet = await readWorksheet(filePath);
    const headerRow = worksheet.getRow(1).values.slice(1);

    expect(headerRow).toEqual([
      'source_pdf',
      'guia',
      'dt_emis',
      'beneficiario',
      'id_beneficiario',
      'pl',
      'medico',
      'requisicao',
      'codigo_procedimento',
      'procedimento',
      'qt',
    ]);
  });

  test('[RED-26] cada linha exportada deve conter apenas dados da tabela do PDF', async () => {
    const sampleText = await fs.readFile(UNIMED_SAMPLE_PATH, 'utf8');
    const { filePath, rowCount } = await exportXlsx(
      [buildResult({ inputFile: 'unimed.pdf', text: sampleText })],
      outputDir,
      { fileName: 'export.xlsx' },
    );
    const worksheet = await readWorksheet(filePath);
    const dataRow = worksheet.getRow(2).values.slice(1);

    expect(rowCount).toBe(4);
    expect(dataRow[0]).toBe('unimed.pdf');
    expect(dataRow[1]).toBe('7063165');
    expect(dataRow[3]).toBe('INGRID PINHEIRO ACIOLI');
    expect(dataRow[8]).toBe('50000470');
    expect(dataRow[10]).toBe('1');
  });

  test('[RED-27] o arquivo Excel gerado deve ser válido (parseável por exceljs)', async () => {
    const sampleText = await fs.readFile(UNIMED_SAMPLE_PATH, 'utf8');
    const { filePath } = await exportXlsx(
      [buildResult({ text: sampleText })],
      outputDir,
      { fileName: 'export.xlsx' },
    );

    await expect(readWorksheet(filePath)).resolves.toBeDefined();
  });

  test('[RED-28] deve retornar o caminho absoluto do arquivo .xlsx gerado', async () => {
    const { filePath } = await exportXlsx([buildResult({ inputFile: 'relatorio.pdf' })], outputDir, {
      fallbackToRaw: true,
    });

    expect(path.isAbsolute(filePath)).toBe(true);
    expect(path.basename(filePath)).toBe('relatorio.xlsx');
  });

  test('[RED-29] deve lançar ExportError se o array de entrada estiver vazio', async () => {
    await expect(exportXlsx([], outputDir)).rejects.toThrow(ExportError);
  });
});
