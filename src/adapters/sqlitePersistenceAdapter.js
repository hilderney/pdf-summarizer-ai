const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { PersistenceAdapter } = require('./persistenceAdapter');
const { PersistenceError } = require('../errors');
const { toModelDto, toJobDto, nowIso } = require('./persistenceMappers');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS llm_models (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  base_url TEXT,
  token_encrypted TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS llm_jobs (
  id TEXT PRIMARY KEY,
  llm_model_id TEXT NOT NULL,
  source_file TEXT NOT NULL,
  source_type TEXT NOT NULL,
  prompt_template TEXT,
  status TEXT NOT NULL,
  response_file TEXT,
  summary TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (llm_model_id) REFERENCES llm_models(id)
);
`;

class SqlitePersistenceAdapter extends PersistenceAdapter {
  constructor(options = {}) {
    super();
    this.dbPath = options.dbPath ?? './data/app.db';
    this.db = null;
  }

  async init(options = {}) {
    if (options.dbPath) {
      this.dbPath = options.dbPath;
    }

    const dir = path.dirname(path.resolve(this.dbPath));
    fs.mkdirSync(dir, { recursive: true });

    try {
      this.db = new Database(this.dbPath);
      this.db.exec(SCHEMA);
    } catch (error) {
      throw new PersistenceError(`Failed to initialize SQLite at ${this.dbPath}`, error);
    }
  }

  async close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  _ensureDb() {
    if (!this.db) {
      throw new PersistenceError('SQLite adapter not initialized');
    }
  }

  _clearOtherDefaults(exceptId) {
    if (exceptId) {
      this.db.prepare('UPDATE llm_models SET is_default = 0, updated_at = ? WHERE id != ?').run(
        nowIso(),
        exceptId,
      );
    } else {
      this.db.prepare('UPDATE llm_models SET is_default = 0, updated_at = ?').run(nowIso());
    }
  }

  async createLlmModel(data) {
    this._ensureDb();
    const id = crypto.randomUUID();
    const timestamp = nowIso();

    if (data.isDefault) {
      this._clearOtherDefaults(null);
    }

    try {
      this.db
        .prepare(
          `INSERT INTO llm_models
          (id, name, provider, model_id, base_url, token_encrypted, is_default, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          data.name,
          data.provider,
          data.modelId,
          data.baseUrl ?? null,
          data.tokenEncrypted ?? null,
          data.isDefault ? 1 : 0,
          timestamp,
          timestamp,
        );
    } catch (error) {
      throw new PersistenceError('Failed to create LLM model', error);
    }

    return this.getLlmModel(id);
  }

  async getLlmModel(id) {
    this._ensureDb();
    const row = this.db.prepare('SELECT * FROM llm_models WHERE id = ?').get(id);
    return toModelDto(row);
  }

  getLlmModelRaw(id) {
    this._ensureDb();
    return this.db.prepare('SELECT * FROM llm_models WHERE id = ?').get(id);
  }

  async listLlmModels(filter = {}) {
    this._ensureDb();
    let rows;

    if (filter.provider) {
      rows = this.db
        .prepare('SELECT * FROM llm_models WHERE provider = ? ORDER BY name ASC')
        .all(filter.provider);
    } else {
      rows = this.db.prepare('SELECT * FROM llm_models ORDER BY name ASC').all();
    }

    return rows.map(toModelDto);
  }

  async updateLlmModel(id, data) {
    this._ensureDb();
    const existing = this.getLlmModelRaw(id);
    if (!existing) {
      return null;
    }

    if (data.isDefault) {
      this._clearOtherDefaults(id);
    }

    const updatedAt = nowIso();

    try {
      this.db
        .prepare(
          `UPDATE llm_models SET
            name = ?,
            provider = ?,
            model_id = ?,
            base_url = ?,
            token_encrypted = ?,
            is_default = ?,
            updated_at = ?
          WHERE id = ?`,
        )
        .run(
          data.name ?? existing.name,
          data.provider ?? existing.provider,
          data.modelId ?? existing.model_id,
          data.baseUrl !== undefined ? data.baseUrl : existing.base_url,
          data.tokenEncrypted !== undefined ? data.tokenEncrypted : existing.token_encrypted,
          data.isDefault !== undefined ? (data.isDefault ? 1 : 0) : existing.is_default,
          updatedAt,
          id,
        );
    } catch (error) {
      throw new PersistenceError('Failed to update LLM model', error);
    }

    return this.getLlmModel(id);
  }

  async deleteLlmModel(id) {
    this._ensureDb();
    const result = this.db.prepare('DELETE FROM llm_models WHERE id = ?').run(id);
    return result.changes > 0;
  }

  async createLlmJob(data) {
    this._ensureDb();
    const id = crypto.randomUUID();
    const timestamp = nowIso();

    try {
      this.db
        .prepare(
          `INSERT INTO llm_jobs
          (id, llm_model_id, source_file, source_type, prompt_template, status,
           response_file, summary, error_message, created_at, completed_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          data.llmModelId,
          data.sourceFile,
          data.sourceType,
          data.promptTemplate ?? null,
          data.status ?? 'pending',
          data.responseFile ?? null,
          data.summary ?? null,
          data.errorMessage ?? null,
          timestamp,
          data.completedAt ?? null,
        );
    } catch (error) {
      throw new PersistenceError('Failed to create LLM job', error);
    }

    return this.getLlmJob(id);
  }

  async getLlmJob(id) {
    this._ensureDb();
    const row = this.db.prepare('SELECT * FROM llm_jobs WHERE id = ?').get(id);
    return toJobDto(row);
  }

  async listLlmJobs(filter = {}) {
    this._ensureDb();
    let rows;

    if (filter.llmModelId && filter.status) {
      rows = this.db
        .prepare(
          'SELECT * FROM llm_jobs WHERE llm_model_id = ? AND status = ? ORDER BY created_at DESC',
        )
        .all(filter.llmModelId, filter.status);
    } else if (filter.llmModelId) {
      rows = this.db
        .prepare('SELECT * FROM llm_jobs WHERE llm_model_id = ? ORDER BY created_at DESC')
        .all(filter.llmModelId);
    } else if (filter.status) {
      rows = this.db
        .prepare('SELECT * FROM llm_jobs WHERE status = ? ORDER BY created_at DESC')
        .all(filter.status);
    } else {
      rows = this.db.prepare('SELECT * FROM llm_jobs ORDER BY created_at DESC').all();
    }

    return rows.map(toJobDto);
  }

  async updateLlmJob(id, data) {
    this._ensureDb();
    const existing = this.db.prepare('SELECT * FROM llm_jobs WHERE id = ?').get(id);
    if (!existing) {
      return null;
    }

    try {
      this.db
        .prepare(
          `UPDATE llm_jobs SET
            status = ?,
            response_file = ?,
            summary = ?,
            error_message = ?,
            completed_at = ?
          WHERE id = ?`,
        )
        .run(
          data.status ?? existing.status,
          data.responseFile !== undefined ? data.responseFile : existing.response_file,
          data.summary !== undefined ? data.summary : existing.summary,
          data.errorMessage !== undefined ? data.errorMessage : existing.error_message,
          data.completedAt !== undefined ? data.completedAt : existing.completed_at,
          id,
        );
    } catch (error) {
      throw new PersistenceError('Failed to update LLM job', error);
    }

    return this.getLlmJob(id);
  }

  async countActiveJobsForModel(modelId) {
    this._ensureDb();
    const row = this.db
      .prepare(
        "SELECT COUNT(*) AS count FROM llm_jobs WHERE llm_model_id = ? AND status IN ('pending', 'running')",
      )
      .get(modelId);
    return row?.count ?? 0;
  }
}

module.exports = {
  SqlitePersistenceAdapter,
};
