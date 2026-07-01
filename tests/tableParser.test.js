const fs = require('fs/promises');
const path = require('path');
const {
  createTableParserAdapter,
  parseGuiaLine,
  parseProcedureLine,
  shouldSkipLine,
} = require('../src/adapters/tableParserAdapter');

const SAMPLE_PATH = path.join(__dirname, 'fixtures', 'unimed-guias-sample.txt');

describe('tableParser — Unimed', () => {
  let sampleText;

  beforeAll(async () => {
    sampleText = await fs.readFile(SAMPLE_PATH, 'utf8');
  });

  test('ignora cabeçalhos, rodapés e totais do documento', () => {
    expect(shouldSkipLine('Controle de Guias')).toBe(true);
    expect(shouldSkipLine('Guia Dt Emis Beneficiário Id Pl Médico Código Procedimento Qt Obs')).toBe(true);
    expect(shouldSkipLine('Impresso em: 25/06/2026 09:26:08 Página 1 CPLS39')).toBe(true);
    expect(shouldSkipLine('Total de beneficiários: 4')).toBe(true);
    expect(shouldSkipLine('Prestador PSICOVITAE - CONSULTORIO DE PSICOLOGIA Tipo guia: SP/SADT')).toBe(true);
  });

  test('reconhece linha de guia com beneficiário e requisição', () => {
    const row = parseGuiaLine(
      '7063165 28/05/202 INGRID PINHEIRO ACIOLI 25 13 BIANCA FERREIRA DE SOUZA REQUISIÇÃO: 604643990',
    );

    expect(row).toEqual({
      guia: '7063165',
      dt_emis: '28/05/202',
      beneficiario: 'INGRID PINHEIRO ACIOLI',
      id_beneficiario: '25',
      pl: '13',
      medico: 'BIANCA FERREIRA DE SOUZA',
      requisicao: '604643990',
    });
  });

  test('reconhece linha de procedimento com e sem POR', () => {
    expect(parseProcedureLine('50000470 SESSÃO DE PSICOTERAPIA INDIVIDUAL POR 1')).toEqual({
      codigo_procedimento: '50000470',
      procedimento: 'SESSÃO DE PSICOTERAPIA INDIVIDUAL',
      qt: '1',
    });

    expect(parseProcedureLine('50001221 CONSULTA AMBULATORIAL EM PSICOLOGIA 1')).toEqual({
      codigo_procedimento: '50001221',
      procedimento: 'CONSULTA AMBULATORIAL EM PSICOLOGIA',
      qt: '1',
    });
  });

  test('pareia guia e procedimento mesmo com quebra de página no meio', () => {
    const parser = createTableParserAdapter('unimed-guia');
    const result = parser.parse(sampleText);

    expect(result.rows).toHaveLength(4);
    expect(result.rows[0]).toMatchObject({
      guia: '7063165',
      beneficiario: 'INGRID PINHEIRO ACIOLI',
      codigo_procedimento: '50000470',
      qt: '1',
    });
    expect(result.rows[2]).toMatchObject({
      guia: '7047438',
      beneficiario: 'VALERIA CAETANO IMADA',
      codigo_procedimento: '50000470',
    });
    expect(result.rows[3]).toMatchObject({
      guia: '7060617',
      codigo_procedimento: '50001221',
      procedimento: 'CONSULTA AMBULATORIAL EM PSICOLOGIA',
    });
    expect(result.skippedLines.some((line) => line.includes('Controle de Guias'))).toBe(true);
    expect(result.skippedLines.some((line) => line.includes('Total de beneficiários'))).toBe(true);
  });
});
