# CLAUDE.md - Sob Investigacao API

## Visao Geral

API REST do sistema "Sob Investigacao" - plataforma de jogos investigativos via WhatsApp.
Este servico gerencia usuarios, jogos, webhooks e integracao com Firestore.

## Stack

- **Framework**: NestJS 11 com TypeScript
- **Runtime**: Node.js 20
- **Banco de dados**: Firebase Firestore
- **Deploy**: Google Cloud Run
- **Package Manager**: pnpm

## Estrutura do Projeto

```
src/
├── app.module.ts          # Modulo principal (guard global configurado aqui)
├── main.ts                # Bootstrap da aplicacao (porta, prefix /api)
├── common/
│   ├── guards/            # ApiKeyGuard (autenticacao global)
│   └── decorators/        # @Public() para rotas publicas
├── users/                 # Gestao de usuarios e jogos
├── games/                 # Gestao de jogos
├── auth/                  # Autenticacao JWT
├── webhooks/              # Webhooks Shopify
├── jobs/                  # Jobs de processamento
├── agent/                 # Agente IA
├── codes/                 # Codigos de ativacao
├── moderation/            # Moderacao de conteudo
└── infra/firebase/        # Configuracao Firestore
```

## Comandos

### Desenvolvimento
```bash
pnpm install          # Instalar dependencias
pnpm start:dev        # Rodar em modo desenvolvimento (hot reload)
pnpm build            # Build para producao
pnpm start:prod       # Rodar build de producao
```

### Testes
```bash
pnpm test             # Rodar testes
pnpm test:watch       # Testes em modo watch
pnpm test:cov         # Testes com cobertura
```

### Lint
```bash
pnpm lint             # Rodar ESLint com fix
pnpm format           # Formatar com Prettier
```

## Deploy

### Pre-requisitos
1. Google Cloud SDK instalado (`gcloud`)
2. Projeto GCP configurado com billing
3. Autenticado no gcloud: `gcloud auth login`

### Deploy Rapido
```bash
# 1. Configurar projeto (se necessario)
export GCP_PROJECT_ID="seu-project-id"
gcloud config set project $GCP_PROJECT_ID

# 2. Executar deploy
bash deploy.sh

# 3. Obter URL
gcloud run services describe sob-investigacao-api \
  --region us-central1 \
  --format 'value(status.url)'
```

### Deploy Manual
```bash
PROJECT_ID="seu-project-id"

# Build da imagem
gcloud builds submit --tag gcr.io/$PROJECT_ID/sob-investigacao-api

# Deploy no Cloud Run
gcloud run deploy sob-investigacao-api \
  --image gcr.io/$PROJECT_ID/sob-investigacao-api \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --port 8080 \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 10
```

### Ver Logs
```bash
gcloud run services logs read sob-investigacao-api \
  --region us-central1 \
  --limit 50
```

## Autenticacao

A API usa um guard global (`ApiKeyGuard`) que exige autenticacao em todas as rotas.

### Formas de autenticar:
1. Header `X-API-Key: <chave>` - usa a variavel de ambiente `API_KEY`
2. Header `Authorization: Bearer <token>` - JWT valido

### Rotas Publicas
Para tornar uma rota publica, adicione o decorator `@Public()`:

```typescript
import { Public } from '../common/decorators/public.decorator';

@Public()
@Get('minha-rota')
async minhaRota() { ... }
```

## Variaveis de Ambiente

```bash
PORT=3000                    # Porta do servidor (Cloud Run define automaticamente)
API_KEY=sua-chave-secreta    # Chave de API para autenticacao
JWT_SECRET=seu-jwt-secret    # Secret para tokens JWT
```

No Cloud Run, as credenciais do Firestore sao automaticas via Application Default Credentials.

## Padroes e Convencoes

- Prefix global de rotas: `/api`
- Controllers seguem padrao REST
- DTOs em `*.dto.ts` para validacao de entrada
- Services contem logica de negocio
- Firestore como banco de dados (collections: customers, chats, games, etc.)

## Collections Firestore Principais

| Collection | Descricao |
|------------|-----------|
| `customers` | Dados dos clientes (nome, telefone, jogos) |
| `chats` | Historico de conversas |
| `games` | Catalogo de jogos disponiveis |

## URL de Producao

```
https://sob-investigacao-api-508898990955.us-central1.run.app/api
```
