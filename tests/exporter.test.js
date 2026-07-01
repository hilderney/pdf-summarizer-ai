const fs = require('fs/promises');
const path = require('path');
const { exportCsv, exportXml } = require('../src/modules/exporter');
const { ExportError } = require('../src/errors');
const { create } = require('xmlbuilder2');
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

describe('exporter — XML', () => {
  let outputDir;

  beforeEach(async () => {
    outputDir = await createTempDir('exporter-xml-');
  });

  afterEach(async () => {
    await fs.rm(outputDir, { recursive: true, force: true });
  });

  test('[RED-24] deve gerar um arquivo .xml bem-formado (tag raiz <documents>)', async () => {
    const { filePath } = await exportXml(buildResults(), outputDir, {
      fileName: 'export.xml',
    });
    const content = await fs.readFile(filePath, 'utf8');

    expect(content).toContain('<documents');
    expect(content).toContain('generated_at=');
  });

  test('[RED-25] cada item deve ser uma tag <document> com atributos filename e extracted_at', async () => {
    const { filePath } = await exportXml(buildResults(), outputDir, {
      fileName: 'export.xml',
    });
    const content = await fs.readFile(filePath, 'utf8');

    expect(content).toContain('<document filename="doc.txt"');
    expect(content).toContain('source_pdf="doc.pdf"');
    expect(content).toContain('extracted_at="2026-06-29T15:00:00.000Z"');
  });

  test('[RED-26] o conteúdo de texto deve estar dentro de <content><![CDATA[...]]></content>', async () => {
    const { filePath } = await exportXml(buildResults(), outputDir, {
      fileName: 'export.xml',
    });
    const content = await fs.readFile(filePath, 'utf8');

    expect(content).toContain('<content><![CDATA[Texto extraído...]]></content>');
  });

  test('[RED-27] o arquivo XML gerado deve ser válido (parseável por xmlbuilder2 ou parser)', async () => {
    const { filePath } = await exportXml(buildResults(), outputDir, {
      fileName: 'export.xml',
    });
    const content = await fs.readFile(filePath, 'utf8');

    expect(() => create(content)).not.toThrow();
  });

  test('[RED-28] deve retornar o caminho absoluto do arquivo .xml gerado', async () => {
    const { filePath } = await exportXml(buildResults(), outputDir, {
      fileName: 'export.xml',
    });

    expect(path.isAbsolute(filePath)).toBe(true);
    expect(filePath).toBe(path.join(outputDir, 'export.xml'));
  });

  test('[RED-29] deve lançar ExportError se o array de entrada estiver vazio', async () => {
    await expect(exportXml([], outputDir)).rejects.toThrow(ExportError);
  });
});
