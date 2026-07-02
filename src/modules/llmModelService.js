const { ValidationError } = require('../errors');
const { createCryptoAdapter } = require('../adapters/cryptoAdapter');
const { createLlmAdapter } = require('../adapters/llmAdapter');

const VALID_PROVIDERS = new Set(['ollama', 'openrouter']);

function createLlmModelService({ persistence, cryptoAdapter = createCryptoAdapter() }) {
  function validateProvider(provider) {
    if (!VALID_PROVIDERS.has(provider)) {
      throw new ValidationError(`Invalid provider: ${provider}`);
    }
  }

  function toPublicDto(model) {
    if (!model) {
      return null;
    }
    return { ...model };
  }

  async function create(data) {
    validateProvider(data.provider);

    if (data.provider === 'openrouter' && !data.token) {
      throw new ValidationError('OpenRouter models require a token');
    }

    if (!data.name || !data.modelId) {
      throw new ValidationError('name and modelId are required');
    }

    const tokenEncrypted =
      data.provider === 'openrouter' && data.token ? cryptoAdapter.encrypt(data.token) : null;

    const model = await persistence.createLlmModel({
      name: data.name,
      provider: data.provider,
      modelId: data.modelId,
      baseUrl: data.baseUrl ?? null,
      tokenEncrypted,
      isDefault: Boolean(data.isDefault),
    });

    return toPublicDto(model);
  }

  async function get(id) {
    return toPublicDto(await persistence.getLlmModel(id));
  }

  async function list(filter = {}) {
    const models = await persistence.listLlmModels(filter);
    return models.map(toPublicDto);
  }

  async function listForDropdown() {
    const models = await persistence.listLlmModels();
    return models.map(({ id, name, provider, isDefault }) => ({ id, name, provider, isDefault }));
  }

  async function update(id, data) {
    const existing = await persistence.getLlmModel(id);
    if (!existing) {
      return null;
    }

    if (data.provider) {
      validateProvider(data.provider);
    }

    const provider = data.provider ?? existing.provider;
    if (provider === 'openrouter') {
      const willHaveToken =
        data.token !== undefined
          ? Boolean(data.token)
          : existing.hasToken;
      if (!willHaveToken) {
        throw new ValidationError('OpenRouter models require a token');
      }
    }

    const payload = {
      name: data.name,
      provider: data.provider,
      modelId: data.modelId,
      baseUrl: data.baseUrl,
      isDefault: data.isDefault,
    };

    if (data.token !== undefined) {
      payload.tokenEncrypted =
        provider === 'openrouter' && data.token ? cryptoAdapter.encrypt(data.token) : null;
    }

    const updated = await persistence.updateLlmModel(id, payload);
    return toPublicDto(updated);
  }

  async function remove(id) {
    const activeJobs = persistence.countActiveJobsForModel
      ? await persistence.countActiveJobsForModel(id)
      : 0;

    if (activeJobs > 0) {
      const error = new ValidationError('Cannot delete model with active jobs');
      error.statusCode = 409;
      throw error;
    }

    return persistence.deleteLlmModel(id);
  }

  async function healthCheck(id) {
    const model = await persistence.getLlmModel(id);
    if (!model) {
      return { ok: false, error: 'Model not found' };
    }

    const raw = persistence.getLlmModelRaw
      ? persistence.getLlmModelRaw(id)
      : null;

    const config = {
      baseUrl: model.baseUrl,
      token: raw?.token_encrypted ? cryptoAdapter.decrypt(raw.token_encrypted) : undefined,
    };

    const adapter = createLlmAdapter(model.provider);
    const ok = await adapter.healthCheck(config);
    return { ok, provider: model.provider, modelId: model.modelId };
  }

  async function getModelConfig(id) {
    const model = await persistence.getLlmModel(id);
    if (!model) {
      return null;
    }

    const raw = persistence.getLlmModelRaw ? persistence.getLlmModelRaw(id) : null;

    return {
      ...model,
      token: raw?.token_encrypted ? cryptoAdapter.decrypt(raw.token_encrypted) : null,
    };
  }

  return {
    create,
    get,
    list,
    listForDropdown,
    update,
    remove,
    healthCheck,
    getModelConfig,
  };
}

module.exports = {
  createLlmModelService,
  VALID_PROVIDERS,
};
