# PDF Summarizer AI

Pipeline modular em Node.js para extrair texto de PDFs, estruturar dados tabulares, exportar planilhas e processar conteúdo com LLMs. A **Fase 1** entrega a base reutilizável; a **Fase 2** adiciona interface web, API REST e integração Ollama/OpenRouter.

Especificações: [`FASE1.spec.md`](FASE1.spec.md) · [`FASE2.spec.md`](FASE2.spec.md)

---

## Roadmap

| Fase | Escopo | Status |
|------|--------|--------|
| **1** | Scan → extração → exportação (CSV/Excel) → links locais → logs | Implementada |
| **2** | UI web + API REST + CRUD LLM (Ollama/OpenRouter) + resposta JSON | Implementada |
| **3** | Instalador standalone Windows (`.exe`) | Planejada |

---

## Fase 1 — O que faz

1. **Lista PDFs** em um diretório local (com opção recursiva).
2. **Extrai texto** em batch, gerando um `.txt` por PDF (mesmo nome base sanitizado).
3. **Exporta planilhas** por PDF:
   - `.csv` — dados tabulares filtrados
   - `.xlsx` — Excel com as mesmas colunas
4. **Filtra só linhas de tabela** do documento (ignora cabeçalhos, rodapés, totais e metadados).
5. **Serve links locais** (`http://localhost:4000/files`) para abrir arquivos gerados.
6. **Registra logs** estruturados (NDJSON) por sessão em `logs/`.

---

## Requisitos

- Node.js **>= 20** LTS
- npm

```bash
npm install
```

---

## Uso rápido (CLI)

```bash
npm start -- <pasta-com-pdfs> [pasta-saida]
```

Exemplo:

```bash
npm start -- ./fixtures ./output
```

Saída típica por PDF `Produção unimed pgto070726.PDF`:

```
output/
  Produ__o_unimed_pgto070726.txt    # texto completo extraído
  Produ__o_unimed_pgto070726.csv    # só linhas de tabela
  Produ__o_unimed_pgto070726.xlsx   # só linhas de tabela
logs/
  session_<timestamp>_<id>.log
```

Links: `http://localhost:4000/files`

---

## Fase 2 — Interface web + LLM

### Iniciar servidor web

```bash
npm run start:web
```

Abre a UI em `http://127.0.0.1:4000` com 3 abas:

1. **Pipeline** — executa scan/extract/export da Fase 1 via API
2. **Modelos LLM** — CRUD de modelos Ollama e OpenRouter (token criptografado)
3. **Processar** — envia `.txt`/`.csv`/`.xlsx` para a LLM; exibe resumo e link do JSON

### API REST (`/api/v1`)

| Grupo | Rotas |
|-------|-------|
| Pipeline | `POST /api/v1/pipeline/scan`, `/extract`, `/export`, `/run` |
| Arquivos | `GET /api/v1/files`, `GET /open/:filename` |
| LLM CRUD | `GET/POST/PUT/DELETE /api/v1/llm/models`, `POST .../health` |
| Processamento | `POST /api/v1/llm/process`, `GET /api/v1/llm/jobs` |

### Facade Fase 2

```javascript
const {
  LlmSummarizerBuilder,
  createLlmAdapter,
  createPersistenceAdapter,
  ...phase1Exports
} = require('./src/api-v2');

const app = LlmSummarizerBuilder.create()
  .fromPhase1Api(require('./src/api'))
  .withPersistence('sqlite', { dbPath: './data/app.db' })
  .serve({ port: 4000 })
  .build();

await app.start();
// app.url → http://127.0.0.1:4000
```

### Variáveis de ambiente (Fase 2)

| Variável | Default | Descrição |
|----------|---------|-----------|
| `APP_SECRET_KEY` | gerada em dev | Chave AES-256 para tokens OpenRouter |
| `DB_PATH` | `./data/app.db` | SQLite |
| `PORT` | `4000` | Porta HTTP |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Ollama local |

---

## Arquitetura modular

A Fase 1 foi pensada para ser **composta**, não monolítica. Cada camada tem responsabilidade única e pode ser chamada isoladamente pela Fase 2/3.

```
pdf-summarizer-ai/
├── src/
│   ├── api.js                 # Facade Fase 1
│   ├── api-v2.js              # Facade Fase 2 (re-exporta Fase 1 + LLM)
│   ├── server.js              # Entry point web (npm run start:web)
│   ├── index.js               # CLI
│   ├── adapters/              # Troca de bibliotecas (pdf-parse, exceljs, pino…)
│   ├── modules/               # Regras de negócio puras
│   ├── pipeline/              # Orquestração fluente (Builder)
│   ├── errors/                # Erros tipados
│   └── utils/                 # Utilitários compartilhados
└── tests/                     # TDD (50 testes)
```

