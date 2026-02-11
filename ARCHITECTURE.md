# 🏗️ Arquitetura do Sistema - Sob Investigação

## 📊 Visão Geral

O sistema é composto por **3 componentes principais** que trabalham juntos para entregar jogos investigativos via WhatsApp:

```
┌─────────────────┐
│   WhatsApp      │
│  Business API   │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│                    N8N (Orquestração)                   │
│  - Controle de estado do jogo                           │
│  - Árvore de decisão                                    │
│  - Integração Shopify ↔ Firebase                        │
│  - Fluxos de suporte                                    │
└────────┬────────────────────────────────────────────────┘
         │
         ├─────────────────┐
         │                 │
         ▼                 ▼
┌─────────────────┐  ┌──────────────────┐
│  Webhook Service │  │   API Service     │
│  (Express)       │  │   (NestJS)       │
│                  │  │                  │
│  - Recebe        │  │  - Consultas     │
│    webhooks      │  │  - Admin         │
│  - Cria jobs     │  │  - Gestão        │
│  - Worker AI     │  │  - Integrações   │
└────────┬─────────┘  └────────┬─────────┘
         │                     │
         └──────────┬──────────┘
                    ▼
         ┌──────────────────┐
         │    Firestore      │
         │  (Firebase)       │
         └──────────────────┘
```

---

## 🔧 Componentes Detalhados

### 1. **N8N** (Orquestração Principal)
**Status**: ✅ Em produção  
**Responsabilidades**:
- Recebe mensagens do WhatsApp Business API
- Controla fluxo do jogo (estado, perguntas, validações)
- Integra com Shopify (webhooks de compra)
- Gerencia liberação de acesso
- Fluxos de suporte e 2FA
- Geração de códigos de ativação

**Dores Identificadas**:
- ❌ Dependência manual para novos jogos
- ❌ Falta de autonomia operacional
- ❌ Quedas em picos de uso

---

### 2. **sob-investigacao-service** (Webhook + Worker)
**Status**: ✅ Em produção (Cloud Run)  
**Stack**: Express + TypeScript + Vertex AI

**Componentes**:

#### 2.1 Webhook Service (`server.ts`)
- Recebe webhooks do WhatsApp
- Valida payload
- Cria jobs no Firestore (`processing_jobs`)
- Publica no Pub/Sub para processamento assíncrono
- Loga eventos em `webhook_logs`

**Endpoints**:
- `GET /webhook` - Verificação (Meta)
- `POST /webhook` - Recebe mensagens

#### 2.2 Worker (`worker/index.ts`)
- Consome jobs do Pub/Sub
- Processa mensagens com Vertex AI
- Gera respostas do agente
- Envia mensagens via WhatsApp
- Salva respostas em `agent_responses`
- Atualiza conversas em `conversations`

**Collections Usadas**:
- `conversations` - Conversas ativas
- `processing_jobs` - Jobs de processamento
- `webhook_logs` - Logs de webhooks
- `agent_responses` - Respostas do agente

---

### 3. **sob-investigacao-api** (API REST)
**Status**: 🟡 Parcialmente implementado  
**Stack**: NestJS + TypeScript + Fastify

**Endpoints Implementados**:
- ✅ `GET /api/users/:phoneNumber/games` - Lista jogos do usuário
- ✅ `PATCH /api/users/change-phone` - Troca telefone preservando histórico

**Módulos Criados (vazios)**:
- ⏳ `WebhooksModule` - Endpoints para webhooks
- ⏳ `GamesModule` - Gestão de jogos
- ⏳ `JobsModule` - Consulta de jobs
- ⏳ `AgentModule` - Gestão de agente/respostas

**Collections Usadas**:
- `chats` - Histórico de conversas
- `customers` - Dados dos clientes

---

## 🔄 Fluxos Principais

### Fluxo 1: Mensagem do Usuário → Resposta do Agente

```
WhatsApp → N8N → Webhook Service → Pub/Sub → Worker → Vertex AI → WhatsApp
```

1. Usuário envia mensagem no WhatsApp
2. N8N recebe via WhatsApp Business API
3. N8N chama Webhook Service (se necessário)
4. Webhook Service cria job no Firestore
5. Webhook Service publica no Pub/Sub
6. Worker consome do Pub/Sub
7. Worker processa com Vertex AI
8. Worker envia resposta via WhatsApp
9. Worker salva resposta no Firestore

### Fluxo 2: Compra no Shopify → Liberação de Acesso

```
Shopify → Webhook → N8N → Firebase → WhatsApp (menu atualizado)
```

1. Cliente compra no Shopify
2. Shopify envia webhook para N8N
3. N8N atualiza Firebase (`customers`, `chats`)
4. Próxima interação no WhatsApp mostra jogos liberados

### Fluxo 3: Consulta de Dados (API)

```
Cliente → API Service → Firestore → Resposta
```

1. Cliente faz requisição na API
2. API consulta Firestore
3. API retorna dados formatados

---

## 📊 Collections do Firestore

### Collections Principais

