const api = {
  async request(path, options = {}, body = null) {
    const response = await fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
      body: body == null ? undefined : JSON.stringify(body),
    });

    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { raw: text };
      }
    }

    if (!response.ok) {
      const error = new Error(payload?.error || `HTTP ${response.status}`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }

    return payload;
  },

  listFiles() {
    return this.request('/api/v1/files');
  },

  fsRoots() {
    return this.request('/api/v1/fs/roots');
  },

  fsBrowse(targetPath) {
    const query = new URLSearchParams({ path: targetPath });
    return this.request(`/api/v1/fs/browse?${query}`);
  },

  stagePdfs(files) {
    return this.request('/api/v1/pipeline/stage', { method: 'POST' }, { files });
  },

  inputStage(files) {
    return this.request('/api/v1/input/stage', { method: 'POST' }, { files });
  },

  inputProcess(inputDir, files, outputDir) {
    return this.request('/api/v1/input/process', { method: 'POST' }, {
      inputDir,
      files,
      outputDir,
      overwrite: true,
    });
  },

  inputRun(files, processNames = null) {
    return this.request('/api/v1/input/run', { method: 'POST' }, {
      files,
      processNames,
      overwrite: true,
      formats: ['csv', 'xlsx'],
    });
  },

  pipelineScan(inputDir, recursive = false) {
    return this.request('/api/v1/pipeline/scan', { method: 'POST' }, { inputDir, recursive });
  },

  pipelineRun(inputDir, outputDir) {
    return this.request('/api/v1/pipeline/run', { method: 'POST' }, {
      inputDir,
      outputDir,
      overwrite: true,
      formats: ['csv', 'xlsx'],
    });
  },

  spreadsheetScan(inputDir, recursive = false) {
    return this.request('/api/v1/spreadsheet/scan', { method: 'POST' }, { inputDir, recursive });
  },

  spreadsheetImport(sourceFile, inputDir) {
    return this.request('/api/v1/spreadsheet/import', { method: 'POST' }, {
      sourceFile,
      inputDir,
      overwrite: true,
      formats: ['csv', 'xlsx'],
    });
  },

  listModels() {
    return this.request('/api/v1/llm/models');
  },

  createModel(data) {
    return this.request('/api/v1/llm/models', { method: 'POST' }, data);
  },

  updateModel(id, data) {
    return this.request(`/api/v1/llm/models/${id}`, { method: 'PUT' }, data);
  },

  deleteModel(id) {
    return this.request(`/api/v1/llm/models/${id}`, { method: 'DELETE' });
  },

  healthCheck(id) {
    return this.request(`/api/v1/llm/models/${id}/health`, { method: 'POST' });
  },

  processLlm(data) {
    return this.request('/api/v1/llm/process', { method: 'POST' }, data);
  },
};

window.api = api;
