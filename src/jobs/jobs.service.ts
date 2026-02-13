import { Injectable, NotFoundException } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { Firestore } from 'firebase-admin/firestore';
import { FIRESTORE } from '../infra/firebase/firebase.provider';
import type { ProcessingJob } from '../shared/types/processing-job.schema';
import type { Chat, MessageInArray, ChatMessage } from '../shared/types/chat.schema';
import { Timestamp, DocumentSnapshot } from 'firebase-admin/firestore';

const COLLECTION = 'processing_jobs';
const CHATS_COLLECTION = 'chats';
const PHASE_ANALYSES_COLLECTION = 'phase_analyses';

function phaseAnalysisDocId(gameId: string, phaseId: string): string {
  return `${String(gameId).replace(/\//g, '_')}_${String(phaseId).replace(/\//g, '_')}`;
}
const STATUSES = ['pending', 'processing', 'done', 'failed'] as const;
const MAX_CHATS_ANALYTICS = 1000;
const PERIOD_OPTIONS = ['24h', '7d', '30d'] as const;
type PeriodOption = (typeof PERIOD_OPTIONS)[number];

function toTimestampMs(value: unknown): number | null {
  if (value == null) return null;
  if (value instanceof Timestamp) return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') return new Date(value).getTime();
  return null;
}

function extractGameType(chat: Chat): string | undefined {
  if (chat.lastMessage?.gameType) return chat.lastMessage.gameType;
  if (chat.messages && chat.messages.length > 0) {
    const last = chat.messages[chat.messages.length - 1];
    return (last as MessageInArray).gameType;
  }
  return undefined;
}

/** Extrai phaseId/phaseName de uma mensagem, verificando campos alternativos */
function extractPhaseFromMessage(msg: Record<string, unknown>): { phaseId?: string; phaseName?: string } {
  // Campos possíveis para o ID da fase
  const phaseId = msg.phaseId ?? msg.phase_id ?? msg.phase ?? msg.fase ?? msg.currentPhase ?? msg.current_phase;
  // Campos possíveis para o nome da fase
  const phaseName = msg.phaseName ?? msg.phase_name ?? msg.faseName ?? msg.fase_name ?? msg.phase ?? msg.fase;

  return {
    phaseId: typeof phaseId === 'string' ? phaseId : undefined,
    phaseName: typeof phaseName === 'string' ? phaseName : undefined,
  };
}

function getMessagesFromChat(chat: Chat): Array<{ hasDirtyWord?: boolean; hasGiveup?: boolean; phaseId?: string; phaseName?: string }> {
  // Extrai fase do lastMessage como fallback (quando mensagens no array não têm fase)
  let fallbackPhase: { phaseId?: string; phaseName?: string } = {};
  if (chat.lastMessage) {
    fallbackPhase = extractPhaseFromMessage(chat.lastMessage as unknown as Record<string, unknown>);
  }

  if (chat.messages && chat.messages.length > 0) {
    return chat.messages.map((m) => {
      const msgObj = m as unknown as Record<string, unknown>;
      const phase = extractPhaseFromMessage(msgObj);
      // Usa a fase do lastMessage como fallback se a mensagem não tiver fase
      const effectivePhaseId = phase.phaseId ?? fallbackPhase.phaseId;
      const effectivePhaseName = phase.phaseName ?? fallbackPhase.phaseName;
      return {
        hasDirtyWord: (m as MessageInArray).hasDirtyWord,
        hasGiveup: (m as MessageInArray).hasGiveup,
        phaseId: effectivePhaseId,
        phaseName: effectivePhaseName,
      };
    });
  }
  if (chat.lastMessage) {
    const lm = chat.lastMessage as ChatMessage;
    return [{ hasDirtyWord: lm.hasDirtyWord, hasGiveup: lm.hasGiveup, phaseId: fallbackPhase.phaseId, phaseName: fallbackPhase.phaseName }];
  }
  return [];
}

