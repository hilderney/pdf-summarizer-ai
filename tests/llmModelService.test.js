const { createPersistenceAdapter } = require('../src/adapters/persistenceAdapter');
const { createCryptoAdapter } = require('../src/adapters/cryptoAdapter');
const { createLlmModelService } = require('../src/modules/llmModelService');
const { ValidationError } = require('../src/errors');

const TEST_KEY = Buffer.alloc(32, 3).toString('hex');

describe('llmModelService', () => {
  let persistence;
  let service;

  beforeEach(async () => {
    persistence = createPersistenceAdapter('memory');
    await persistence.init();
    service = createLlmModelService({
      persistence,
      cryptoAdapter: createCryptoAdapter({ secret: TEST_KEY }),
    });
  });

  afterEach(async () => {
    await persistence.close();
  });

  test('[F2-29] create deve validar provider enum (ollama|openrouter)', async () => {
    await expect(
      service.create({ name: 'Bad', provider: 'unknown', modelId: 'x' }),
    ).rejects.toThrow(ValidationError);
  });

  test('[F2-30] create openrouter sem token deve lançar ValidationError', async () => {
    await expect(
      service.create({ name: 'OR', provider: 'openrouter', modelId: 'openai/gpt-4o-mini' }),
    ).rejects.toThrow(ValidationError);
  });

  test('[F2-31] update deve permitir rotacionar token', async () => {
    const created = await service.create({
      name: 'OR',
      provider: 'openrouter',
      modelId: 'openai/gpt-4o-mini',
      token: 'sk-old',
    });

    const updated = await service.update(created.id, { token: 'sk-new' });
    expect(updated.hasToken).toBe(true);

    const config = await service.getModelConfig(created.id);
    expect(config.token).toBe('sk-new');
  });

  test('[F2-32] delete deve falhar se modelo referenciado por job ativo (409)', async () => {
    const model = await service.create({
      name: 'Ollama',
      provider: 'ollama',
      modelId: 'llama3',
    });

    await persistence.createLlmJob({
      llmModelId: model.id,
      sourceFile: 'doc.txt',
      sourceType: 'txt',
      status: 'running',
    });

    await expect(service.remove(model.id)).rejects.toMatchObject({ statusCode: 409 });
  });

  test('[F2-33] listForDropdown deve retornar { id, name, provider, isDefault }', async () => {
    await service.create({
      name: 'Default',
      provider: 'ollama',
      modelId: 'llama3',
      isDefault: true,
    });

    const items = await service.listForDropdown();
    expect(items[0]).toEqual({
      id: expect.any(String),
      name: 'Default',
      provider: 'ollama',
      isDefault: true,
    });
  });

  test('[F2-34] healthCheck deve retornar TOKEN_DECRYPT_FAILED quando chave mudou', async () => {
    const created = await service.create({
      name: 'OR',
      provider: 'openrouter',
      modelId: 'openai/gpt-4o-mini',
      token: 'sk-old',
    });

    const wrongKeyService = createLlmModelService({
      persistence,
      cryptoAdapter: createCryptoAdapter({ secret: Buffer.alloc(32, 9).toString('hex') }),
    });

    const result = await wrongKeyService.healthCheck(created.id);
    expect(result).toMatchObject({
      ok: false,
      code: 'TOKEN_DECRYPT_FAILED',
    });
  });
});
