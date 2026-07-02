function toModelDto(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    modelId: row.model_id ?? row.modelId,
    baseUrl: row.base_url ?? row.baseUrl ?? null,
    hasToken: Boolean(row.token_encrypted ?? row.tokenEncrypted),
    isDefault: Boolean(row.is_default ?? row.isDefault),
    createdAt: row.created_at ?? row.createdAt,
    updatedAt: row.updated_at ?? row.updatedAt,
  };
}

function toJobDto(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    llmModelId: row.llm_model_id ?? row.llmModelId,
    sourceFile: row.source_file ?? row.sourceFile,
    sourceType: row.source_type ?? row.sourceType,
    promptTemplate: row.prompt_template ?? row.promptTemplate ?? null,
    status: row.status,
    responseFile: row.response_file ?? row.responseFile ?? null,
    summary: row.summary ?? null,
    errorMessage: row.error_message ?? row.errorMessage ?? null,
    createdAt: row.created_at ?? row.createdAt,
    completedAt: row.completed_at ?? row.completedAt ?? null,
  };
}

function nowIso() {
  return new Date().toISOString();
}

module.exports = {
  toModelDto,
  toJobDto,
  nowIso,
};
