# 📊 Firestore Collections - Documentação Completa

Este documento mapeia **todas as collections do Firestore** usadas no sistema Sob Investigação, incluindo estrutura de dados, índices necessários e quem as acessa.

---

## 📋 Collections Principais

### 1. `chats`
**Document ID**: `phoneNumber` (ex: `"+5511999999999"`)

**Estrutura**:
```typescript
{
  // Campos comuns
  createdAt?: Timestamp;
  lastUpdated?: string | Timestamp;
  messageCount?: number;

  // Estrutura 1: lastMessage (objeto único)
  lastMessage?: {
    msgType: string;
    msgBody: string;
    from: 'user' | 'bot' | 'client';
    gameType?: string;
    phaseId?: string;
    phaseName?: string;
    hasDirtyWord?: boolean;
    hasGiveup?: boolean;
    pushName?: string;
    createdAt?: Timestamp;
    updatedAt?: Timestamp;
    lastUpdated?: Timestamp;
    timestamp?: string | Timestamp;
  };

  // Estrutura 2: messages (array de mensagens)
  messages?: Array<{
    from: 'client' | 'bot' | 'user';
    msgBody: string;
    msgType: string;
    pushName: string;
    timestamp: string | Timestamp;
    gameType?: string;
    phaseId?: string;
    phaseName?: string;
    hasDirtyWord?: boolean;
    hasGiveup?: boolean;
  }>;
}
```

**Acessada por**:
- ✅ API (`users.service.ts`)
- ✅ N8N (webhooks do Shopify)
- ⏳ Worker (futuro)

**Índices necessários**:
- Nenhum (busca por document ID)

**Uso**:
- Histórico de conversas do WhatsApp
- Controle de acesso aos jogos
- Última mensagem e estado do jogo

---

### 2. `customers`
**Document ID**: ID gerado pelo Firestore

**Estrutura**:
```typescript
{
  cpf: string;
  name: string;
  phoneNumber: string;        // Telefone principal
  phoneNumberAlt?: string;     // Telefone alternativo (usado na migração)
  aiMessages: number;          // Contador de mensagens da IA
  twoFactorAuth: 'empty' | 'pending' | 'validated';
  twoFactorTimestamp?: Timestamp;
  createdAt: Timestamp;
}
```

**Acessada por**:
- ✅ API (`users.service.ts`)
- ✅ N8N (webhooks do Shopify)
- ⏳ Worker (futuro - para buscar nome/email)

**Índices necessários**:
- ⚠️ **CRÍTICO**: `phoneNumber` (ASC) - Para busca por telefone
- ⚠️ **CRÍTICO**: `phoneNumberAlt` (ASC) - Para busca por telefone alternativo

**Uso**:
- Dados dos clientes
- Controle de acesso
- Autenticação 2FA
- Migração de telefone

---

### 3. `conversations`
**Document ID**: ID gerado pelo Firestore

**Estrutura**:
```typescript
{
  conversationId: string;        // Mesmo que document ID
  phoneNumber: string;
  agentPhoneNumberId: string;    // ID do número do WhatsApp Business
  adkSessionId: string | null;   // Session ID do Vertex AI
  status: 'active' | 'closed';
  startedAt: Date;
  lastMessageAt: Date;
  closedAt: Date | null;
}
```

**Acessada por**:
- ✅ Webhook Service (`conversation.service.ts`)
- ✅ Worker (`worker/index.ts`)
- ✅ API (`agent.service.ts` - listagem por telefone e listagem global)

**Índices necessários**:
- ✅ **JÁ CRIADO**: Composto `phoneNumber` (ASC) + `status` (ASC) + `lastMessageAt` (DESC)
- ⚠️ **Para listar todas**: `lastMessageAt` (DESC) – lista global ordenada
- ⚠️ **Para listar todas com status**: Composto `status` (ASC) + `lastMessageAt` (DESC)

**Uso**:
- Gerenciar conversas ativas com o agente IA
- Manter sessão do Vertex AI
- Expiração automática (48h de inatividade)

---

### 4. `processing_jobs`
**Document ID**: ID gerado pelo Firestore

