const fs = require('fs/promises');
const path = require('path');
const ExcelJS = require('exceljs');
const { COLUMN_COUNT, SUBTOTAL_LABEL_COLSPAN } = require('../modules/unimedSpreadsheetLayout');
const {
  RESUMO_LEFT_COLSPAN,
  RESUMO_NAME_COLSPAN,
} = require('../modules/unimedResumoGeral');
const { parseBrazilianMoney } = require('../modules/unimedMoney');

class ExcelWriterAdapter {
  async write(_filePath, _rows, _headers) {
    throw new Error('ExcelWriterAdapter.write() must be implemented');
  }
}

const RESUMO_COLORS = {
  executante: ['FFBDD7EE', 'FFFCE4D6', 'FFE2EFDA', 'FFF2F2F2'],
  grandTotal: 'FFFFFFFF',
};

const BRL_NUM_FMT = '"R$"#,##0.00';
const MONEY_COLS = [9, 10, 11];
const QT_COL = 8;

const RESUMO_NAME_COL = RESUMO_LEFT_COLSPAN + 1;
const RESUMO_DATA_COL = RESUMO_NAME_COL + RESUMO_NAME_COLSPAN;

function applyResumoBlockStyle(cell, colorIndex) {
  cell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: RESUMO_COLORS.executante[colorIndex % RESUMO_COLORS.executante.length] },
  };
  cell.font = { bold: true };
  cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
}

function emptyCells(count) {
  return new Array(count).fill('');
}

function buildResumoRow(nameValue, dataValues = []) {
  const cells = emptyCells(COLUMN_COUNT);
  if (nameValue != null) {
    cells[RESUMO_NAME_COL - 1] = nameValue;
  }
  for (let index = 0; index < dataValues.length; index += 1) {
    cells[RESUMO_DATA_COL - 1 + index] = dataValues[index];
  }
  return cells;
}

function setCurrencyCell(cell, rawValue) {
  if (rawValue === null || rawValue === undefined || rawValue === '' || rawValue === '-') {
    cell.value = rawValue === '-' ? '-' : null;
    return;
  }

  if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
    cell.value = rawValue;
    cell.numFmt = BRL_NUM_FMT;
    return;
  }

  const amount = parseBrazilianMoney(rawValue);
  cell.value = amount;
  cell.numFmt = BRL_NUM_FMT;
}

function setIntegerCell(cell, rawValue) {
  if (rawValue === null || rawValue === undefined || rawValue === '') {
    cell.value = null;
    return;
  }

  const parsed = Number.parseInt(String(rawValue), 10);
  cell.value = Number.isFinite(parsed) ? parsed : rawValue;
}

function applyDataMoneyFormats(row) {
  setIntegerCell(row.getCell(QT_COL), row.getCell(QT_COL).value);
  for (const col of MONEY_COLS) {
    setCurrencyCell(row.getCell(col), row.getCell(col).value);
  }
}

function applyResumoMoneyFormats(row, { includeRate = true, includeTotal = true, includeQuantity = true } = {}) {
  if (includeRate) {
    setCurrencyCell(row.getCell(RESUMO_DATA_COL), row.getCell(RESUMO_DATA_COL).value);
  }
  if (includeQuantity) {
    setIntegerCell(row.getCell(RESUMO_DATA_COL + 1), row.getCell(RESUMO_DATA_COL + 1).value);
  }
  if (includeTotal) {
    setCurrencyCell(row.getCell(RESUMO_DATA_COL + 2), row.getCell(RESUMO_DATA_COL + 2).value);
  }
}

class ExcelJsAdapter extends ExcelWriterAdapter {
  async write(filePath, rows, headers) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'pdf-summarizer-ai';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('documents');
    worksheet.columns = headers.map((header) => ({
      header: header.title,
      key: header.id,
      width: header.id === 'content' ? 60 : 24,
    }));

    for (const row of rows) {
      worksheet.addRow(row);
    }