/** Mensagens com timestamp (ms) e fase para cálculo de duração por fase. */
function getMessagesWithTimestampAndPhase(chat: Chat): Array<{ phaseKey: string; phaseName: string; tsMs: number }> {
  const out: Array<{ phaseKey: string; phaseName: string; tsMs: number }> = [];

  // Extrai fase do lastMessage como fallback
  let fallbackPhase: { phaseId?: string; phaseName?: string } = {};
  if (chat.lastMessage) {
    fallbackPhase = extractPhaseFromMessage(chat.lastMessage as unknown as Record<string, unknown>);
  }

  if (chat.messages && chat.messages.length > 0) {
    for (const m of chat.messages as MessageInArray[]) {
      const ts = toTimestampMs(m.timestamp);
      if (ts == null) continue;
      const phase = extractPhaseFromMessage(m as unknown as Record<string, unknown>);
      // Usa a fase do lastMessage como fallback
      const effectivePhaseId = phase.phaseId ?? fallbackPhase.phaseId;
      const effectivePhaseName = phase.phaseName ?? fallbackPhase.phaseName;
      const phaseKey = effectivePhaseId ?? effectivePhaseName ?? '_sem_fase_';
      const phaseName = effectivePhaseName ?? effectivePhaseId ?? 'Sem fase';
      out.push({ phaseKey, phaseName, tsMs: ts });
    }
    return out;
  }
  if (chat.lastMessage) {
    const lm = chat.lastMessage as ChatMessage;
    const ts = toTimestampMs(lm.timestamp ?? lm.createdAt ?? lm.lastUpdated);
    if (ts != null) {
      const phaseKey = fallbackPhase.phaseId ?? fallbackPhase.phaseName ?? '_sem_fase_';
      const phaseName = fallbackPhase.phaseName ?? fallbackPhase.phaseId ?? 'Sem fase';
      out.push({ phaseKey, phaseName, tsMs: ts });
    }
  }
  return out;
}

/** Mensagens com texto e fase para palavras mais usadas. */
function getMessagesWithBodyAndPhase(chat: Chat): Array<{ phaseKey: string; phaseName: string; msgBody: string }> {
  const out: Array<{ phaseKey: string; phaseName: string; msgBody: string }> = [];

  // Extrai fase do lastMessage como fallback
  let fallbackPhase: { phaseId?: string; phaseName?: string } = {};
  if (chat.lastMessage) {
    fallbackPhase = extractPhaseFromMessage(chat.lastMessage as unknown as Record<string, unknown>);
  }

  if (chat.messages && chat.messages.length > 0) {
    for (const m of chat.messages as MessageInArray[]) {
      const body = typeof m.msgBody === 'string' ? m.msgBody.trim() : '';
      if (!body) continue;
      const phase = extractPhaseFromMessage(m as unknown as Record<string, unknown>);
      // Usa a fase do lastMessage como fallback
      const effectivePhaseId = phase.phaseId ?? fallbackPhase.phaseId;
      const effectivePhaseName = phase.phaseName ?? fallbackPhase.phaseName;
      const phaseKey = effectivePhaseId ?? effectivePhaseName ?? '_sem_fase_';
      const phaseName = effectivePhaseName ?? effectivePhaseId ?? 'Sem fase';
      out.push({ phaseKey, phaseName, msgBody: body });
    }
    return out;
  }
  if (chat.lastMessage) {
    const lm = chat.lastMessage as ChatMessage;
    const body = typeof lm.msgBody === 'string' ? lm.msgBody.trim() : '';
    if (body) {
      const phaseKey = fallbackPhase.phaseId ?? fallbackPhase.phaseName ?? '_sem_fase_';
      const phaseName = fallbackPhase.phaseName ?? fallbackPhase.phaseId ?? 'Sem fase';
      out.push({ phaseKey, phaseName, msgBody: body });
    }
  }
  return out;
}

const STOPWORDS = new Set(
  'a o e de da do em um uma que com para por no na nos nas ao aos as os se lhe eu tu ele ela'.split(' '),
);
const MAX_TOP_WORDS = 50;
const MIN_WORD_LENGTH = 2;

function extractTopWords(texts: string[], limit: number): Array<{ word: string; count: number }> {
  const count = new Map<string, number>();
  for (const text of texts) {
    const words = text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= MIN_WORD_LENGTH && !STOPWORDS.has(w));
    for (const w of words) {
      count.set(w, (count.get(w) ?? 0) + 1);
    }
  }
  return Array.from(count.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([word, count]) => ({ word, count }));
}