| Collection | Uso | Acessada Por |
|------------|-----|--------------|
| `chats` | Histórico de conversas | API, N8N |
| `customers` | Dados dos clientes | API, N8N |
| `conversations` | Conversas ativas com agente | Webhook Service |
| `processing_jobs` | Jobs de processamento | Webhook Service, Worker |
| `webhook_logs` | Logs de webhooks | Webhook Service |
| `agent_responses` | Respostas do agente | Worker |

### Estruturas de Dados

#### `chats/{phoneNumber}`
```typescript
{
  createdAt: Timestamp,
  lastMessage?: ChatMessage,  // Estrutura 1
  messages?: MessageInArray[], // Estrutura 2
  messageCount?: number,
  lastUpdated?: string | Timestamp
}
```

#### `customers/{id}`
```typescript
{
  cpf: string,
  name: string,
  phoneNumber: string,
  phoneNumberAlt?: string,
  aiMessages: number,
  twoFactorAuth: 'empty' | 'pending' | 'validated',
  twoFactorTimestamp?: Timestamp,
  createdAt: Timestamp
}
```

#### `conversations/{id}`
```typescript
{
  conversationId: string,
  phoneNumber: string,
  agentPhoneNumberId: string,
  adkSessionId: string | null,
  status: 'active' | 'closed',
  startedAt: Date,
  lastMessageAt: Date,
  closedAt: Date | null
}
```

---

## 🎯 Gaps e Oportunidades

### 🔴 Críticos

1. **API não está integrada com Worker**
   - API não consulta `agent_responses`
   - API não consulta `processing_jobs`
   - Falta endpoint para status de processamento

2. **Falta de endpoints administrativos**
   - Consultar jobs pendentes/falhados
   - Consultar respostas do agente
   - Consultar conversas ativas
   - Estatísticas e métricas

3. **Módulos vazios não implementados**
   - `WebhooksModule` - Poderia receber webhooks do Shopify diretamente
   - `GamesModule` - Gestão de jogos (CRUD)
   - `JobsModule` - Consulta e gestão de jobs
   - `AgentModule` - Configuração e monitoramento do agente

### 🟡 Importantes

4. **Falta de autenticação/autorização**
   - API exposta sem proteção
   - Sem controle de acesso

5. **Falta de validação robusta**
   - DTOs sem validação (class-validator)
   - Sem tratamento global de erros

6. **Falta de documentação da API**
   - Sem Swagger/OpenAPI
   - Endpoints não documentados

### 🟢 Melhorias Futuras

7. **Observabilidade**
   - Logs estruturados
   - Métricas e alertas
   - Tracing distribuído

8. **Testes**
   - Testes unitários
   - Testes de integração
   - Testes E2E

---

## 🚀 Próximos Passos Recomendados

### Fase 1: Integração Básica (1-2 semanas)
1. ✅ Implementar endpoints em `JobsModule`
   - `GET /api/jobs/:jobId` - Status do job
   - `GET /api/jobs?status=pending` - Listar jobs
   
2. ✅ Implementar endpoints em `AgentModule`
   - `GET /api/agent/responses/:phoneNumber` - Histórico de respostas
   - `GET /api/agent/conversations/:phoneNumber` - Conversas ativas

3. ✅ Implementar validação de DTOs
   - Instalar `class-validator` e `class-transformer`
   - Adicionar decorators nos DTOs

### Fase 2: Autonomia Operacional (2-3 semanas)
4. ✅ Implementar `GamesModule`
   - CRUD de jogos
   - Configuração de prompts
   - Liberação de acesso

5. ✅ Implementar webhooks do Shopify na API
   - Reduzir dependência do N8N
   - Processar compras diretamente

6. ✅ Sistema de códigos de ativação
   - Geração via API
   - Validação e ativação

### Fase 3: Robustez e Escalabilidade (3-4 semanas)
7. ✅ Autenticação e autorização
   - API Keys ou JWT
   - Controle de acesso por role

8. ✅ Observabilidade
   - Logs estruturados
   - Métricas (Cloud Monitoring)
   - Alertas

9. ✅ Testes e CI/CD
   - Testes automatizados
   - Pipeline de deploy

---

## 📝 Notas Técnicas

### Deploy Atual
- **Webhook Service**: Cloud Run (`sob-investigacao-webhook`)
- **Worker**: Cloud Run (`sob-investigacao-worker`)
- **API Service**: ⏳ Ainda não deployado

### Variáveis de Ambiente Necessárias

**Webhook Service**:
- `GOOGLE_APPLICATION_CREDENTIALS`
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `PUBSUB_TOPIC_NAME`

**API Service**:
- `GOOGLE_APPLICATION_CREDENTIALS`
- `PORT` (Cloud Run define automaticamente)

### Índices Firestore Necessários

1. **conversations** (já documentado):
   - `phoneNumber` (ASC) + `status` (ASC) + `lastMessageAt` (DESC)

2. **customers** (necessário para API):
   - `phoneNumber` (ASC) - Para busca por telefone

---

## 🔗 Links Úteis

- [Documentação do Worker](../sob-investigacao-service/README.md)
- [Índices Firestore](../sob-investigacao-service/FIRESTORE_INDEX.md)
- [Guia de Deploy](./DEPLOY.md)