**Estrutura**:
```typescript
{
  traceId: string;              // UUID para rastreamento
  phoneNumber: string;
  messageId: string;            // ID da mensagem do WhatsApp
  text: string | null;          // Texto da mensagem
  conversationId: string;       // ID da conversa
  agentPhoneNumberId: string;   // ID do número do WhatsApp Business
  sessionId: string | null;     // Session ID do Vertex AI
  status: 'pending' | 'processing' | 'done' | 'failed';
  attempts: number;             // Número de tentativas
  createdAt: Date;
  startedAt?: Date;             // Quando começou a processar
  finishedAt?: Date;            // Quando terminou
  failedAt?: Date;              // Quando falhou
  lastError?: string;           // Último erro (se falhou)
}
```

**Acessada por**:
- ✅ Webhook Service (`webhook.service.ts`) - Cria jobs
- ✅ Worker (`worker/index.ts`) - Processa jobs
- ⏳ API (futuro - `JobsModule`)

**Índices necessários**:
- ⚠️ **RECOMENDADO**: `status` (ASC) + `createdAt` (DESC) - Para listar jobs por status
- ⚠️ **RECOMENDADO**: `phoneNumber` (ASC) + `createdAt` (DESC) - Para buscar jobs por telefone
- ⚠️ **RECOMENDADO**: `traceId` (ASC) - Para rastreamento

**Uso**:
- Fila de processamento de mensagens
- Rastreamento de jobs
- Retry automático
- DLQ (Dead Letter Queue) para jobs falhados

---

### 5. `webhook_logs`
**Document ID**: ID gerado pelo Firestore

**Estrutura**:
```typescript
{
  payload: any;                 // Payload completo do webhook
  traceId: string;              // UUID para rastreamento
  phoneNumber: string;
  messageId: string;            // ID da mensagem do WhatsApp
  text: string | null;          // Texto da mensagem
  createdAt: Date;
}
```

**Acessada por**:
- ✅ Webhook Service (`webhook.service.ts`) - Apenas escrita
- ⏳ API (futuro - logs e debug)

**Índices necessários**:
- ⚠️ **RECOMENDADO**: `phoneNumber` (ASC) + `createdAt` (DESC) - Para buscar logs por telefone
- ⚠️ **RECOMENDADO**: `traceId` (ASC) - Para rastreamento
- ⚠️ **RECOMENDADO**: `createdAt` (DESC) - Para logs recentes

**Uso**:
- Auditoria de webhooks
- Debug de problemas
- Rastreamento de mensagens

---

### 6. `agent_responses`
**Document ID**: ID gerado pelo Firestore

**Estrutura**:
```typescript
{
  traceId: string;              // UUID para rastreamento
  phoneNumber: string;
  question: string;              // Pergunta do usuário
  response: {
    text: string;                // Resposta do agente
  };
  createdAt: Date;
  source: 'vertex-ai' | string; // Fonte da resposta
}
```

**Acessada por**:
- ✅ Worker (`worker/index.ts`) - Apenas escrita
- ⏳ API (futuro - `AgentModule`)

**Índices necessários**:
- ⚠️ **RECOMENDADO**: `phoneNumber` (ASC) + `createdAt` (DESC) - Para histórico por telefone
- ⚠️ **RECOMENDADO**: `traceId` (ASC) - Para rastreamento
- ⚠️ **RECOMENDADO**: `createdAt` (DESC) - Para respostas recentes

**Uso**:
- Histórico de respostas do agente
- Análise de qualidade
- Debug de problemas
- Métricas de uso

---

### 7. `phase_analyses`
**Document ID**: `${gameId}_${phaseId}` (IDs sanitizados, sem `/`)

**Estrutura**:
```typescript
{
  gameId: string;
  phaseId: string;
  phaseName?: string;
  analysisText?: string;         // Texto da análise gerada por IA
  topWords?: Array<{ word: string; count: number }>;
  generatedAt: Date;
  updatedAt: Date;
}
```

**Acessada por**:
- ✅ API (`jobs.service.ts`) - Leitura e escrita

**Índices necessários**:
- ⚠️ **RECOMENDADO**: `gameId` (ASC) - Para listar análises por jogo

**Uso**:
- Dashboard de Análise: armazenar texto de análise por IA por fase
- "Gerar nova análise" e "Palavras mais usadas" (podem ser computadas em tempo ou persistidas aqui)

---

### 8. `orders`
**Document ID**: ID gerado pelo Firestore

**Estrutura** (inferida do código):
```typescript
{
  phoneNumber: string;           // Telefone principal
  phoneNumberAlt?: string;       // Telefone alternativo
  email: string;                 // Email do cliente
  name: string;                  // Nome completo
  // ... outros campos do pedido do Shopify
}
```

