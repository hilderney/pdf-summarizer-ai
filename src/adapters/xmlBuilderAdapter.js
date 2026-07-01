const fs = require('fs/promises');
const path = require('path');
const { create } = require('xmlbuilder2');

class XmlBuilderAdapter {
  async write(_filePath, _payload) {
    throw new Error('XmlBuilderAdapter.write() must be implemented');
  }
}

class XmlBuilder2Adapter extends XmlBuilderAdapter {
  async write(filePath, payload) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const root = create({ version: '1.0', encoding: 'UTF-8' })
      .ele('documents', { generated_at: payload.generatedAt });

    for (const item of payload.items) {
      const doc = root.ele('document', {
        filename: item.filename,
        source_pdf: item.sourcePdf,
        extracted_at: item.extractedAt,
      });
      doc.ele('content').dat(item.content);
    }

    const xml = root.end({ prettyPrint: true });
    await fs.writeFile(filePath, xml, 'utf8');
  }
}

function createXmlBuilderAdapter(type = 'xmlbuilder2') {
  switch (type) {
    case 'xmlbuilder2':
      return new XmlBuilder2Adapter();
    default:
      throw new Error(`Unknown XML builder adapter: ${type}`);
  }
}

module.exports = {
  XmlBuilderAdapter,
  XmlBuilder2Adapter,
  createXmlBuilderAdapter,
};