### Camadas

| Camada | Papel | Consumida por |
|--------|-------|----------------|
| **modules** | Lógica de domínio (scan, extract, export, log, links) | Pipeline, API, Fase 2 |
| **adapters** | Implementação concreta de libs externas | Modules (injeção/factory) |
| **pipeline** | Orquestra o fluxo completo com Builder | CLI, apps da Fase 2/3 |
| **api.js** | Facade estável para import externo | Fase 2, Fase 3, testes de integração |

### Fluxo de dados

```
PDFs ──► scanner ──► extractor ──► .txt
                         │
                         ▼
                  tableParser ──► linhas de tabela
                         │
                         ▼
                    exporter ──► .csv / .xlsx
                         │
            linker ◄─────┴────► links HTTP locais
            logger  (em todas as etapas)
```

---

## API programática (Fase 2 / Fase 3)

Importe o pacote pela facade pública — **não acople diretamente ao CLI** (`src/index.js`).

```javascript
const {
  PdfSummarizerBuilder,
  listPdfs,
  extractText,
  extractBatch,
  exportCsv,
  exportXlsx,
  createServer,
  createLogger,
  adapters,
  errors,
} = require('./src/api');
```

### Opção A — Pipeline completo (Builder)

Ideal para a Fase 3 (app/desktop) e fluxos “um clique” da Fase 2.

```javascript
const pipeline = PdfSummarizerBuilder.create()
  .fromDirectory('./pdfs')
  .outputTo('./output')
  .withLogs('./logs')
  .recursive(false)
  .overwrite(true)
  .exportFormats(['csv', 'xlsx'])   // 'xls' e 'excel' também aceitos
  .serveLinks(4000)                 // ou .withoutServer()
  .build();

const summary = await pipeline.run();
// summary: { scanned, extracted, failed, exports, logFile, serverUrl, files }

await pipeline.close(); // encerra servidor e logger
```

**Retorno `summary.exports`:**

```javascript
{
  csv:  [{ filePath, rowCount, sourcePdf }, ...],
  xlsx: [{ filePath, rowCount, sourcePdf }, ...],
}
```

Um arquivo de exportação **por PDF**, com nome derivado do PDF de origem.

### Opção B — Módulos isolados

Ideal para a Fase 2 montar fluxos customizados (ex.: extrair → escolher arquivo → enviar à LLM).

#### 1. Listar PDFs

```javascript
const pdfs = await listPdfs('./pdfs', { recursive: false });
// [{ name, path, sizeBytes }, ...]
```

#### 2. Extrair texto

```javascript
const result = await extractText('./pdfs/doc.pdf', './output', { overwrite: true });
// { inputFile, outputFile, pageCount, charCount, text, extractedAt }
```

```javascript
const batch = await extractBatch(['a.pdf', 'b.pdf'], './output');
// { results: [...], errors: [...] }
```

#### 3. Exportar planilhas (com filtro de tabela)

```javascript
const csv = await exportCsv([result], './output');
// { filePath: '.../doc.csv', rowCount, sourcePdf }

const xlsx = await exportXlsx([result], './output', {
  tableOnly: true,       // padrão: true
  fallbackToRaw: true,   // se não houver tabela, exporta texto bruto
});
```

#### 4. Servidor de links

```javascript
const server = await createServer({ port: 4000, outputDir: './output' });
// server.url → 'http://127.0.0.1:4000'
// GET /files  → lista arquivos
// GET /open/:filename → serve arquivo

await server.close();
```

#### 5. Logger

```javascript
const log = createLogger('meu-modulo', { logsDir: './logs' });
log.info('Processando', { count: 3 });
log.error('Falha', new Error('detalhe'));
await log.close();
```

---

## Módulos

### `scanner`

| Função | Descrição |
|--------|-----------|
| `listPdfs(dir, { recursive })` | Lista PDFs com caminho absoluto e tamanho |

Erro: `ScannerError`

### `extractor`

| Função | Descrição |
|--------|-----------|
| `extractText(pdfPath, outputDir, options)` | Extrai um PDF → `.txt` |
| `extractBatch(paths, outputDir, options)` | Batch tolerante a falhas |

Opções: `overwrite`, `parserAdapter`

Erro: `ExtractionError`

### `exporter`

| Função | Descrição |
|--------|-----------|
| `exportCsv(results, outputDir, options)` | CSV por PDF |
| `exportXlsx(results, outputDir, options)` | Excel por PDF |
| `resolveExportRows(results, options)` | Resolve linhas (tabela ou raw) sem gravar arquivo |

**Colunas exportadas (modo tabela):**

`source_pdf`, `guia`, `dt_emis`, `beneficiario`, `id_beneficiario`, `pl`, `medico`, `requisicao`, `codigo_procedimento`, `procedimento`, `qt`