**Acessada por**:
- ✅ Worker (`ai.service.ts`) - Busca nome/email
- ✅ N8N (webhooks do Shopify)
- ⏳ API (futuro - consultas)

**Índices necessários**:
- ⚠️ **CRÍTICO**: `phoneNumber` (ASC) - Para busca por telefone
- ⚠️ **CRÍTICO**: `phoneNumberAlt` (ASC) - Para busca por telefone alternativo
- ⚠️ **RECOMENDADO**: `email` (ASC) - Para busca por email

**Uso**:
- Dados de pedidos do Shopify
- Busca de nome/email do usuário para personalização
- Histórico de compras

---

## 📋 Collections Mencionadas (Não Confirmadas)

Estas collections foram mencionadas no PDF, mas não encontrei uso no código atual:

### 9. `availableCodes`
**Status**: ⚠️ Não encontrado no código
**Uso esperado**: Códigos de ativação disponíveis

### 10. `used_tokens`
**Status**: ⚠️ Não encontrado no código
**Uso esperado**: Tokens/códigos já utilizados

### 11. `token_validations`
**Status**: ⚠️ Não encontrado no código
**Uso esperado**: Validações de tokens

### 12. `tags`
**Status**: ⚠️ Não encontrado no código
**Uso esperado**: Tags para categorização

### 13. `phone_updates`
**Status**: ⚠️ Não encontrado no código
**Uso esperado**: Histórico de atualizações de telefone

### 14. `error_logs`
**Status**: ⚠️ Não encontrado no código
**Uso esperado**: Logs de erros

### 15. `healthCheck`
**Status**: ⚠️ Não encontrado no código
**Uso esperado**: Health checks do sistema

---

## 🔍 Índices Críticos a Criar

### Prioridade 🔴 ALTA

1. **`customers`**:
   ```json
   {
     "collectionGroup": "customers",
     "fields": [
       { "fieldPath": "phoneNumber", "order": "ASCENDING" }
     ]
   }
   ```

2. **`customers`** (alternativo):
   ```json
   {
     "collectionGroup": "customers",
     "fields": [
       { "fieldPath": "phoneNumberAlt", "order": "ASCENDING" }
     ]
   }
   ```

3. **`orders`**:
   ```json
   {
     "collectionGroup": "orders",
     "fields": [
       { "fieldPath": "phoneNumber", "order": "ASCENDING" }
     ]
   }
   ```

4. **`orders`** (alternativo):
   ```json
   {
     "collectionGroup": "orders",
     "fields": [
       { "fieldPath": "phoneNumberAlt", "order": "ASCENDING" }
     ]
   }
   ```

### Prioridade 🟡 MÉDIA

5. **`processing_jobs`**:
   ```json
   {
     "collectionGroup": "processing_jobs",
     "fields": [
       { "fieldPath": "status", "order": "ASCENDING" },
       { "fieldPath": "createdAt", "order": "DESCENDING" }
     ]
   }
   ```

6. **`processing_jobs`** (por telefone):
   ```json
   {
     "collectionGroup": "processing_jobs",
     "fields": [
       { "fieldPath": "phoneNumber", "order": "ASCENDING" },
       { "fieldPath": "createdAt", "order": "DESCENDING" }
     ]
   }
   ```

7. **`agent_responses`**:
   ```json
   {
     "collectionGroup": "agent_responses",
     "fields": [
       { "fieldPath": "phoneNumber", "order": "ASCENDING" },
       { "fieldPath": "createdAt", "order": "DESCENDING" }
     ]
   }
   ```

---

## 📝 Notas Importantes

### Estruturas Duplas

- **`chats`**: Pode ter `lastMessage` (objeto) OU `messages` (array)
  - A API já suporta ambas as estruturas
  - Ver `extractGameType()` em `users.service.ts`

### Timestamps

- Alguns campos usam `Timestamp` do Firestore
- Alguns campos usam `Date` do JavaScript
- Alguns campos usam `string` (formato legível)
- A API precisa normalizar isso

### Document IDs

- **`chats`**: Usa `phoneNumber` como document ID
- **Outras collections**: Usam IDs gerados pelo Firestore

---

## 🚀 Próximos Passos

1. ✅ Criar índices críticos (`customers`, `orders`)
2. ✅ Implementar schemas TypeScript para todas as collections
3. ✅ Criar helpers de leitura tipada
4. ✅ Documentar queries complexas

---

*Última atualização: Janeiro 2026*
