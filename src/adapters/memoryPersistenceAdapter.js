const crypto = require('crypto');
const { PersistenceAdapter } = require('./persistenceAdapter');
const { toModelDto, toJobDto, nowIso } = require('./persistenceMappers');

class InMemoryPersistenceAdapter extends PersistenceAdapter {
  constructor() {
    super();
    this.models = new Map();
    this.jobs = new Map();
    this.initialized = false;
  }

  async init() {
    this.initialized = true;
  }

  async close() {
    this.models.clear();
    this.jobs.clear();
    this.initialized = false;
  }

  _ensureInit() {
    if (!this.initialized) {
      throw new Error('Persistence adapter not initialized');
    }
  }

  _clearOtherDefaults(exceptId) {
    for (const model of this.models.values()) {
      if (model.id !== exceptId && model.is_default) {
        model.is_default = 0;
        model.updated_at = nowIso();
      }
    }
  }

  async createLlmModel(data) {
    this._ensureInit();
    const id = crypto.randomUUID();
    const timestamp = nowIso();

    if (data.isDefault) {
      this._clearOtherDefaults(null);
    }

    const row = {
      id,
      name: data.name,
      provider: data.provider,
      model_id: data.modelId,
      base_url: data.baseUrl ?? null,
      token_encrypted: data.tokenEncrypted ?? null,
      is_default: data.isDefault ? 1 : 0,
      created_at: timestamp,
      updated_at: timestamp,
    };

    this.models.set(id, row);
    return toModelDto(row);
  }

  async getLlmModel(id) {
    this._ensureInit();
    return toModelDto(this.models.get(id));
  }

  getLlmModelRaw(id) {
    this._ensureInit();
    return this.models.get(id) ?? null;
  }

  async listLlmModels(filter = {}) {
    this._ensureInit();
    let rows = [...this.models.values()];

    if (filter.provider) {
      rows = rows.filter((row) => row.provider === filter.provider);
    }

    return rows.map(toModelDto).sort((a, b) => a.name.localeCompare(b.name));
  }

  async updateLlmModel(id, data) {
    this._ensureInit();
    const existing = this.models.get(id);
    if (!existing) {
      return null;
    }

    if (data.isDefault) {
      this._clearOtherDefaults(id);
    }

    const updated = {
      ...existing,
      name: data.name ?? existing.name,
      provider: data.provider ?? existing.provider,
      model_id: data.modelId ?? existing.model_id,
      base_url: data.baseUrl !== undefined ? data.baseUrl : existing.base_url,
      token_encrypted:
        data.tokenEncrypted !== undefined ? data.tokenEncrypted : existing.token_encrypted,
      is_default: data.isDefault !== undefined ? (data.isDefault ? 1 : 0) : existing.is_default,
      updated_at: nowIso(),
    };

    this.models.set(id, updated);
    return toModelDto(updated);
  }

  async deleteLlmModel(id) {
    this._ensureInit();
    return this.models.delete(id);
  }

  async createLlmJob(data) {
    this._ensureInit();
    const id = crypto.randomUUID();
    const timestamp = nowIso();

    const row = {
      id,
      llm_model_id: data.llmModelId,
      source_file: data.sourceFile,
      source_type: data.sourceType,
      prompt_template: data.promptTemplate ?? null,
      status: data.status ?? 'pending',
      response_file: data.responseFile ?? null,
      summary: data.summary ?? null,
      error_message: data.errorMessage ?? null,
      created_at: timestamp,
      completed_at: data.completedAt ?? null,
    };

    this.jobs.set(id, row);
    return toJobDto(row);
  }

  async getLlmJob(id) {
    this._ensureInit();
    return toJobDto(this.jobs.get(id));
  }

  async listLlmJobs(filter = {}) {
    this._ensureInit();
    let rows = [...this.jobs.values()];

    if (filter.llmModelId) {
      rows = rows.filter((row) => row.llm_model_id === filter.llmModelId);
    }

    if (filter.status) {
      rows = rows.filter((row) => row.status === filter.status);
    }

    return rows
      .map(toJobDto)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async updateLlmJob(id, data) {
    this._ensureInit();
    const existing = this.jobs.get(id);
    if (!existing) {
      return null;
    }

    const updated = {
      ...existing,
      status: data.status ?? existing.status,
      response_file: data.responseFile !== undefined ? data.responseFile : existing.response_file,
      summary: data.summary !== undefined ? data.summary : existing.summary,
      error_message: data.errorMessage !== undefined ? data.errorMessage : existing.error_message,
      completed_at: data.completedAt !== undefined ? data.completedAt : existing.completed_at,
    };

    this.jobs.set(id, updated);
    return toJobDto(updated);
  }

  async countActiveJobsForModel(modelId) {
    this._ensureInit();
    return [...this.jobs.values()].filter(
      (job) => job.llm_model_id === modelId && ['pending', 'running'].includes(job.status),
    ).length;
  }
}

module.exports = {
  InMemoryPersistenceAdapter,
};
