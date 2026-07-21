# FASE 4 — Especificação Técnica (SDD)
## PDF Summarizer AI — Aba de Gerenciamento de Logs

---

## 1. Visão Geral

A **Fase 4** adiciona ao sistema uma **aba dedicada a logs** na interface web, permitindo listar, visualizar, filtrar e excluir arquivos de log gerados pelas fases anteriores.

**Funcionalidades principais:**

- Nova aba **"Logs"** no HTML — sequência: `Arquivos | Logs | Modelos LLM | Processar LLM`
- Listagem de arquivos `.log` do diretório `logs/` com filtro por nome e ordenação por nome/data
- Checkbox por arquivo + checkbox "Selecionar todos" para exclusão em lote
- Ação **Abrir** que carrega o conteúdo NDJSON em uma área de visualização read-only
- Ação **Excluir selecionados** (em vez de "limpar todos")
- Endpoint de exclusão em lote via `POST /api/v1/logs/batch-delete`

**Dependências:**
- Fase 1/2/3: diretório `logs/` populado por `createLogger` (NDJSON)
- Fase 2: `appServer.js`, `api-client.js`, `app.js`
- Nenhuma dependência externa nova — apenas `fs` nativo do Node.js

---

## 2. Stack Tecnológica

| Camada | Lib / Ferramenta | Observação |
|--------|------------------|------------|
| Runtime | Node.js >= 20 LTS | Mesmo das fases anteriores |
| Leitura de diretório | `fs/promises` (built-in) | `readdir`, `stat` |
| Leitura de arquivo | `fs/promises` (built-in) | `readFile` |
| UI | HTML5 + CSS + JS vanilla | Mesmo padrão Fase 2 |
| Segurança | `isPathInside` (reuso) | `src/utils/paths.js` |
| Test Runner | Jest ^30 | Consistência com fases anteriores |

---

## 3. Estrutura de Pastas (delta)

```
pdf-summarizer-ai/
├── src/
│   ├── modules/
│   │   ├── appServer.js              # MODIFICADO — + rotas /api/v1/logs/*
│   │   └── logViewerService.js       # NOVO
├── public/
│   ├── index.html                    # MODIFICADO — + aba Logs
│   └── js/
│       ├── api-client.js             # MODIFICADO — + métodos logs
│       ├── logs-ui.js                # NOVO
│       └── app.js                    # MODIFICADO — bootstrap logsUi
└── tests/
    └── logViewerService.test.js      # NOVO
```

---

## 4. Módulo Backend — `logViewerService.js`

**Arquivo:** `src/modules/logViewerService.js`

### 4.1 Interface

```js
const logViewerService = {
  async listLogs(logsDir, { search, sort, order } = {}),
  async readLog(logsDir, filename),
  async deleteLog(logsDir, filename),
  async batchDeleteLogs(logsDir, filenames),
};
```

### 4.2 `listLogs(logsDir, options)`

**Parâmetros:**

| Campo | Tipo | Default | Descrição |
|-------|------|---------|-----------|
| `logsDir` | `string` | — | Caminho absoluto do diretório de logs |
| `search` | `string?` | `undefined` | Filtro case-insensitive por nome (qualquer posição) |
| `sort` | `'name' \| 'date'` | `'date'` | Campo de ordenação |
| `order` | `'asc' \| 'desc'` | `'desc'` | Direção |

**Retorno:** `Promise<LogEntry[]>`

```ts
type LogEntry = {
  name: string;        // "session_2026-07-20_abc123.log"
  path: string;        // "/abs/path/logs/session_2026-07-20_abc123.log"
  sizeBytes: number;
  modifiedAt: string;  // ISO-8601
};
```

**Regras:**
1. Ignorar subdiretórios e arquivos que não terminem com `.log`
2. Se `logsDir` não existir, retornar `[]` (sem erro)
3. Filtro `search`: `name.toLowerCase().includes(search.toLowerCase())`
4. Ordenação: `date` usa `modifiedAt`; `name` usa `name`

### 4.3 `readLog(logsDir, filename)`

**Parâmetros:**

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `logsDir` | `string` | Caminho absoluto |
| `filename` | `string` | Nome do arquivo (sofre validação) |

