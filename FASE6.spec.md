# FASE 6 — Especificação Técnica (SDD/TDD)
## PDF Summarizer AI — Multi-tenant, Assinatura Mensal e MySQL

---

## 1. Visão Geral

A **Fase 6** refatora a persistência para um modelo multi-tenant e prepara cobrança mensal manual:

- Cada usuário possui **seus próprios** `llm_models` e `llm_jobs` (`user_id`).
- **Isolamento no filesystem:** `output/<userId>/` e `staging/<userId>/` — um usuário não lê/escreve arquivos de outro.
- Controle de **assinatura** no usuário: `subscription_status`, `subscription_expires_at`, `subscription_plan` — sem gateway de pagamento.
- **ADM** isento de expiração; **USER** precisa de assinatura ativa para processar arquivos e usar LLM.
- **USER** passa a acessar as abas LLM Config e Process (somente dados próprios). Logs e gestão de usuários continuam só ADM.
- Adapters: **SQLite** (dev) + **MySQL** (produção Hostinger), mesmo contrato `PersistenceAdapter`.

**Dependências:** Fases 1–5. Lib nova: `mysql2`.

---

## 2. Stack

| Camada | Lib | Observação |
|--------|-----|------------|
| SQLite | `better-sqlite3` (reuso) | Dev / VPS simples |
| MySQL | `mysql2` | Produção Hostinger |
| Seleção | `PERSISTENCE=sqlite\|mysql` | `server.js` / builder |

---

## 3. Schema (delta)

### `users`

| Campo | Tipo | Regra |
|-------|------|--------|
| `subscription_status` | `active` \| `expired` \| `none` | `none` = nunca ativado |
| `subscription_expires_at` | ISO datetime nullable | `null` = sem vencimento (ADM) |
| `subscription_plan` | texto nullable | ex. `monthly` (informativo) |

### `llm_models` / `llm_jobs`

- `user_id` NOT NULL (FK → users)
- `is_default` por usuário (um default por `user_id`)
- Índices: `(user_id)`; jobs `(user_id, created_at)`

### Migração SQLite

1. Garantir colunas novas (ALTER / recreate + copy).
2. Models/jobs órfãos → primeiro usuário `ADM`.
3. Users ADM → `active` + `expires_at` null; USER → `none`.

---

## 4. Regras de negócio

1. Toda leitura/escrita de model/job exige `userId`; id de outro usuário → **404**.
2. Assinatura ativa: `role === 'ADM'` **ou** (`status === 'active'` e `expires_at > now()`).
3. USER sem assinatura ativa → `403 SUBSCRIPTION_EXPIRED` em rotas de arquivo/LLM/elevação. Login e `/auth/me` continuam.
4. `GET /auth/me` → `subscription: { status, expiresAt, plan, active }`.
5. ADM: `POST /auth/users` aceita `subscriptionExpiresAt` / `subscriptionPlan`; `PATCH /auth/users/:id/subscription`.
6. Seed ADM: `active`, `expires_at` null.

### Roles (atualizado)

| Role | Abas | APIs |
|------|------|------|
| ADM | Todas | Todas + users/logs; isento de assinatura |
| USER | Arquivos, LLM Config, LLM | input/pipeline/files/open/llm (próprios); 403 em logs/users |

### Filesystem (por usuário)

| Base | Path efetivo |
|------|----------------|
| `OUTPUT_DIR` | `<OUTPUT_DIR>/<userId>/` |
| `STAGING_DIR` | `<STAGING_DIR>/<userId>/` |

- Rotas `/api/v1/files`, `/open/*`, input, pipeline e LLM usam sempre o workspace do `auth.userId` (ou `local-open-user` sem auth).
- `body.outputDir` do client é ignorado nas rotas autenticadas de pipeline/processamento.
- `userId` é sanitizado para pasta (rejeita `..`, `/`, `\`).

---

## 5. Persistência

```js
createPersistenceAdapter('sqlite' | 'memory' | 'mysql', options)
// mysql options: { host, port, user, password, database }
```

Métodos de model/job sempre recebem / filtram por `userId`.

---

## 6. Rotas novas / alteradas

| Método | Path | Notas |
|--------|------|-------|
| PATCH | `/api/v1/auth/users/:id/subscription` | ADM; body `{ expiresAt, plan?, status? }` |
| POST | `/api/v1/auth/users` | + campos de assinatura |
| GET | `/api/v1/auth/me` | + `subscription` |
| * | `/api/v1/llm/*` | roles ADM+USER; scoped por `userId` |

---

## 7. Env

```bash
PERSISTENCE=sqlite          # ou mysql
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=
MYSQL_PASSWORD=
MYSQL_DATABASE=pdf_summarizer
```

---

## 8. Casos de teste

```
SUITE: multi-tenant models/jobs
  ✦ [F6-01] createLlmModel exige userId e persiste user_id
  ✦ [F6-02] listLlmModels(userA) não retorna models de userB
  ✦ [F6-03] get/update/delete de model de outro user → null/404
  ✦ [F6-04] is_default independente por usuário
  ✦ [F6-05] jobs isolados por userId

SUITE: assinatura
  ✦ [F6-06] isSubscriptionActive: ADM sempre true
  ✦ [F6-07] USER active + expiresAt futuro → true
  ✦ [F6-08] USER expired / none / passado → false
  ✦ [F6-09] renewSubscription / PATCH atualiza expiresAt e status active
  ✦ [F6-10] USER expirado: login 200; GET /files → 403 SUBSCRIPTION_EXPIRED
  ✦ [F6-11] após PATCH renew, GET /files com elevação → 200

SUITE: roles
  ✦ [F6-12] USER acessa GET /api/v1/llm/models (próprios) → 200
  ✦ [F6-13] USER em /api/v1/logs → 403 FORBIDDEN_ROLE

SUITE: filesystem por usuário
  ✦ [F6-FS] staging/output isolados; GET /files e /open não cruzam tenants
  ✦ [F6-FS-unit] sanitizeUserIdForPath / resolveUserWorkspace

SUITE: factory / mysql
  ✦ [F6-14] createPersistenceAdapter('mysql') retorna MySQL adapter
  ✦ [F6-15] createPersistenceAdapter tipo desconhecido → throw

SUITE: migração
  ✦ [F6-16] init SQLite migra órfãos para ADM e preenche subscription
```

---

## 9. Critérios de Aceite

- [x] F6-01..F6-16 + F6-FS passam; regressão Fases 1–5 verde
- [x] Models/jobs isolados por usuário
- [x] staging/output isolados por `userId` no disco
- [x] USER expirado bloqueado; ADM livre
- [x] `PERSISTENCE=mysql` documentado e adapter implementado
- [x] USER vê abas LLM; badge de assinatura no header
- [x] Sem gateway de pagamento

---

## 10. Ordem TDD

```
Passo 1 → FASE6.spec.md
Passo 2 → Schema + migração SQLite/memory + DTOs
Passo 3 → Services + appServer scoped por userId
Passo 4 → Assinatura + guard + PATCH
Passo 5 → mysqlPersistenceAdapter + PERSISTENCE
Passo 6 → Isolamento FS output/staging por userId
Passo 7 → Frontend + README + .env.example
```

---

## 11. Fora de escopo

- Stripe/PIX / UI ADM de cobrança
