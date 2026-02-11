# 🗺️ Roadmap Técnico - Sob Investigação API

## 🎯 Objetivo

Transformar a API em uma **plataforma autônoma e escalável** que reduza a dependência manual do N8N e permita crescimento sustentável.

---

## 📅 Fase 1: Integração e Visibilidade (2 semanas)

### Prioridade: 🔴 ALTA

**Objetivo**: Conectar a API com os dados do Worker e fornecer visibilidade operacional.

#### 1.1 Implementar `JobsModule` ✅
**Estimativa**: 2-3 dias

**Endpoints**:
```typescript
GET /api/jobs/:jobId
  - Retorna status, tentativas, erros, timestamps

GET /api/jobs
  - Query params: ?status=pending|processing|done|failed
  - Query params: ?phoneNumber=...
  - Paginação e filtros

GET /api/jobs/stats
  - Métricas: pendentes, processando, falhados, sucesso
  - Últimas 24h, 7 dias, 30 dias
```

**Collections**: `processing_jobs`

#### 1.2 Implementar `AgentModule` ✅
**Estimativa**: 2-3 dias

**Endpoints**:
```typescript
GET /api/agent/responses/:phoneNumber
  - Histórico de respostas do agente
  - Filtros: data, traceId, gameType

GET /api/agent/conversations/:phoneNumber
  - Conversas ativas/fechadas
  - Status, timestamps, sessionId

GET /api/agent/conversations/:conversationId/messages
  - Mensagens de uma conversa específica
```

**Collections**: `agent_responses`, `conversations`

#### 1.3 Validação e Tratamento de Erros ✅
**Estimativa**: 1-2 dias

- Instalar `class-validator` e `class-transformer`
- Adicionar validação nos DTOs existentes
- Criar `GlobalExceptionFilter`
- Padronizar respostas de erro

**Resultado**: API robusta e confiável

---

## 📅 Fase 2: Autonomia Operacional (3 semanas)

### Prioridade: 🔴 ALTA

**Objetivo**: Reduzir dependência manual e permitir gestão via API.

#### 2.1 Implementar `GamesModule` ✅
**Estimativa**: 1 semana

**Endpoints**:
```typescript
GET /api/games
  - Lista todos os jogos
  - Filtros: ativo, tipo, data

GET /api/games/:gameId
  - Detalhes do jogo

POST /api/games
  - Criar novo jogo
  - Body: nome, tipo, prompts, configurações

PUT /api/games/:gameId
  - Atualizar jogo

DELETE /api/games/:gameId
  - Desativar jogo (soft delete)

POST /api/games/:gameId/activate
  - Ativar jogo para um telefone
  - Body: { phoneNumber, source: 'shopify' | 'code' }

POST /api/games/:gameId/deactivate
  - Desativar jogo para um telefone
```

**Collections**: Nova collection `games` ou usar estrutura existente

#### 2.2 Webhooks do Shopify na API ✅
**Estimativa**: 1 semana

**Objetivo**: Processar compras diretamente, reduzindo dependência do N8N

**Endpoints**:
```typescript
POST /api/webhooks/shopify/order-created
POST /api/webhooks/shopify/order-updated
POST /api/webhooks/shopify/order-cancelled
POST /api/webhooks/shopify/customer-updated
```

**Funcionalidades**:
- Validar assinatura do webhook (Shopify HMAC)
- Processar compra e liberar acesso
- Atualizar `customers` e `chats`
- Logs em `webhook_logs`

**Resultado**: Redução de 50%+ na dependência do N8N para compras

#### 2.3 Sistema de Códigos de Ativação ✅
**Estimativa**: 1 semana

**Endpoints**:
```typescript
POST /api/codes/generate
  - Body: { gameId, quantity, format }
  - Retorna: array de códigos

GET /api/codes/:code
  - Verificar status do código

POST /api/codes/:code/activate
  - Ativar código para um telefone
  - Body: { phoneNumber }
  - Cria pedido R$0 no Shopify (se necessário)
```

**Collections**: Nova collection `activation_codes`

**Resultado**: Autonomia total para gerar códigos

---