**Validações (order):**
1. Se `filename` contém `..` ou `/` ou `\` → lança `LogViewerError` com status 400
2. Se extensão não é `.log` → lança `LogViewerError` com status 400
3. Se `!isPathInside(logsDir, filename)` → lança `LogViewerError` com status 400 (path traversal)
4. Se arquivo não existe → lança `LogViewerError` com status 404

**Retorno:** `Promise<{ name: string, content: string }>`

### 4.4 `deleteLog(logsDir, filename)`

Mesmas validações de `readLog`.

**Retorno:** `Promise<{ deleted: true, name: string }>`

### 4.5 `batchDeleteLogs(logsDir, filenames)`

**Parâmetros:**

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `logsDir` | `string` | Caminho absoluto |
| `filenames` | `string[]` | Lista de nomes |

**Validações:**
1. Se `filenames` não é array ou está vazio → lança `LogViewerError` status 400
2. Se **qualquer** nome falhar validação de path → lança `LogViewerError` status 400 (atomic — nada é deletado)

**Retorno:**
```js
{
  deleted: 2,
  failed: [],  // nomes que não existiam (não considerado erro)
}
```

---

## 5. Erros Tipados

```js
// src/errors/index.js (adição)
class LogViewerError extends AppError {
  constructor(message, { statusCode = 500, code, cause } = {}) {
    super(message, cause);
    this.name = 'LogViewerError';
    this.statusCode = statusCode;
    this.code = code; // 'INVALID_PATH', 'NOT_FOUND', 'INVALID_EXTENSION'
  }
}
```

---

## 6. API REST (extensão Fase 2)

Integradas ao `createAppRequestHandler` em `appServer.js`. Prefixo **`/api/v1/logs`**.

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/api/v1/logs` | Lista logs. Query: `?search=&sort=name\|date&order=asc\|desc` |
| `GET` | `/api/v1/logs/:filename` | Retorna conteúdo do log |
| `DELETE` | `/api/v1/logs/:filename` | Exclui um log |
| `POST` | `/api/v1/logs/batch-delete` | Exclui múltiplos. Body: `{ files: string[] }` |

### 6.1 `GET /api/v1/logs`

**Query Params:**

| Param | Tipo | Default | Descrição |
|-------|------|---------|-----------|
| `search` | `string` | — | Filtro por nome |
| `sort` | `string` | `date` | `name` ou `date` |
| `order` | `string` | `desc` | `asc` ou `desc` |

**Resposta `200`:**
```json
{
  "logs": [
    {
      "name": "session_2026-07-20_abc123.log",
      "path": "/abs/path/logs/session_2026-07-20_abc123.log",
      "sizeBytes": 12400,
      "modifiedAt": "2026-07-20T15:30:00.000Z"
    }
  ]
}
```

### 6.2 `GET /api/v1/logs/:filename`

**Resposta `200`:**
```json
{
  "name": "session_2026-07-20_abc123.log",
  "content": "{\"level\":\"info\",\"message\":\"...\"}\n..."
}
```

**Erros:** `400` (path inválido / extensão), `404` (não encontrado).

### 6.3 `DELETE /api/v1/logs/:filename`

**Resposta `200`:**
```json
{
  "deleted": true,
  "name": "session_2026-07-20_abc123.log"
}
```

### 6.4 `POST /api/v1/logs/batch-delete`

**Body:**
```json
{
  "files": ["session_a.log", "session_b.log"]
}
```

**Resposta `200`:**
```json
{
  "deleted": 2,
  "failed": [],
  "files": ["session_a.log", "session_b.log"]
}
```

---

## 7. Frontend — Aba Logs

### 7.1 HTML (`public/index.html`)

**Nova tab:**
```html
<button class="tab" data-tab="logs">Logs</button>
```

Inserir entre a tab `files` e a tab `models`, resultando em:
```html
<nav class="tabs">
  <button class="tab active" data-tab="files">Arquivos</button>
  <button class="tab" data-tab="logs">Logs</button>
  <button class="tab" data-tab="models">Modelos LLM</button>
  <button class="tab" data-tab="process">Processar LLM</button>
</nav>
```

**Novo painel `<section id="tab-logs" class="panel">`:**
```
┌──────────────────────────────────────────────────────────┐
│ Logs de sessão                                            │
│ ┌──────────────┐  [▼ Nome ▲]                             │
│ │ Buscar log... │                                         │
│ └──────────────┘                                         │
│                                                          │
│ [Excluir selecionados]  (3 de 10 arquivos selecionados)  │
│                                                          │
│ ☑ session_2026-07-20_abc123.log  12 KB  20/07  [Abrir]  │
│ ☐ session_2026-07-19_xyz789.log   8 KB  19/07  [Abrir]  │
│ ☑ session_2026-07-18_foo.log      5 KB  18/07  [Abrir]  │
│                                                          │
│ ──── session_2026-07-20_abc123.log ────                  │
│ {"level":"info","message":"Scanning...","timestamp":"... │
│ ...                                                       │
└──────────────────────────────────────────────────────────┘
```

