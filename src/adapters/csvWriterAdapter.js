const fs = require('fs/promises');
const path = require('path');
const { createObjectCsvWriter } = require('csv-writer');

class CsvWriterAdapter {
  async write(_filePath, _rows, _headers) {
    throw new Error('CsvWriterAdapter.write() must be implemented');
  }
}

class CsvWriterLibAdapter extends CsvWriterAdapter {
  async write(filePath, rows, headers) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const writer = createObjectCsvWriter({
      path: filePath,
      header: headers,
      alwaysQuote: true,
    });
    await writer.writeRecords(rows);
  }
}

function createCsvWriterAdapter(type = 'csv-writer') {
  switch (type) {
    case 'csv-writer':
      return new CsvWriterLibAdapter();
    default:
      throw new Error(`Unknown CSV writer adapter: ${type}`);
  }
}

module.exports = {
  CsvWriterAdapter,
  CsvWriterLibAdapter,
  createCsvWriterAdapter,
};