    worksheet.getRow(1).font = { bold: true };
    await workbook.xlsx.writeFile(filePath);
  }

  async writeSheet(filePath, sheetRows, options = {}) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'pdf-summarizer-ai';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet(options.sheetName || 'documents');
    let rowIndex = 0;
    let resumoSectionStart = null;
    let resumoSectionEnd = null;
    let blockStartRow = null;
    let blockColorIndex = 0;
    let preambleIndex = 0;

    for (const sheetRow of sheetRows) {
      rowIndex += 1;

      if (sheetRow.type === 'preamble') {
        const row = worksheet.addRow([sheetRow.cells[0], ...emptyCells(COLUMN_COUNT - 1)]);
        worksheet.mergeCells(rowIndex, 1, rowIndex, COLUMN_COUNT);
        const cell = row.getCell(1);
        const style = sheetRow.meta?.style || (preambleIndex === 0 ? 'header1' : 'header3');
        if (style === 'header1') {
          cell.font = { bold: true, size: 16 };
        } else {
          cell.font = { bold: true, size: 12 };
        }
        cell.alignment = { vertical: 'middle', horizontal: 'left' };
        preambleIndex += 1;
        continue;
      }

      if (sheetRow.type === 'blank') {
        worksheet.addRow(emptyCells(COLUMN_COUNT));
        continue;
      }

      if (sheetRow.type === 'resumo-blank') {
        if (!resumoSectionStart) {
          resumoSectionStart = rowIndex;
        }
        worksheet.addRow(emptyCells(COLUMN_COUNT));
        resumoSectionEnd = rowIndex;
        continue;
      }

      if (sheetRow.type === 'resumo-executante-start' || sheetRow.type === 'resumo-grand-start') {
        if (!resumoSectionStart) {
          resumoSectionStart = rowIndex;
        }
        blockStartRow = rowIndex;
        const nameValue = sheetRow.cells[0];
        const headers = sheetRow.cells.slice(1);
        const row = worksheet.addRow(buildResumoRow(nameValue, headers));
        const labelCell = row.getCell(RESUMO_NAME_COL);
        applyResumoBlockStyle(
          labelCell,
          sheetRow.type === 'resumo-grand-start' ? 3 : blockColorIndex,
        );
        row.getCell(RESUMO_DATA_COL).font = { bold: true };
        row.getCell(RESUMO_DATA_COL + 1).font = { bold: true };
        row.getCell(RESUMO_DATA_COL + 2).font = { bold: true };
        if (sheetRow.type === 'resumo-executante-start') {
          blockColorIndex += 1;
        }
        continue;
      }

      if (sheetRow.type === 'resumo-data') {
        const row = worksheet.addRow(buildResumoRow(null, sheetRow.cells));
        applyResumoMoneyFormats(row);
        continue;
      }

      if (sheetRow.type === 'resumo-subtotal' || sheetRow.type === 'resumo-grand-total') {
        const row = worksheet.addRow(buildResumoRow(null, sheetRow.cells));
        row.font = { bold: true };
        row.getCell(RESUMO_DATA_COL).border = { top: { style: 'medium' } };
        row.getCell(RESUMO_DATA_COL + 1).border = { top: { style: 'medium' } };
        row.getCell(RESUMO_DATA_COL + 2).border = { top: { style: 'medium' } };
        applyResumoMoneyFormats(row, { includeRate: false });

        if (blockStartRow) {
          worksheet.mergeCells(blockStartRow, RESUMO_NAME_COL, rowIndex, RESUMO_NAME_COL + RESUMO_NAME_COLSPAN - 1);
          blockStartRow = null;
        }

        if (sheetRow.type === 'resumo-grand-total') {
          resumoSectionEnd = rowIndex;
        }
        continue;
      }

      const row = worksheet.addRow(sheetRow.cells);

      if (sheetRow.type === 'header') {
        row.font = { bold: true };
      }

      if (sheetRow.type === 'data' || sheetRow.type === 'subtotal' || sheetRow.type === 'grand-total') {
        applyDataMoneyFormats(row);
      }

      if (sheetRow.type === 'subtotal' || sheetRow.type === 'grand-total') {
        row.font = { bold: true };
        const labelColspan = sheetRow.meta?.labelColspan || SUBTOTAL_LABEL_COLSPAN;
        worksheet.mergeCells(rowIndex, 1, rowIndex, labelColspan);
      }
    }

    if (resumoSectionStart && resumoSectionEnd && resumoSectionEnd >= resumoSectionStart) {
      worksheet.mergeCells(resumoSectionStart, 1, resumoSectionEnd, RESUMO_LEFT_COLSPAN);
      const resumoLabel = worksheet.getCell(resumoSectionStart, 1);
      resumoLabel.value = 'RESUMO GERAL';
      resumoLabel.font = { bold: true, size: 12 };
      resumoLabel.alignment = { vertical: 'middle', horizontal: 'center', textRotation: 90 };
    }

    worksheet.views = [{ state: 'frozen', ySplit: 3, activeCell: 'A4' }];

    worksheet.columns = [
      { width: 14 },
      { width: 12 },
      { width: 12 },
      { width: 28 },
      { width: 14 },
      { width: 28 },
      { width: 16 },
      { width: 8 },
      { width: 14 },
      { width: 12 },
      { width: 14 },
    ];

    await workbook.xlsx.writeFile(filePath);
  }
}

function createExcelWriterAdapter(type = 'exceljs') {
  switch (type) {
    case 'exceljs':
      return new ExcelJsAdapter();
    default:
      throw new Error(`Unknown Excel writer adapter: ${type}`);
  }
}

module.exports = {
  ExcelWriterAdapter,
  ExcelJsAdapter,
  createExcelWriterAdapter,
};