**Elementos no DOM:**

| ID / Seletor | Tipo | Descrição |
|--------------|------|-----------|
| `#log-search` | `<input>` | Filtro por nome |
| `#log-sort` | `<select>` | Opções: `name-asc`, `name-desc`, `date-desc`, `date-asc` |
| `#log-select-all` | `<input checkbox>` | Selecionar/desselecionar todos |
| `#log-count` | `<span>` | "X de Y arquivos selecionados" |
| `#log-delete-selected` | `<button>` | Excluir selecionados (disabled se nenhum) |
| `#log-table` | `<table>` | Lista de logs |
| `#log-table tbody` | — | Linhas dinâmicas |
| `#log-content-title` | `<h3>` | Nome do log sendo visualizado (oculto se vazio) |
| `#log-content` | `<pre>` | Conteúdo textual do log |

### 7.2 JS — `logs-ui.js`

```js
(function () {
  'use strict';

  let logsData = [];        // cache da lista
  let selectedLogs = new Set(); // nomes selecionados
  let currentLog = null;    // nome do log sendo visualizado

  async function loadLogs();
  function renderLogsTable();
  function renderLogTableRow(entry);
  function updateSelectionUI();
  function updateSelectAllCheckbox();
  async function openLog(filename);
  async function deleteSelected();
})(window);
```

**Comportamento dos componentes:**

| Componente | Evento | Ação |
|------------|--------|------|
| `#log-search` | `input` (debounce 300ms) | Filtra `logsData` por nome e re-renderiza |
| `#log-sort` | `change` | Reordena `logsData` e re-renderiza |
| `#log-select-all` | `change` | Marca/desmarca todos visíveis (filtrados) |
| Checkbox da linha | `change` | Atualiza `selectedLogs` e `updateSelectionUI()` |
| `#log-delete-selected` | `click` | Confirma → `api.deleteLogsBatch([...])` → `loadLogs()` |
| Botão "Abrir" | `click` | `openLog(name)` → fetch GET → exibe em `#log-content` |

**Regras de seleção:**
1. `#log-select-all` marca apenas as linhas **visíveis** (após filtro)
2. Ao desmarcar uma linha, `#log-select-all` desmarca (ou fica indeterminado)
3. `#log-delete-selected` fica `disabled` se `selectedLogs.size === 0`

**Ordenação (`#log-sort`):**

| value | Sort | Order |
|-------|------|-------|
| `name-asc` | name | asc |
| `name-desc` | name | desc |
| `date-desc` | date | desc (default) |
| `date-asc` | date | asc |

**Formatação de tamanho:** bytes → KB/MB (mesmo utilitário de `input-ui.js`).

**Formatação de data:** `modifiedAt` ISO → `DD/MM/AAAA HH:MM`.

### 7.3 API Client — `api-client.js` (adições)

```js
listLogs(params = {}) {
  const query = new URLSearchParams();
  if (params.search) query.set('search', params.search);
  if (params.sort) query.set('sort', params.sort);
  if (params.order) query.set('order', params.order);
  const qs = query.toString();
  return this.request(`/api/v1/logs${qs ? '?' + qs : ''}`);
},

readLog(filename) {
  return this.request(`/api/v1/logs/${encodeURIComponent(filename)}`);
},

deleteLog(filename) {
  return this.request(`/api/v1/logs/${encodeURIComponent(filename)}`, { method: 'DELETE' });
},

deleteLogsBatch(filenames) {
  return this.request('/api/v1/logs/batch-delete', { method: 'POST' }, { files: filenames });
},
```

### 7.4 Bootstrap — `app.js` (modificação)

Adicionar após `initLlmUi`:
```js
if (typeof window.initLogsUi === 'function') {
  window.initLogsUi();
}
```

---

## 8. Testes — `logViewerService.test.js`

### 8.1 Fixtures

Usar diretório temporário em `beforeEach`/`afterEach` com `fs.mkdtempSync` + `fs.writeFileSync` para criar arquivos `.log` e outros tipos.

### 8.2 Casos de teste

