const fs = require('fs/promises');
const path = require('path');
const ExcelJS = require('exceljs');

class ExcelWriterAdapter {
  async write(_filePath, _rows, _headers) {
    throw new Error('ExcelWriterAdapter.write() must be implemented');
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
