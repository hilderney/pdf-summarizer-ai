const {
  buildUnimedSpreadsheet,
  UNIMED_REPORT_HEADERS,
  sortRows,
  normalizeRow,
} = require('../src/modules/unimedSpreadsheetLayout');

const SAMPLE_HEADER =
  'Prestador PSICOVITAE - CONSULTORIO DE PSICOLOGIA Tipo guia: Guia Dt pesquisa: 20/05/2026 a 05/06/2026';

function sampleRows() {
  return [
    {
      guia: '7063165',
      dt_emis: '28/05/2026',
      beneficiario: 'INGRID PINHEIRO ACIOLI',
      pl: '13',
      medico: 'BIANCA FERREIRA DE SOUZA',
      requisicao: '604643990',
      codigo_procedimento: '50000470',
      procedimento: 'PSICOTERAPIA INDIVIDUAL',
      qt: '1',
    },
    {
      guia: '7063166',
      dt_emis: '29/05/2026',
      beneficiario: 'ANA SILVA',
      pl: '14',
      medico: 'VANESSA FERREIRA NASCIMENTO ZAPF',
      requisicao: '604643991',
      codigo_procedimento: '50000470',
      procedimento: 'PSICOTERAPIA INDIVIDUAL',
      qt: '2',
    },
    {
      guia: '7063167',
      dt_emis: '30/05/2026',
      beneficiario: 'CARLA SOUZA',
      pl: '15',
      medico: 'BIANCA FERREIRA DE SOUZA',
      requisicao: '604643992',
      codigo_procedimento: '50000470',
      procedimento: 'PSICOTERAPIA INDIVIDUAL',
      qt: '1',
    },
  ];
}