function toJob(doc: DocumentSnapshot): ProcessingJob & { id: string } {
  const data = doc.data();
  if (!data) throw new NotFoundException(`Job ${doc.id} not found`);
  return {
    id: doc.id,
    traceId: data.traceId,
    phoneNumber: data.phoneNumber,
    messageId: data.messageId,
    text: data.text ?? null,
    conversationId: data.conversationId,
    agentPhoneNumberId: data.agentPhoneNumberId,
    sessionId: data.sessionId ?? null,
    status: data.status,
    attempts: data.attempts ?? 0,
    createdAt: data.createdAt,
    startedAt: data.startedAt,
    finishedAt: data.finishedAt,
    failedAt: data.failedAt,
    lastError: data.lastError,
  };
}

@Injectable()
export class JobsService {
  constructor(
    @Inject(FIRESTORE)
    private readonly firestore: Firestore,
  ) {}

  async getById(jobId: string): Promise<(ProcessingJob & { id: string }) | null> {
    const doc = await this.firestore.collection(COLLECTION).doc(jobId).get();
    if (!doc.exists) return null;
    return toJob(doc);
  }

  async list(params: {
    status?: (typeof STATUSES)[number];
    phoneNumber?: string;
    limit?: number;
    startAfter?: string;
  }): Promise<{ jobs: (ProcessingJob & { id: string })[]; nextCursor?: string }> {
    const limit = Math.min(Math.max(params.limit ?? 20, 1), 100);
    let query = this.firestore
      .collection(COLLECTION)
      .orderBy('createdAt', 'desc')
      .limit(limit + 1);

    if (params.status) {
      query = query.where('status', '==', params.status);
    }
    if (params.phoneNumber?.trim()) {
      query = query.where('phoneNumber', '==', params.phoneNumber.trim());
    }
    if (params.startAfter) {
      const cursorDoc = await this.firestore.collection(COLLECTION).doc(params.startAfter).get();
      if (cursorDoc.exists) {
        query = query.startAfter(cursorDoc);
      }
    }

    const snapshot = await query.get();
    const docs = snapshot.docs.slice(0, limit);
    const jobs = docs.map((d) => toJob(d));
    const nextCursor =
      snapshot.docs.length > limit ? snapshot.docs[limit - 1]?.id : undefined;
    return { jobs, nextCursor };
  }