```
SUITE: logViewerService — listLogs
  ✦ [F4-01] deve retornar [] se logsDir não existe
  ✦ [F4-02] deve listar apenas arquivos .log (ignorar .txt, subpastas)
  ✦ [F4-03] cada entry deve conter name, path, sizeBytes, modifiedAt
  ✦ [F4-04] deve ordenar por name asc/desc
  ✦ [F4-05] deve ordenar por date asc/desc
  ✦ [F4-06] deve filtrar por search (case-insensitive, qualquer posição)

SUITE: logViewerService — readLog
  ✦ [F4-07] deve retornar { name, content } com conteúdo textual
  ✦ [F4-08] deve lançar LogViewerError 400 se filename tem ..
  ✦ [F4-09] deve lançar LogViewerError 400 se filename contém /
  ✦ [F4-10] deve lançar LogViewerError 400 se extensão não é .log
  ✦ [F4-11] deve lançar LogViewerError 404 se arquivo não existe

SUITE: logViewerService — deleteLog
  ✦ [F4-12] deve deletar arquivo e retornar { deleted: true }
  ✦ [F4-13] deve lançar LogViewerError 400 se path traversal
  ✦ [F4-14] deve lançar LogViewerError 400 se extensão não é .log

SUITE: logViewerService — batchDeleteLogs
  ✦ [F4-15] deve deletar múltiplos e retornar deleted: N
  ✦ [F4-16] deve ignorar nomes inexistentes (failed: [])
  ✦ [F4-17] deve lançar LogViewerError 400 se array vazio
  ✦ [F4-18] deve lançar LogViewerError 400 se algum nome é path traversal (nada deletado)

SUITE: logViewerService — API REST (integração com appServer)
  ✦ [F4-19] GET /api/v1/logs deve retornar 200 com array logs
  ✦ [F4-20] GET /api/v1/logs/:name deve retornar 200 com content
  ✦ [F4-21] GET /api/v1/logs/../foo.log deve retornar 400
  ✦ [F4-22] GET /api/v1/logs/inexistente.log deve retornar 404
  ✦ [F4-23] DELETE /api/v1/logs/:name deve retornar 200
  ✦ [F4-24] POST /api/v1/logs/batch-delete com body válido → 200
  ✦ [F4-25] POST /api/v1/logs/batch-delete com array vazio → 400
```

---

## 9. Fluxo End-to-End

```
Usuário (UI)
    │
    ├─► Navega para aba "Logs"
    │
    ├─► GET /api/v1/logs → tabela preenchida
    │
    ├─► Digita "abc" no filtro → re-renderiza client-side
    │
    ├─► Clica [Abrir] → GET /api/v1/logs/session_abc.log
    │       └─► Exibe conteúdo em #log-content
    │
    ├─► Marca checkbox de 3 logs → [Excluir selecionados] habilitado
    │
    └─► Clica [Excluir selecionados]
            ├─► Confirm("Excluir 3 arquivos de log?")
            ├─► POST /api/v1/logs/batch-delete { files: [...] }
            │       └─► logViewerService.batchDeleteLogs()
            └─► Re-renderiza tabela + limpa área de conteúdo se log visualizado foi deletado
```

---

## 10. Critérios de Aceite (Definition of Done — FASE 4)

- [ ] Todos os 25 casos de teste F4-01..F4-25 passam (`npm test`)
- [ ] Cobertura de linha >= 80% nos módulos novos (`npm run test:coverage`)
- [ ] Aba "Logs" visível entre "Arquivos" e "Modelos LLM" no HTML
- [ ] Listagem de logs com nome, tamanho e data corretos
- [ ] Filtro por nome funciona (client-side, case-insensitive)
- [ ] Ordenação por nome/data ascendente/descendente funciona
- [ ] Checkbox "Selecionar todos" marca apenas linhas visíveis
- [ ] Botão "Excluir selecionados" remove apenas os marcados (com confirmação)
- [ ] Botão "Excluir selecionados" desabilitado quando nenhum selecionado
- [ ] Ao clicar "Abrir", conteúdo do log é exibido na área de visualização
- [ ] Path traversal bloqueado em todas as rotas (regressão Fase 1)
- [ ] `npm audit` sem vulnerabilidades high/critical
- [ ] Nenhuma dependência npm nova adicionada

---

## 11. Ordem de Implementação (TDD)

```
Passo 1 → LogViewerError em errors/index.js
Passo 2 → logViewerService            (F4-01..18)
Passo 3 → rotas /api/v1/logs/* em appServer (F4-19..25)
Passo 4 → api-client.js (métodos logs)
Passo 5 → public/index.html (aba + painel Logs)
Passo 6 → logs-ui.js
Passo 7 → app.js (bootstrap)
```

---

## 12. Segurança

1. **Path traversal:** `logViewerService` valida com `isPathInside` + rejeição explícita de `..`, `/`, `\`
2. **Extensão restrita:** apenas `.log` — qualquer outra extensão é rejeitada (400)
3. **Exclusão atômica no batch:** se qualquer nome for inválido, nada é deletado
4. **Sem rede externa:** todas as operações são locais com `fs` nativo
5. **Logs nunca alterados:** apenas leitura e exclusão — sem modificação de conteúdo