describe('unimedSpreadsheetLayout', () => {
  test('ordena por Executante e Beneficiário', () => {
    const sorted = sortRows(sampleRows().map(normalizeRow));

    expect(sorted[0].executante).toBe('BIANCA FERREIRA DE SOUZA');
    expect(sorted[0].beneficiario).toBe('CARLA SOUZA');
    expect(sorted[1].beneficiario).toBe('INGRID PINHEIRO ACIOLI');
    expect(sorted[2].executante).toBe('VANESSA FERREIRA NASCIMENTO ZAPF');
    expect(sorted[2].beneficiario).toBe('ANA SILVA');
  });

  test('monta preâmbulo, cabeçalho e placeholders monetários', () => {
    const { sheetRows } = buildUnimedSpreadsheet({ text: SAMPLE_HEADER, rows: sampleRows() });

    expect(sheetRows[0]).toEqual({
      type: 'preamble',
      cells: ['PSICOVITAE - CONSULTORIO DE PSICOLOGIA'],
    });
    expect(sheetRows[1].type).toBe('preamble');
    expect(sheetRows[1].cells[0]).toContain('UNIMED - 1º PGTO PROGRAMADO PARA 05/07/2026');
    expect(sheetRows[2]).toEqual({ type: 'header', cells: [...UNIMED_REPORT_HEADERS] });

    const firstData = sheetRows.find((row) => row.type === 'data');
    expect(firstData.cells[6]).toBe('Consulta/Terapia');
    expect(firstData.cells[8]).toBe('-');
    expect(firstData.cells[9]).toBe('0,00 R$');
    expect(firstData.cells[11]).toBe('0,00 R$');
  });

  test('insere subtotal por Executante e TOTAL GERAL', () => {
    const { sheetRows } = buildUnimedSpreadsheet({ text: SAMPLE_HEADER, rows: sampleRows() });

    const subtotals = sheetRows.filter((row) => row.type === 'subtotal');
    const grandTotal = sheetRows.find((row) => row.type === 'grand-total');
    const resumoTitle = sheetRows.find((row) => row.type === 'resumo-title');

    expect(subtotals).toHaveLength(2);
    expect(subtotals[0].cells[0]).toBe('TOTAL - BIANCA');
    expect(subtotals[0].cells[7]).toBe('2');
    expect(subtotals[1].cells[0]).toBe('TOTAL - VANESSA');
    expect(subtotals[1].cells[7]).toBe('2');
    expect(grandTotal.cells[0]).toBe('TOTAL GERAL');
    expect(grandTotal.cells[7]).toBe('4');
    expect(resumoTitle).toBeDefined();
    expect(sheetRows.some((row) => row.type === 'resumo-subtotal')).toBe(true);
    expect(sheetRows.some((row) => row.type === 'resumo-grand-total')).toBe(true);
  });

  test('mapeia colunas conforme layout Unimed', () => {
    const { sheetRows } = buildUnimedSpreadsheet({ text: SAMPLE_HEADER, rows: [sampleRows()[0]] });
    const data = sheetRows.find((row) => row.type === 'data');

    expect(data.cells[0]).toBe('604643990');
    expect(data.cells[1]).toBe('7063165');
    expect(data.cells[2]).toBe('13');
    expect(data.cells[3]).toBe('INGRID PINHEIRO ACIOLI');
    expect(data.cells[5]).toBe('BIANCA FERREIRA DE SOUZA');
  });

  test('[F3-43] deve usar metadata.prestador quando passada, ignorando parseUnimedMetadata(text)', () => {
    const { sheetRows, metadata } = buildUnimedSpreadsheet({
      text: '',
      rows: sampleRows(),
      metadata: {
        prestador: 'PRESTADOR INJETADO',
        paymentLine: 'LINHA INJETADA',
      },
    });

    expect(metadata.prestador).toBe('PRESTADOR INJETADO');
    expect(sheetRows[0].cells[0]).toBe('PRESTADOR INJETADO');
  });

  test('[F3-44] deve usar metadata.paymentLine no preamble linha 2', () => {
    const { sheetRows } = buildUnimedSpreadsheet({
      text: '',
      rows: sampleRows(),
      metadata: {
        prestador: 'PRESTADOR',
        paymentLine: 'PAGAMENTO INJETADO',
      },
    });

    expect(sheetRows[1].cells[0]).toBe('PAGAMENTO INJETADO');
  });

  test('[F3-45] fallback: sem metadata, continua usando parseUnimedMetadata(text) (regressão Fase 1)', () => {
    const { sheetRows } = buildUnimedSpreadsheet({ text: SAMPLE_HEADER, rows: sampleRows() });
    expect(sheetRows[0].cells[0]).toBe('PSICOVITAE - CONSULTORIO DE PSICOLOGIA');
  });

  test('[F3-46] deve formatar vl_glosa=0 como -', () => {
    const normalized = normalizeRow({
      protocolo: '1',
      guia: '2',
      requisicao: '3',
      beneficiario: 'A',
      dt_emis: '01/01/2026',
      medico: 'MED',
      codigo_procedimento: '50000470',
      qt: '1',
      item: '45,54',
      vl_bruto: '45,54',
      vl_glosa: '0',
      vl_pago: '45,54',
    });
    expect(normalized.vlGlosa).toBe('-');
  });

  test('[F3-47] deve formatar vl_glosa=10,50 como 10,50 R$', () => {
    const normalized = normalizeRow({
      protocolo: '1',
      guia: '2',
      requisicao: '3',
      beneficiario: 'A',
      dt_emis: '01/01/2026',
      medico: 'MED',
      codigo_procedimento: '50000470',
      qt: '1',
      item: '40,42',
      vl_bruto: '40,42',
      vl_glosa: '10,50',
      vl_pago: '29,92',
    });
    expect(normalized.vlGlosa).toBe('10,50 R$');
  });

  test('[F3-48] deve usar item de Vl Bruto quando > 0 para RESUMO GERAL', () => {
    const normalized = normalizeRow({
      protocolo: '1',
      guia: '2',
      requisicao: '3',
      beneficiario: 'A',
      dt_emis: '01/01/2026',
      medico: 'MED',
      codigo_procedimento: '50000470',
      qt: '1',
      item: '45,54',
      vl_bruto: '45,54',
      vl_glosa: '0',
      vl_pago: '45,54',
    });
    expect(normalized.item).toBe('45,54 R$');
  });
});
