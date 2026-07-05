const {
  buildResumoBlocks,
  buildResumoGeralSheetRows,
  groupRowsBySessionRate,
  spaceLetters,
} = require('../src/modules/unimedResumoGeral');
const { normalizeRow } = require('../src/modules/unimedSpreadsheetLayout');
const {
  parseBrazilianMoney,
  formatBrazilianMoney,
  formatSessionRate,
} = require('../src/modules/unimedMoney');

function rowWithValue(overrides) {
  return {
    guia: '100',
    dt_emis: '01/01/2026',
    beneficiario: 'PACIENTE TESTE',
    pl: '1',
    medico: 'BIANCA FERREIRA DE SOUZA',
    requisicao: '600',
    codigo_procedimento: '50000470',
    procedimento: 'PSICOTERAPIA',
    qt: '1',
    item: '45,54 R$',
    vlPago: '45,54 R$',
    ...overrides,
  };
}

describe('unimedMoney', () => {
  test('parseia e formata valores em reais', () => {
    expect(parseBrazilianMoney('45,54 R$')).toBeCloseTo(45.54);
    expect(parseBrazilianMoney('R$ 1.092,96')).toBeCloseTo(1092.96);
    expect(formatBrazilianMoney(1092.96)).toBe('1.092,96 R$');
    expect(formatSessionRate(40.42)).toBe('40,42 R$');
    expect(formatBrazilianMoney(0)).toBe('-');
  });
});

describe('unimedResumoGeral', () => {
  test('agrupa valores de sessão por Executante', () => {
    const rows = [
      rowWithValue({ qt: '2', item: '45,54 R$', vlPago: '45,54 R$' }),
      rowWithValue({ qt: '1', item: '40,42 R$', vlPago: '40,42 R$' }),
      rowWithValue({
        medico: 'VANESSA FERREIRA NASCIMENTO ZAPF',
        qt: '3',
        item: '40,42 R$',
        vlPago: '40,42 R$',
      }),
    ].map(normalizeRow);

    const { executantes, grandTotal } = buildResumoBlocks(rows);

    expect(executantes).toHaveLength(2);
    expect(executantes[0].shortName).toBe('BIANCA');
    expect(executantes[0].valueRows).toHaveLength(2);
    expect(executantes[0].valueRows[0].rateLabel).toBe('45,54 R$');
    expect(executantes[0].valueRows[0].quantity).toBe('2');
    expect(executantes[0].valueRows[0].totalLabel).toBe('91,08 R$');
    expect(executantes[0].totalQuantity).toBe(3);
    expect(executantes[1].totalQuantity).toBe(3);
    expect(grandTotal.totalQuantity).toBe(6);
    expect(grandTotal.totalLabel).toBe('252,76 R$');
  });

  test('monta linhas do RESUMO GERAL com blocos por Executante', () => {
    const rows = [
      rowWithValue({ qt: '1', item: '45,54 R$', vlPago: '45,54 R$' }),
      rowWithValue({
        medico: 'VANESSA FERREIRA NASCIMENTO ZAPF',
        qt: '2',
        item: '40,42 R$',
        vlPago: '40,42 R$',
      }),
    ].map(normalizeRow);

    const sheetRows = buildResumoGeralSheetRows(rows);
    const content = sheetRows.map((row) => row.cells.join('\t')).join('\n');

    expect(sheetRows.some((row) => row.type === 'resumo-title')).toBe(true);
    expect(content).toContain('RESUMO GERAL');
    expect(content).toContain('B I A N C A');
    expect(content).toContain('V A N E S S A');
    expect(content).toContain('VR.SESSÕES');
    expect(content).toContain('TOTAL - BIANCA');
    expect(content).toContain('TOTAL - VANESSA');
    expect(content).toContain('T O T A L  G E R A L');
    expect(sheetRows.at(-1).cells[0]).toBe('TOTAL');
  });

  test('espaça letras do nome do Executante', () => {
    expect(spaceLetters('BIANCA')).toBe('B I A N C A');
    expect(spaceLetters('TOTAL GERAL')).toBe('T O T A L  G E R A L');
  });

  test('agrupa apenas valores que apareceram nos dados', () => {
    const groups = groupRowsBySessionRate([
      normalizeRow(rowWithValue({ qt: '2', item: '45,54 R$' })),
      normalizeRow(rowWithValue({ qt: '1', item: '40,42 R$' })),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0].rate).toBeCloseTo(45.54);
    expect(groups[1].rate).toBeCloseTo(40.42);
  });
});