  async getStats(period?: '24h' | '7d' | '30d'): Promise<{
    pending: number;
    processing: number;
    done: number;
    failed: number;
    period?: string;
  }> {
    const now = new Date();
    let startTimestamp: Timestamp | null = null;

    if (period === '24h') {
      startTimestamp = Timestamp.fromDate(new Date(now.getTime() - 24 * 60 * 60 * 1000));
    } else if (period === '7d') {
      startTimestamp = Timestamp.fromDate(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000));
    } else if (period === '30d') {
      startTimestamp = Timestamp.fromDate(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000));
    }

    // Usar count() do Firestore para evitar baixar documentos completos
    const counts = await Promise.all(
      STATUSES.map(async (status) => {
        let query = this.firestore.collection(COLLECTION).where('status', '==', status);
        if (startTimestamp) {
          query = query.where('createdAt', '>=', startTimestamp);
        }
        const countSnap = await query.count().get();
        return { status, count: countSnap.data().count };
      }),
    );

    return {
      pending: counts.find((c) => c.status === 'pending')?.count ?? 0,
      processing: counts.find((c) => c.status === 'processing')?.count ?? 0,
      done: counts.find((c) => c.status === 'done')?.count ?? 0,
      failed: counts.find((c) => c.status === 'failed')?.count ?? 0,
      period: period ?? undefined,
    };
  }

  /**
   * Métricas para o Dashboard de Análise: job stats + tempo médio, insultos, desistência, mensagens por fase.
   * Agrega de processing_jobs (tempo médio, contagens) e chats (insultos, desistência, mensagens por fase).
   */
  async getDashboardAnalytics(params: {
    period?: PeriodOption;
    gameId?: string;
  }): Promise<{
    jobStats: { pending: number; processing: number; done: number; failed: number; period?: string };
    tempoMedioTotalMin: number;
    totalInsultos: number;
    totalDesistencia: number;
    mediaMensagensPorFase: number;
    porFase: Array<{
      phaseId: string;
      phaseName: string;
      totalInsultos: number;
      totalDesistencia: number;
      totalMensagens: number;
      tempoMedioMin?: number;
      topWords: Array<{ word: string; count: number }>;
    }>;
    period?: string;
    gameId?: string;
  }> {
    const { period, gameId } = params;

    const now = Date.now();
    let startMs: number | null = null;
    if (period === '24h') startMs = now - 24 * 60 * 60 * 1000;
    else if (period === '7d') startMs = now - 7 * 24 * 60 * 60 * 1000;
    else if (period === '30d') startMs = now - 30 * 24 * 60 * 60 * 1000;

    const startTimestamp = startMs != null ? Timestamp.fromDate(new Date(startMs)) : null;

    // Executar queries em paralelo para melhor performance
    // Usar select() para trazer apenas campos necessários (reduz transferência de dados)
    const [jobStats, doneJobsSnap, chatsSnap] = await Promise.all([
      // 1. Stats dos jobs (usa count() internamente)
      this.getStats(period),
      // 2. Jobs done para calcular tempo médio - só precisa de startedAt e finishedAt
      startTimestamp
        ? this.firestore
            .collection(COLLECTION)
            .where('status', '==', 'done')
            .where('createdAt', '>=', startTimestamp)
            .select('startedAt', 'finishedAt')
            .get()
        : this.firestore
            .collection(COLLECTION)
            .where('status', '==', 'done')
            .select('startedAt', 'finishedAt')
            .limit(500)
            .get(),
      // 3. Chats para métricas de fases - só precisa de lastMessage, messages, lastUpdated
      startTimestamp
        ? this.firestore
            .collection(CHATS_COLLECTION)
            .where('lastUpdated', '>=', startTimestamp)
            .orderBy('lastUpdated', 'desc')
            .select('lastMessage', 'messages', 'lastUpdated', 'createdAt')
            .limit(MAX_CHATS_ANALYTICS)
            .get()
        : this.firestore
            .collection(CHATS_COLLECTION)
            .select('lastMessage', 'messages', 'lastUpdated', 'createdAt')
            .limit(MAX_CHATS_ANALYTICS)
            .get(),
    ]);

    // Tempo médio: jobs done no período, média (finishedAt - startedAt) em minutos
    const durations: number[] = [];
    for (const doc of doneJobsSnap.docs) {
      const d = doc.data();
      const started = toTimestampMs(d.startedAt);
      const finished = toTimestampMs(d.finishedAt);
      if (started != null && finished != null && finished >= started) {
        durations.push((finished - started) / (60 * 1000));
      }
    }
    const tempoMedioTotalMin = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;

    // Processar chats para métricas por fase
    let totalInsultos = 0;
    let totalDesistencia = 0;
    const phaseMap = new Map<
      string,
      {
        phaseName: string;
        insultos: number;
        desistencia: number;
        mensagens: number;
        sumDurationMs: number;
        countDuration: number;
        texts: string[];
      }
    >();
    let totalMensagens = 0;
    let fasesComMensagens = 0;

    for (const doc of chatsSnap.docs) {
      const data = doc.data() as Chat;
      // gameId ainda precisa filtrar em memória (campo aninhado lastMessage.gameType)
      if (gameId != null && gameId.trim() !== '') {
        const g = extractGameType(data);
        if (g !== gameId.trim()) continue;
      }
      const messages = getMessagesFromChat(data);
      for (const msg of messages) {
        const phaseKey = msg.phaseId ?? msg.phaseName ?? '_sem_fase_';
        const phaseName = msg.phaseName ?? msg.phaseId ?? 'Sem fase';
        if (!phaseMap.has(phaseKey)) {
          phaseMap.set(phaseKey, {
            phaseName,
            insultos: 0,
            desistencia: 0,
            mensagens: 0,
            sumDurationMs: 0,
            countDuration: 0,
            texts: [],
          });
        }
        const p = phaseMap.get(phaseKey)!;
        p.mensagens += 1;
        totalMensagens += 1;
        if (msg.hasDirtyWord) {
          p.insultos += 1;
          totalInsultos += 1;
        }
        if (msg.hasGiveup) {
          p.desistencia += 1;
          totalDesistencia += 1;
        }
      }
      // Duração por fase: max - min timestamp por fase neste chat
      const withTs = getMessagesWithTimestampAndPhase(data);
      const byPhase = new Map<string, number[]>();
      for (const { phaseKey, tsMs } of withTs) {
        if (!byPhase.has(phaseKey)) byPhase.set(phaseKey, []);
        byPhase.get(phaseKey)!.push(tsMs);
      }
      for (const [phaseKey, timestamps] of byPhase) {
        if (timestamps.length === 0) continue;
        const min = Math.min(...timestamps);
        const max = Math.max(...timestamps);
        const durationMs = max - min;
        if (!phaseMap.has(phaseKey)) {
          phaseMap.set(phaseKey, {
            phaseName: phaseKey === '_sem_fase_' ? 'Sem fase' : phaseKey,
            insultos: 0,
            desistencia: 0,
            mensagens: 0,
            sumDurationMs: 0,
            countDuration: 0,
            texts: [],
          });
        }
        const p = phaseMap.get(phaseKey)!;
        p.sumDurationMs += durationMs;
        p.countDuration += 1;
      }
      // Textos por fase para palavras mais usadas
      const withBody = getMessagesWithBodyAndPhase(data);
      for (const { phaseKey, phaseName, msgBody } of withBody) {
        if (!phaseMap.has(phaseKey)) {
          phaseMap.set(phaseKey, {
            phaseName,
            insultos: 0,
            desistencia: 0,
            mensagens: 0,
            sumDurationMs: 0,
            countDuration: 0,
            texts: [],
          });
        }
        phaseMap.get(phaseKey)!.texts.push(msgBody);
      }
    }

    const phases = Array.from(phaseMap.entries()).map(([phaseId, v]) => {
      const tempoMedioMin =
        v.countDuration > 0 ? (v.sumDurationMs / v.countDuration) / (60 * 1000) : undefined;
      const topWords = extractTopWords(v.texts, MAX_TOP_WORDS);
      return {
        phaseId,
        phaseName: v.phaseName,
        totalInsultos: v.insultos,
        totalDesistencia: v.desistencia,
        totalMensagens: v.mensagens,
        tempoMedioMin: tempoMedioMin != null ? Math.round(tempoMedioMin * 10) / 10 : undefined,
        topWords,
      };
    });
    if (phases.length > 0) {
      fasesComMensagens = phases.length;
    }
    const mediaMensagensPorFase = fasesComMensagens > 0 ? totalMensagens / fasesComMensagens : 0;

    return {
      jobStats,
      tempoMedioTotalMin: Math.round(tempoMedioTotalMin * 10) / 10,
      totalInsultos,
      totalDesistencia,
      mediaMensagensPorFase: Math.round(mediaMensagensPorFase * 10) / 10,
      porFase: phases,
      period: period ?? undefined,
      gameId: gameId?.trim() || undefined,
    };
  }

  /**
   * Lista análises por IA armazenadas para um jogo (para o Dashboard de Análise).
   */
  async getPhaseAnalyses(gameId: string): Promise<
    Array<{
      id: string;
      gameId: string;
      phaseId: string;
      phaseName?: string;
      analysisText?: string;
      topWords?: Array<{ word: string; count: number }>;
      generatedAt?: Date | Timestamp;
    }>
  > {
    const snapshot = await this.firestore
      .collection(PHASE_ANALYSES_COLLECTION)
      .where('gameId', '==', gameId)
      .get();
    return snapshot.docs.map((doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        gameId: d.gameId,
        phaseId: d.phaseId,
        phaseName: d.phaseName,
        analysisText: d.analysisText,
        topWords: d.topWords ?? [],
        generatedAt: d.generatedAt,
      };
    });
  }

  /**
   * Obtém uma análise por IA para um jogo e fase.
   */
  async getPhaseAnalysis(
    gameId: string,
    phaseId: string,
  ): Promise<{
    id: string;
    gameId: string;
    phaseId: string;
    phaseName?: string;
    analysisText?: string;
    topWords?: Array<{ word: string; count: number }>;
    generatedAt?: Date | Timestamp;
  } | null> {
    const id = phaseAnalysisDocId(gameId, phaseId);
    const doc = await this.firestore.collection(PHASE_ANALYSES_COLLECTION).doc(id).get();
    if (!doc.exists) return null;
    const d = doc.data()!;
    return {
      id: doc.id,
      gameId: d.gameId,
      phaseId: d.phaseId,
      phaseName: d.phaseName,
      analysisText: d.analysisText,
      topWords: d.topWords ?? [],
      generatedAt: d.generatedAt,
    };
  }

  /**
   * Cria ou atualiza análise por IA para uma fase (ex.: após "Gerar nova análise").
   */
  async savePhaseAnalysis(
    gameId: string,
    phaseId: string,
    body: {
      phaseName?: string;
      analysisText?: string;
      topWords?: Array<{ word: string; count: number }>;
    },
  ): Promise<{ id: string; generatedAt: Date }> {
    const id = phaseAnalysisDocId(gameId, phaseId);
    const ref = this.firestore.collection(PHASE_ANALYSES_COLLECTION).doc(id);
    const now = new Date();
    const data: Record<string, unknown> = {
      gameId,
      phaseId,
      updatedAt: now,
      generatedAt: now,
    };
    if (body.phaseName !== undefined) data.phaseName = body.phaseName;
    if (body.analysisText !== undefined) data.analysisText = body.analysisText;
    if (body.topWords !== undefined) data.topWords = body.topWords;
    await ref.set(data, { merge: true });
    return { id, generatedAt: now };
  }

  /**
   * Debug: retorna os campos reais das mensagens nos chats para identificar nomes de campos de fase.
   */
  async debugChatFields(limit: number = 5): Promise<{
    chatsAnalyzed: number;
    sampleMessages: Array<{
      chatId: string;
      messageIndex: number;
      allFields: string[];
      phaseRelatedFields: Record<string, unknown>;
    }>;
    uniqueFieldsFound: string[];
    phaseFieldsDistribution: Record<string, number>;
  }> {
    const snapshot = await this.firestore
      .collection(CHATS_COLLECTION)
      .limit(Math.min(limit, 20))
      .get();

    const sampleMessages: Array<{
      chatId: string;
      messageIndex: number;
      allFields: string[];
      phaseRelatedFields: Record<string, unknown>;
    }> = [];

    const allFieldsSet = new Set<string>();
    const phaseFieldsDistribution: Record<string, number> = {};

    for (const doc of snapshot.docs) {
      const chat = doc.data() as Chat;

      // Analisa messages array
      if (chat.messages && chat.messages.length > 0) {
        for (let i = 0; i < Math.min(chat.messages.length, 3); i++) {
          const msg = chat.messages[i] as unknown as Record<string, unknown>;
          const fields = Object.keys(msg);
          fields.forEach((f) => allFieldsSet.add(f));

          // Campos relacionados à fase
          const phaseRelatedFields: Record<string, unknown> = {};
          const phaseKeywords = ['phase', 'fase', 'step', 'etapa', 'stage', 'current'];
          for (const field of fields) {
            const lowerField = field.toLowerCase();
            if (phaseKeywords.some((kw) => lowerField.includes(kw))) {
              phaseRelatedFields[field] = msg[field];
              phaseFieldsDistribution[field] = (phaseFieldsDistribution[field] ?? 0) + 1;
            }
          }

          sampleMessages.push({
            chatId: doc.id,
            messageIndex: i,
            allFields: fields,
            phaseRelatedFields,
          });
        }
      }

      // Analisa lastMessage
      if (chat.lastMessage) {
        const msg = chat.lastMessage as unknown as Record<string, unknown>;
        const fields = Object.keys(msg);
        fields.forEach((f) => allFieldsSet.add(f));

        const phaseRelatedFields: Record<string, unknown> = {};
        const phaseKeywords = ['phase', 'fase', 'step', 'etapa', 'stage', 'current'];
        for (const field of fields) {
          const lowerField = field.toLowerCase();
          if (phaseKeywords.some((kw) => lowerField.includes(kw))) {
            phaseRelatedFields[field] = msg[field];
            phaseFieldsDistribution[field] = (phaseFieldsDistribution[field] ?? 0) + 1;
          }
        }

        sampleMessages.push({
          chatId: doc.id,
          messageIndex: -1, // -1 indica lastMessage
          allFields: fields,
          phaseRelatedFields,
        });
      }
    }

    return {
      chatsAnalyzed: snapshot.docs.length,
      sampleMessages: sampleMessages.slice(0, 20),
      uniqueFieldsFound: Array.from(allFieldsSet).sort(),
      phaseFieldsDistribution,
    };
  }
}