Erro: `ExportError`

### `linker`

| Função | Descrição |
|--------|-----------|
| `createServer({ port, outputDir, host })` | HTTP local para links |

Erro: `LinkerError`

### `logger`

| Função | Descrição |
|--------|-----------|
| `createLogger(moduleName, options)` | Logger NDJSON por sessão |

---

## Adapters (extensibilidade)

Bibliotecas externas ficam atrás de adapters. Para trocar implementação, use as factories em `src/adapters/`:

| Adapter | Padrão | Factory | Alternativas |
|---------|--------|---------|--------------|
| PDF | `pdf-parse` v2 | `createPdfParserAdapter('pdf-parse-v2')` | `pdf-parse-v1` |
| Excel | `exceljs` | `createExcelWriterAdapter('exceljs')` | extensível |
| CSV | `csv-writer` | `createCsvWriterAdapter('csv-writer')` | extensível |
| Log | `pino` | `createLoggerAdapter('pino')` | extensível |
| Tabela | heurística Unimed | `createTableParserAdapter('auto')` | `unimed-guia`, `generic` |

### Exemplo — injetar adapter no extrator

```javascript
const { createPdfParserAdapter } = require('./src/adapters/pdfParserAdapter');

const result = await extractText('./doc.pdf', './output', {
  parserAdapter: createPdfParserAdapter('pdf-parse-v2'),
  overwrite: true,
});
```

### Exemplo — novo formato de tabela (Fase 2+)

Crie um parser em `tableParserAdapter.js` e registre na factory `createTableParserAdapter`. A Fase 2 pode selecionar o parser conforme o tipo de documento escolhido pelo usuário.

```javascript
const { createTableParserAdapter } = require('./src/adapters/tableParserAdapter');

const parsed = createTableParserAdapter('unimed-guia').parse(textoExtraido);
// { rows: [...], skippedLines: [...], parser: 'unimed-guia' }
```

---

## Integração prevista — Fase 2 (LLM)

**Status: implementada.** Ver [`FASE2.spec.md`](FASE2.spec.md) e seção "Fase 2" acima.

A Fase 1 expõe os artefatos que a Fase 2 consome:

| Artefato | Uso na Fase 2 |
|----------|----------------|
| `.txt` | Texto completo para prompt da LLM |
| `.csv` / `.xlsx` | Dados tabulares filtrados para análise/resumo |
| `summary.files` | Lista de extrações com metadados |
| `createServer` | Links para o usuário abrir arquivos e respostas JSON (Fase 2.4) |
| `createLogger` | Rastreio de chamadas LLM no mesmo padrão NDJSON |
| `adapters` | Padrão a seguir para `ollamaAdapter`, `openRouterAdapter` |

**Fluxo sugerido Fase 2:**

```
Fase 1 (extract + export) → usuário escolhe .txt/.csv/.xlsx → LLM adapter → .json + resumo
```

A Fase 2 deve importar `src/api.js` e compor módulos sem duplicar extração/exportação.

---

## Integração prevista — Fase 3 (instalador)

A Fase 3 empacota o mesmo núcleo:

- **Entry point desktop:** `PdfSummarizerBuilder` + UI
- **CLI embutida:** `src/index.js` ou wrapper
- **Diretórios padrão:** `output/`, `logs/` (gitignored)
- **Dependência Node:** `>= 20` empacotado no instalador

O instalador não precisa reimplementar scan/extract/export — apenas orquestra a API existente.

---

## Testes

```bash
npm test              # 111 testes, TDD
npm run test:coverage # cobertura >= 80%
```

Estrutura espelha os módulos: `tests/scanner.test.js`, `tests/extractor.test.js`, `tests/exporter.test.js`, `tests/tableParser.test.js`, etc.

---

## Scripts

| Script | Descrição |
|--------|-----------|
| `npm start` | CLI Fase 1 — pipeline completo |
| `npm run start:web` | Servidor web Fase 2 (UI + API) |
| `npm test` | Suite de testes |
| `npm run test:coverage` | Cobertura |
| `node scripts/create-fixtures.js` | Gera PDFs de exemplo em `fixtures/` |

---

## Segurança (Fase 1)

- Sem `eval` nem execução de código embarcado em PDF
- Sem requisições HTTP externas (apenas servidor local)
- Path traversal bloqueado no `linker`
- Saídas isoladas em `output/` e `logs/`
- Nomes de arquivo sanitizados (`sanitizeBaseName`)

---

## Referências

- Especificação TDD Fase 1: [`FASE1.spec.md`](FASE1.spec.md)
- Especificação SDD Fase 2: [`FASE2.spec.md`](FASE2.spec.md)
- Visão original das 3 fases: [`README_OLD.md`](README_OLD.md)
