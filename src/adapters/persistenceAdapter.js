class PersistenceAdapter {
  async init(_options) {
    throw new Error('PersistenceAdapter.init() must be implemented');
  }

  async close() {
    throw new Error('PersistenceAdapter.close() must be implemented');
  }

  async createLlmModel(_data) {
    throw new Error('PersistenceAdapter.createLlmModel() must be implemented');
  }

  async getLlmModel(_id) {
    throw new Error('PersistenceAdapter.getLlmModel() must be implemented');
  }

  async listLlmModels(_filter) {
    throw new Error('PersistenceAdapter.listLlmModel() must be implemented');
  }

  async updateLlmModel(_id, _data) {
    throw new Error('PersistenceAdapter.updateLlmModel() must be implemented');
  }

  async deleteLlmModel(_id) {
    throw new Error('PersistenceAdapter.deleteLlmModel() must be implemented');
  }

  async createLlmJob(_data) {
    throw new Error('PersistenceAdapter.createLlmJob() must be implemented');
  }

  async getLlmJob(_id) {
    throw new Error('PersistenceAdapter.getLlmJob() must be implemented');
  }

  async listLlmJobs(_filter) {
    throw new Error('PersistenceAdapter.listLlmJobs() must be implemented');
  }

  async updateLlmJob(_id, _data) {
    throw new Error('PersistenceAdapter.updateLlmJob() must be implemented');
  }
}

function createPersistenceAdapter(type = 'sqlite', options = {}) {
  switch (type) {
    case 'sqlite':
      return new (require('./sqlitePersistenceAdapter').SqlitePersistenceAdapter)(options);
    case 'memory':
      return new (require('./memoryPersistenceAdapter').InMemoryPersistenceAdapter)(options);
    default:
      throw new Error(`Unknown persistence adapter: ${type}`);
  }
}

module.exports = {
  PersistenceAdapter,
  createPersistenceAdapter,
};
