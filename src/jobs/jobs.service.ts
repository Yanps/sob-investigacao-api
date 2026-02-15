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
const AGENT_RESPONSES_COLLECTION = 'agent_responses';
const MAX_AGENT_RESPONSES_ANALYTICS = 5000;

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

/**
 * Duração total (ms) do jogo a partir de chat.levels (setChatLevelInfo).
 * levels.<gameType>.phases.<phaseId>.startAt / endAt.
 */
function getTotalDurationMsFromLevels(
  data: Record<string, unknown>,
  gameId?: string,
): number {
  const levels = data.levels as Record<
    string,
    { phases?: Record<string, { startAt?: unknown; endAt?: unknown }> }
  > | undefined;
  if (!levels || typeof levels !== 'object') return 0;
  const gameKeys = gameId != null && gameId.trim() !== '' ? [gameId.trim()] : Object.keys(levels);
  let totalMs = 0;
  for (const g of gameKeys) {
    const gameLevels = levels[g];
    if (!gameLevels?.phases || typeof gameLevels.phases !== 'object') continue;
    for (const phaseKey of Object.keys(gameLevels.phases)) {
      const phase = gameLevels.phases[phaseKey];
      if (!phase) continue;
      const startMs = toTimestampMs(phase.startAt);
      const endMs = toTimestampMs(phase.endAt);
      if (startMs != null && endMs != null && endMs >= startMs) totalMs += endMs - startMs;
    }
  }
  return totalMs;
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
   * Métricas para o Dashboard a partir de chats. Tempo médio: levels.<game>.phases.*.startAt/endAt.
   * jobStats continua de processing_jobs; insultos, desistência e mensagens vêm de lastMessage/messages.
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

    // Chats: tempo (levels), insultos, desistência, mensagens por fase
    const chatsSnap = await (startTimestamp
      ? this.firestore
          .collection(CHATS_COLLECTION)
          .where('lastUpdated', '>=', startTimestamp)
          .orderBy('lastUpdated', 'desc')
          .select('lastMessage', 'messages', 'lastUpdated', 'createdAt', 'levels')
          .limit(MAX_CHATS_ANALYTICS)
          .get()
      : this.firestore
          .collection(CHATS_COLLECTION)
          .select('lastMessage', 'messages', 'lastUpdated', 'createdAt', 'levels')
          .limit(MAX_CHATS_ANALYTICS)
          .get());

    const jobStats = await this.getStats(period);
    const durationsMin: number[] = [];

    // Processar chats para métricas por fase e tempo (levels)
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
      if (gameId != null && gameId.trim() !== '') {
        const g = extractGameType(data);
        if (g !== gameId.trim()) continue;
      }
      const totalMs = getTotalDurationMsFromLevels(data as unknown as Record<string, unknown>, gameId ?? undefined);
      if (totalMs > 0) durationsMin.push(totalMs / (60 * 1000));

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

    const tempoMedioTotalMin =
      durationsMin.length > 0 ? durationsMin.reduce((a, b) => a + b, 0) / durationsMin.length : 0;

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
   * Métricas do summary a partir de agent_responses (gameId, phaseId, createdAt, hasOffense, hasDesistencia).
   * Tempos: duração por (phoneNumber, phaseId); avgTotalTime por usuário.
   * Ofensas/desistências/mensagens: contagem por fase a partir de hasOffense e hasDesistencia.
   */
  async getSummaryFromAgentResponses(params: {
    period?: PeriodOption;
    gameId?: string;
  }): Promise<{
    labels: string[];
    avgTimesData: number[];
    avgTotalTime: number;
    phaseOffenses: number[];
    phaseDesistencia: number[];
    phaseMessages: number[];
    totalInsultos: number;
    totalDesistencia: number;
  }> {
    const { period, gameId } = params;
    const now = Date.now();
    let startMs: number | null = null;
    if (period === '24h') startMs = now - 24 * 60 * 60 * 1000;
    else if (period === '7d') startMs = now - 7 * 24 * 60 * 60 * 1000;
    else if (period === '30d') startMs = now - 30 * 24 * 60 * 60 * 1000;
    const startTimestamp = startMs != null ? Timestamp.fromDate(new Date(startMs)) : null;

    const query = startTimestamp
      ? this.firestore
          .collection(AGENT_RESPONSES_COLLECTION)
          .where('createdAt', '>=', startTimestamp)
          .orderBy('createdAt', 'desc')
          .limit(MAX_AGENT_RESPONSES_ANALYTICS)
          .get()
      : this.firestore
          .collection(AGENT_RESPONSES_COLLECTION)
          .orderBy('createdAt', 'desc')
          .limit(MAX_AGENT_RESPONSES_ANALYTICS)
          .get();

    const snapshot = await query;
    type Row = {
      phoneNumber: string;
      phaseId: number;
      createdAtMs: number;
      hasOffense: boolean;
      hasDesistencia: boolean;
    };
    const rows: Row[] = [];
    for (const doc of snapshot.docs) {
      const d = doc.data();
      const phone = d.phoneNumber != null ? String(d.phoneNumber) : '';
      if (gameId != null && gameId.trim() !== '') {
        const g = d.gameId != null ? String(d.gameId).trim() : '';
        if (g !== gameId.trim()) continue;
      }
      const phaseId =
        typeof d.phaseId === 'number'
          ? d.phaseId
          : typeof d.phaseId === 'string'
            ? parseInt(d.phaseId, 10)
            : NaN;
      if (Number.isNaN(phaseId) || phaseId < 0) continue;
      const createdAtMs = toTimestampMs(d.createdAt);
      if (createdAtMs == null) continue;
      const hasOffense = d.hasOffense === true;
      const hasDesistencia = d.hasDesistencia === true;
      rows.push({ phoneNumber: phone, phaseId, createdAtMs, hasOffense, hasDesistencia });
    }

    const byPhonePhase = new Map<string, number[]>();
    const byPhoneAll = new Map<string, number[]>();
    for (const r of rows) {
      const key = `${r.phoneNumber}\t${r.phaseId}`;
      if (!byPhonePhase.has(key)) byPhonePhase.set(key, []);
      byPhonePhase.get(key)!.push(r.createdAtMs);
      if (!byPhoneAll.has(r.phoneNumber)) byPhoneAll.set(r.phoneNumber, []);
      byPhoneAll.get(r.phoneNumber)!.push(r.createdAtMs);
    }

    const phaseDurationsMs = new Map<number, number[]>();
    for (const [key, timestamps] of byPhonePhase) {
      if (timestamps.length === 0) continue;
      const durationMs = Math.max(...timestamps) - Math.min(...timestamps);
      const phaseId = parseInt(key.split('\t')[1], 10);
      if (!phaseDurationsMs.has(phaseId)) phaseDurationsMs.set(phaseId, []);
      phaseDurationsMs.get(phaseId)!.push(durationMs);
    }

    const phaseOffensesMap = new Map<number, number>();
    const phaseDesistenciaMap = new Map<number, number>();
    const phaseMessagesMap = new Map<number, number>();
    for (const r of rows) {
      phaseMessagesMap.set(r.phaseId, (phaseMessagesMap.get(r.phaseId) ?? 0) + 1);
      if (r.hasOffense) phaseOffensesMap.set(r.phaseId, (phaseOffensesMap.get(r.phaseId) ?? 0) + 1);
      if (r.hasDesistencia) phaseDesistenciaMap.set(r.phaseId, (phaseDesistenciaMap.get(r.phaseId) ?? 0) + 1);
    }

    const allPhaseIds = new Set<number>([
      ...phaseDurationsMs.keys(),
      ...phaseMessagesMap.keys(),
    ]);
    const phaseIds = Array.from(allPhaseIds).sort((a, b) => a - b);
    const labels = phaseIds.map((p) => (p === 0 ? 'Fase 1' : `Fase ${p + 1}`));
    const avgTimesData = phaseIds.map((phaseId) => {
      const arr = phaseDurationsMs.get(phaseId) ?? [];
      if (arr.length === 0) return 0;
      const avgMs = arr.reduce((a, b) => a + b, 0) / arr.length;
      return Math.round((avgMs / (60 * 1000)) * 10) / 10;
    });
    const phaseOffenses = phaseIds.map((id) => phaseOffensesMap.get(id) ?? 0);
    const phaseDesistencia = phaseIds.map((id) => phaseDesistenciaMap.get(id) ?? 0);
    const phaseMessages = phaseIds.map((id) => phaseMessagesMap.get(id) ?? 0);

    const totalMsPerPhone = Array.from(byPhoneAll.entries()).map(([, timestamps]) =>
      timestamps.length < 2 ? 0 : Math.max(...timestamps) - Math.min(...timestamps),
    );
    const avgTotalMs =
      totalMsPerPhone.length > 0
        ? totalMsPerPhone.reduce((a, b) => a + b, 0) / totalMsPerPhone.length
        : 0;
    const avgTotalTime = Math.round((avgTotalMs / (60 * 1000)) * 10) / 10;

    return {
      labels,
      avgTimesData,
      avgTotalTime,
      phaseOffenses,
      phaseDesistencia,
      phaseMessages,
      totalInsultos: phaseOffenses.reduce((a, b) => a + b, 0),
      totalDesistencia: phaseDesistencia.reduce((a, b) => a + b, 0),
    };
  }

  /**
   * Dashboard summary: todas as métricas a partir de agent_responses (gameId, phaseId, hasOffense, hasDesistencia, createdAt).
   */
  async getDashboardSummary(params: {
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
    const [summary, jobStats] = await Promise.all([
      this.getSummaryFromAgentResponses(params),
      this.getStats(params.period),
    ]);

    const porFase = summary.labels.map((label, idx) => ({
      phaseId: `fase${idx + 1}`,
      phaseName: label,
      totalInsultos: summary.phaseOffenses[idx] ?? 0,
      totalDesistencia: summary.phaseDesistencia[idx] ?? 0,
      totalMensagens: summary.phaseMessages[idx] ?? 0,
      tempoMedioMin: summary.avgTimesData[idx],
      topWords: [] as Array<{ word: string; count: number }>,
    }));

    const fasesComMensagens = summary.phaseMessages.filter((n) => n > 0).length;
    const totalMensagens = summary.phaseMessages.reduce((a, b) => a + b, 0);
    const mediaMensagensPorFase =
      fasesComMensagens > 0 ? totalMensagens / fasesComMensagens : 0;

    return {
      jobStats,
      tempoMedioTotalMin: summary.avgTotalTime,
      totalInsultos: summary.totalInsultos,
      totalDesistencia: summary.totalDesistencia,
      mediaMensagensPorFase: Math.round(mediaMensagensPorFase * 10) / 10,
      porFase,
      period: params.period ?? undefined,
      gameId: params.gameId?.trim() || undefined,
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
