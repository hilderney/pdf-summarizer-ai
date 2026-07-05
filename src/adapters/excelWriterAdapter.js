const fs = require('fs/promises');
const path = require('path');
const ExcelJS = require('exceljs');

class ExcelWriterAdapter {
  async write(_filePath, _rows, _headers) {
    throw new Error('ExcelWriterAdapter.write() must be implemented');
  }
}

const RESUMO_COLORS = {
  executante: ['FFBDD7EE', 'FFFCE4D6', 'FFE2EFDA', 'FFF2F2F2'],
  grandTotal: 'FFFFFFFF',
};

function applyResumoBlockStyle(cell, colorIndex) {
  cell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: RESUMO_COLORS.executante[colorIndex % RESUMO_COLORS.executante.length] },
  };
  cell.font = { bold: true };
  cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
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

    for (const sheetRow of sheetRows) {
      rowIndex += 1;

      if (sheetRow.type === 'preamble' && sheetRow.cells.length === 1) {
        worksheet.addRow(sheetRow.cells);
        worksheet.mergeCells(rowIndex, 1, rowIndex, 12);
        continue;
      }

      if (sheetRow.type === 'resumo-blank') {
        worksheet.addRow(['']);
        continue;
      }

      if (sheetRow.type === 'resumo-title') {
        worksheet.addRow([sheetRow.cells[0], '', '', '']);
        continue;
      }

      if (sheetRow.type === 'resumo-executante-start' || sheetRow.type === 'resumo-grand-start') {
        if (!resumoSectionStart) {
          resumoSectionStart = rowIndex;
        }
        blockStartRow = rowIndex;
        const row = worksheet.addRow(['', sheetRow.cells[0], '', '']);
        const labelCell = row.getCell(2);
        applyResumoBlockStyle(
          labelCell,
          sheetRow.type === 'resumo-grand-start' ? 3 : blockColorIndex,
        );
        if (sheetRow.type === 'resumo-executante-start') {
          blockColorIndex += 1;
        }
        continue;
      }

      if (sheetRow.type === 'resumo-header') {
        const row = worksheet.addRow(['', ...sheetRow.cells]);
        row.font = { bold: true };
        continue;
      }

      if (sheetRow.type === 'resumo-data') {
        worksheet.addRow(['', ...sheetRow.cells]);
        continue;
      }

      if (sheetRow.type === 'resumo-subtotal' || sheetRow.type === 'resumo-grand-total') {
        const row = worksheet.addRow(['', ...sheetRow.cells]);
        row.font = { bold: true };
        row.getCell(2).border = { top: { style: 'medium' } };
        row.getCell(3).border = { top: { style: 'medium' } };
        row.getCell(4).border = { top: { style: 'medium' } };

        if (blockStartRow && sheetRow.type === 'resumo-subtotal') {
          worksheet.mergeCells(blockStartRow, 2, rowIndex, 2);
          blockStartRow = null;
        }

        if (sheetRow.type === 'resumo-grand-total') {
          resumoSectionEnd = rowIndex;
          if (blockStartRow) {
            worksheet.mergeCells(blockStartRow, 2, rowIndex, 2);
            blockStartRow = null;
          }
        }
        continue;
      }

      const row = worksheet.addRow(sheetRow.cells);

      if (sheetRow.type === 'header') {
        row.font = { bold: true };
      }

      if (sheetRow.type === 'subtotal' || sheetRow.type === 'grand-total') {
        row.font = { bold: true };
      }
    }

    if (resumoSectionStart && resumoSectionEnd && resumoSectionEnd >= resumoSectionStart) {
      worksheet.mergeCells(resumoSectionStart, 1, resumoSectionEnd, 1);
      const resumoLabel = worksheet.getCell(resumoSectionStart, 1);
      resumoLabel.value = 'RESUMO GERAL';
      resumoLabel.font = { bold: true, size: 12 };
      resumoLabel.alignment = { vertical: 'middle', horizontal: 'center', textRotation: 90 };
    }

    worksheet.columns = [
      { width: 14 },
      { width: 18 },
      { width: 14 },
      { width: 12 },
      { width: 16 },
      ...Array.from({ length: 7 }, () => ({ width: 16 })),
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
