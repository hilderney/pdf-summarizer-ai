const { parseUnimedMetadata } = require('./unimedMetadataParser');
const { buildResumoGeralSheetRows } = require('./unimedResumoGeral');
const { parseBrazilianMoney } = require('./unimedMoney');

const UNIMED_REPORT_HEADERS = [
  'Requisição',
  'Protocolo',
  'Guia',
  'Beneficiário',
  'Atendimento',
  'Executante',
  'Serviço',
  'Qt',
  'Item',
  'Vl Bruto',
  'Vl Glosa',
  'Vl Pago',
];

const COLUMN_COUNT = UNIMED_REPORT_HEADERS.length;

const SERVICE_LABELS = {
  '50000470': 'Consulta/Terapia',
  '50001221': 'Consulta Ambulatorial',
};

const PLACEHOLDER_ITEM = '-';
const PLACEHOLDER_BRUTO = '0,00 R$';
const PLACEHOLDER_GLOSA = '-';
const PLACEHOLDER_PAGO = '0,00 R$';

function mapServiceLabel(row) {
  if (row.codigo_procedimento && SERVICE_LABELS[row.codigo_procedimento]) {
    return SERVICE_LABELS[row.codigo_procedimento];
  }

  const proc = String(row.procedimento || '').toUpperCase();
  if (proc.includes('PSICOTERAPIA')) {
    return 'Consulta/Terapia';
  }
  if (proc.includes('CONSULTA AMBULATORIAL')) {
    return 'Consulta Ambulatorial';
  }

  return row.procedimento || 'Consulta/Terapia';
}

function resolveMoneyField(row, ...fields) {
  for (const field of fields) {
    const value = row[field];
    if (value && value !== '-') {
      return value;
    }
  }
  return null;
}

function normalizeRow(row) {
  const item = resolveMoneyField(row, 'item');
  const vlPago = resolveMoneyField(row, 'vlPago', 'vl_pago');
  const vlBruto = resolveMoneyField(row, 'vlBruto', 'vl_bruto');

  const hasItem = item && parseBrazilianMoney(item) > 0;
  const hasPago = vlPago && parseBrazilianMoney(vlPago) > 0;

  return {
    requisicao: row.requisicao || '',
    protocolo: row.guia || '',
    guia: row.pl || '',
    beneficiario: row.beneficiario || '',
    atendimento: row.dt_emis || '',
    executante: row.medico || '',
    servico: mapServiceLabel(row),
    qt: Number.parseInt(row.qt, 10) || 0,
    item: hasItem ? item : PLACEHOLDER_ITEM,
    vlBruto: vlBruto && parseBrazilianMoney(vlBruto) > 0 ? vlBruto : PLACEHOLDER_BRUTO,
    vlGlosa: PLACEHOLDER_GLOSA,
    vlPago: hasPago ? vlPago : PLACEHOLDER_PAGO,
  };
}

function rowToCells(normalized) {
  return [
    normalized.requisicao,
    normalized.protocolo,
    normalized.guia,
    normalized.beneficiario,
    normalized.atendimento,
    normalized.executante,
    normalized.servico,
    String(normalized.qt),
    normalized.item,
    normalized.vlBruto,
    normalized.vlGlosa,
    normalized.vlPago,
  ];
}

function comparePt(a, b) {
  return a.localeCompare(b, 'pt-BR', { sensitivity: 'base' });
}

function sortRows(rows) {
  return [...rows].sort((a, b) => {
    const byExecutante = comparePt(a.executante, b.executante);
    if (byExecutante !== 0) {
      return byExecutante;
    }
    return comparePt(a.beneficiario, b.beneficiario);
  });
}

function executanteShortName(executante) {
  return String(executante || '').trim().split(/\s+/)[0] || executante;
}

function buildSubtotalCells(label, service, totals) {
  const cells = new Array(COLUMN_COUNT).fill('');
  cells[0] = label;
  cells[6] = service;
  cells[7] = String(totals.qt);
  cells[8] = PLACEHOLDER_ITEM;
  cells[9] = totals.vlBruto;
  cells[10] = totals.vlGlosa;
  cells[11] = totals.vlPago;
  return cells;
}

function emptyTotals() {
  return {
    qt: 0,
    vlBruto: PLACEHOLDER_BRUTO,
    vlGlosa: PLACEHOLDER_GLOSA,
    vlPago: PLACEHOLDER_PAGO,
  };
}

function addToTotals(totals, row) {
  totals.qt += row.qt;
}

function buildGroupedSheetRows(normalizedRows) {
  const sheetRows = [];
  let index = 0;

  while (index < normalizedRows.length) {
    const executante = normalizedRows[index].executante;
    const group = [];

    while (index < normalizedRows.length && normalizedRows[index].executante === executante) {
      group.push(normalizedRows[index]);
      index += 1;
    }

    for (const row of group) {
      sheetRows.push({ type: 'data', cells: rowToCells(row) });
    }

    const totals = emptyTotals();
    for (const row of group) {
      addToTotals(totals, row);
    }

    sheetRows.push({
      type: 'subtotal',
      cells: buildSubtotalCells(
        `TOTAL - ${executanteShortName(executante)}`,
        group[0]?.servico || 'Consulta/Terapia',
        totals,
      ),
    });
  }

  return sheetRows;
}

function buildGrandTotalRows(normalizedRows) {
  const totals = emptyTotals();
  const services = new Set(normalizedRows.map((row) => row.servico));

  for (const row of normalizedRows) {
    addToTotals(totals, row);
  }

  const serviceLabel = services.size === 1 ? [...services][0] : 'Consulta/Terapia';

  return {
    type: 'grand-total',
    cells: buildSubtotalCells('TOTAL GERAL', serviceLabel, totals),
  };
}

function buildUnimedSpreadsheet({ text, rows }) {
  const metadata = parseUnimedMetadata(text);
  const normalizedRows = sortRows(rows.map(normalizeRow));
  const dataAndSubtotals = buildGroupedSheetRows(normalizedRows);

  const sheetRows = [
    { type: 'preamble', cells: [metadata.prestador] },
    { type: 'preamble', cells: [metadata.paymentLine] },
    { type: 'header', cells: [...UNIMED_REPORT_HEADERS] },
    ...dataAndSubtotals,
  ];

  if (normalizedRows.length > 0) {
    sheetRows.push(buildGrandTotalRows(normalizedRows));
    sheetRows.push(...buildResumoGeralSheetRows(normalizedRows));
  }

  return {
    sheetRows,
    columnCount: COLUMN_COUNT,
    metadata,
    dataRowCount: normalizedRows.length,
  };
}

module.exports = {
  UNIMED_REPORT_HEADERS,
  COLUMN_COUNT,
  mapServiceLabel,
  normalizeRow,
  buildUnimedSpreadsheet,
  sortRows,
  executanteShortName,
};