## 📅 Fase 3: Robustez e Segurança (2 semanas)

### Prioridade: 🟡 MÉDIA

#### 3.1 Autenticação e Autorização ✅
**Estimativa**: 1 semana

**Opções**:
- **API Keys** (mais simples, B2B)
- **JWT** (mais flexível, multi-user)

**Implementação**:
```typescript
// Middleware de autenticação
@UseGuards(ApiKeyGuard)

// Decorator para roles
@Roles('admin', 'operator')
```

**Endpoints protegidos**:
- Todos os endpoints de escrita
- Endpoints administrativos
- Webhooks (validação HMAC)

#### 3.2 Documentação com Swagger ✅
**Estimativa**: 2-3 dias

- Instalar `@nestjs/swagger`
- Adicionar decorators nos controllers
- Documentar DTOs e responses
- Deploy da documentação

**Resultado**: API auto-documentada

#### 3.3 Observabilidade ✅
**Estimativa**: 3-4 dias

- Logs estruturados (JSON)
- Integração com Cloud Logging
- Métricas básicas (requests, errors, latency)
- Health checks detalhados

---

## 📅 Fase 4: Escalabilidade e Performance (2 semanas)

### Prioridade: 🟢 BAIXA (mas importante)

#### 4.1 Cache Strategy
- Cache de consultas frequentes (Redis ou Memory)
- Cache de jogos liberados por telefone
- TTL apropriado

#### 4.2 Otimizações de Firestore
- Batch reads quando possível
- Índices otimizados
- Queries eficientes

#### 4.3 Rate Limiting
- Proteção contra abuso
- Limites por IP/API Key
- Throttling inteligente

---

## 📊 Métricas de Sucesso

### Fase 1
- ✅ API consulta todos os dados do Worker
- ✅ Visibilidade completa de jobs e conversas
- ✅ Validação robusta implementada

### Fase 2
- ✅ Redução de 50%+ na dependência do N8N
- ✅ Novos jogos podem ser criados via API
- ✅ Códigos gerados autonomamente

### Fase 3
- ✅ API protegida e documentada
- ✅ Logs e métricas funcionando
- ✅ Zero vulnerabilidades conhecidas

### Fase 4
- ✅ API suporta 10x mais requisições
- ✅ Latência < 200ms (p95)
- ✅ 99.9% uptime

---

## 🛠️ Stack Técnico Adicional

### Dependências a Adicionar

```json
{
  "dependencies": {
    "@nestjs/swagger": "^7.x",
    "class-validator": "^0.14.x",
    "class-transformer": "^0.5.x",
    "@nestjs/jwt": "^10.x",
    "@nestjs/passport": "^10.x",
    "passport": "^0.7.x",
    "passport-jwt": "^4.x",
    "redis": "^4.x",
    "@nestjs/throttler": "^5.x"
  }
}
```

---

## 📝 Notas de Implementação

### Estrutura de Pastas Sugerida

```
src/
├── common/
│   ├── decorators/
│   ├── filters/
│   ├── guards/
│   ├── interceptors/
│   └── pipes/
├── config/
│   └── swagger.config.ts
└── ...
```

### Padrões a Seguir

1. **Services**: Lógica de negócio
2. **Controllers**: Apenas roteamento e validação
3. **DTOs**: Validação com class-validator
4. **Interceptors**: Transformação de respostas
5. **Guards**: Autenticação/autorização
6. **Filters**: Tratamento de erros

---

## 🚀 Quick Wins (Implementar Primeiro)

1. ✅ **JobsModule básico** (1 dia)
   - `GET /api/jobs/:jobId`
   - Retorno imediato de valor

2. ✅ **Validação de DTOs** (1 dia)
   - Melhora qualidade imediata

3. ✅ **Swagger básico** (2 horas)
   - Documentação automática

---

## 📞 Próximas Ações Imediatas

1. **Decidir prioridades** com o time
2. **Criar issues** no GitHub/GitLab
3. **Iniciar Fase 1** (JobsModule + AgentModule)
4. **Deploy da API** no Cloud Run
5. **Testar integração** com Worker

---

*Última atualização: Janeiro 2026*
