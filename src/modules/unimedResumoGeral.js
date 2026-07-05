const {
  parseBrazilianMoney,
  formatBrazilianMoney,
  formatSessionRate,
} = require('./unimedMoney');

const RESUMO_HEADERS = ['VR.SESSÕES', 'QUANT.', 'TOTAL'];

function executanteShortName(executante) {
  return String(executante || '').trim().split(/\s+/)[0] || executante;
}

function spaceLetters(text) {
  return String(text || '')
    .trim()
    .split(/\s+/)
    .map((word) => word.split('').join(' '))
    .join('  ');
}

function resolveSessionRate(row) {
  const fromItem = parseBrazilianMoney(row.item);
  if (fromItem > 0) {
    return fromItem;
  }

  const fromPago = parseBrazilianMoney(row.vlPago);
  if (fromPago > 0) {
    return fromPago;
  }

  const fromBruto = parseBrazilianMoney(row.vlBruto);
  if (fromBruto > 0) {
    return fromBruto;
  }

  return 0;
}

function groupRowsBySessionRate(rows) {
  const groups = new Map();

  for (const row of rows) {
    const rate = resolveSessionRate(row);
    const key = rate.toFixed(2);

    if (!groups.has(key)) {
      groups.set(key, { rate, quantity: 0 });
    }

    groups.get(key).quantity += row.qt;
  }

  return [...groups.values()].sort((left, right) => right.rate - left.rate);
}

function buildValueGroupRow(group) {
  const totalAmount = group.rate * group.quantity;

  return {
    rateLabel: formatSessionRate(group.rate),
    quantity: String(group.quantity),
    totalLabel: formatBrazilianMoney(totalAmount),
    totalAmount,
    quantityNum: group.quantity,
  };
}

function summarizeExecutanteRows(executante, rows) {
  const valueRows = groupRowsBySessionRate(rows).map(buildValueGroupRow);
  const totalQuantity = valueRows.reduce((sum, row) => sum + row.quantityNum, 0);
  const totalAmount = valueRows.reduce((sum, row) => sum + row.totalAmount, 0);
  const shortName = executanteShortName(executante);

  return {
    executante,
    shortName,
    spacedName: spaceLetters(shortName),
    valueRows,
    totalQuantity,
    totalAmount,
    totalLabel: formatBrazilianMoney(totalAmount, { emptyAsDash: false }),
  };
}

function mergeValueGroups(blocks) {
  const merged = new Map();

  for (const block of blocks) {
    for (const valueRow of block.valueRows) {
      const rate = parseBrazilianMoney(valueRow.rateLabel);
      const key = rate.toFixed(2);

      if (!merged.has(key)) {
        merged.set(key, { rate, quantity: 0, totalAmount: 0 });
      }

      const group = merged.get(key);
      group.quantity += valueRow.quantityNum;
      group.totalAmount += valueRow.totalAmount;
    }
  }

  return [...merged.values()]
    .sort((left, right) => right.rate - left.rate)
    .map((group) => ({
      rateLabel: formatSessionRate(group.rate),
      quantity: String(group.quantity),
      totalLabel: formatBrazilianMoney(group.totalAmount),
      totalAmount: group.totalAmount,
      quantityNum: group.quantity,
    }));
}

function buildResumoBlocks(normalizedRows) {
  const executantes = [];
  let index = 0;

  while (index < normalizedRows.length) {
    const executante = normalizedRows[index].executante;
    const groupRows = [];

    while (index < normalizedRows.length && normalizedRows[index].executante === executante) {
      groupRows.push(normalizedRows[index]);
      index += 1;
    }

    executantes.push(summarizeExecutanteRows(executante, groupRows));
  }

  const grandValueRows = mergeValueGroups(executantes);
  const grandTotalQuantity = executantes.reduce((sum, block) => sum + block.totalQuantity, 0);
  const grandTotalAmount = executantes.reduce((sum, block) => sum + block.totalAmount, 0);

  return {
    executantes,
    grandTotal: {
      spacedName: spaceLetters('TOTAL GERAL'),
      valueRows: grandValueRows,
      totalQuantity: grandTotalQuantity,
      totalAmount: grandTotalAmount,
      totalLabel: formatBrazilianMoney(grandTotalAmount, { emptyAsDash: false }),
    },
  };
}

function buildExecutanteResumoRows(block) {
  const rows = [
    {
      type: 'resumo-executante-start',
      cells: [block.spacedName],
      meta: { shortName: block.shortName, spacedName: block.spacedName },
    },
    {
      type: 'resumo-header',
      cells: [...RESUMO_HEADERS],
    },
  ];

  for (const valueRow of block.valueRows) {
    rows.push({
      type: 'resumo-data',
      cells: [valueRow.rateLabel, valueRow.quantity, valueRow.totalLabel],
      meta: { shortName: block.shortName },
    });
  }

  rows.push({
    type: 'resumo-subtotal',
    cells: [`TOTAL - ${block.shortName}`, String(block.totalQuantity), block.totalLabel],
    meta: { shortName: block.shortName },
  });

  return rows;
}

function buildResumoGeralSheetRows(normalizedRows) {
  if (normalizedRows.length === 0) {
    return [];
  }

  const { executantes, grandTotal } = buildResumoBlocks(normalizedRows);
  const sheetRows = [
    { type: 'resumo-blank', cells: [''] },
    { type: 'resumo-title', cells: ['RESUMO GERAL'] },
  ];

  for (const block of executantes) {
    sheetRows.push(...buildExecutanteResumoRows(block));
  }

  sheetRows.push(
    {
      type: 'resumo-grand-start',
      cells: [grandTotal.spacedName],
      meta: { spacedName: grandTotal.spacedName },
    },
    {
      type: 'resumo-header',
      cells: [...RESUMO_HEADERS],
    },
  );

  for (const valueRow of grandTotal.valueRows) {
    sheetRows.push({
      type: 'resumo-data',
      cells: [valueRow.rateLabel, valueRow.quantity, valueRow.totalLabel],
      meta: { scope: 'grand-total' },
    });
  }

  sheetRows.push({
    type: 'resumo-grand-total',
    cells: ['TOTAL', String(grandTotal.totalQuantity), grandTotal.totalLabel],
  });

  return sheetRows;
}

module.exports = {
  RESUMO_HEADERS,
  spaceLetters,
  resolveSessionRate,
  groupRowsBySessionRate,
  buildResumoBlocks,
  buildResumoGeralSheetRows,
};
