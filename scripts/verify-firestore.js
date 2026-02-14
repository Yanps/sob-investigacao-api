/**
 * Script para verificar collections do Firestore usadas pelo dashboard.
 * Carrega variáveis do .env na raiz do projeto (GOOGLE_APPLICATION_CREDENTIALS, GCLOUD_PROJECT).
 *
 * Uso: node scripts/verify-firestore.js
 * (certifique-se de que .env existe com GOOGLE_APPLICATION_CREDENTIALS ou GCLOUD_PROJECT)
 */
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

function loadEnv() {
  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1).replace(/\\"/g, '"');
    if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
    if (process.env[key] == null) process.env[key] = val;
  }
}

function initFirebase() {
  loadEnv();
  if (admin.apps.length > 0) return admin.firestore();
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  let projectId =
    process.env.GCLOUD_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.FIREBASE_PROJECT;

  if (credPath) {
    const resolved = path.isAbsolute(credPath) ? credPath : path.join(process.cwd(), credPath);
    const serviceAccount = JSON.parse(fs.readFileSync(resolved, 'utf8'));
    projectId = projectId || serviceAccount.project_id;
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: projectId,
    });
  } else {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: projectId,
    });
  }

  if (!projectId) {
    throw new Error(
      'Project ID não encontrado. Defina GOOGLE_APPLICATION_CREDENTIALS (caminho para o JSON da service account, que contém project_id) ou GCLOUD_PROJECT.'
    );
  }
  return admin.firestore();
}

async function main() {
  console.log('Conectando ao Firestore...');
  const db = initFirebase();

  const result = { collections: {}, error: null };

  try {
    // 1. phase_analyses - documentos para gameId mosco
    const phaseSnap = await db.collection('phase_analyses').where('gameId', '==', 'mosco').limit(5).get();
    result.collections.phase_analyses = {
      count: phaseSnap.size,
      docIds: phaseSnap.docs.map((d) => d.id),
      sample: phaseSnap.docs.slice(0, 2).map((d) => {
        const data = d.data();
        return {
          id: d.id,
          gameId: data.gameId,
          phaseId: data.phaseId,
          phaseName: data.phaseName,
          hasAnalysisText: !!data.analysisText,
          topWordsLength: (data.topWords || []).length,
          generatedAt: data.generatedAt ? data.generatedAt.toDate?.()?.toISOString?.() : null,
        };
      }),
    };

    // 2. chats - amostra e campos de mensagens
    const chatsSnap = await db.collection('chats').limit(3).get();
    result.collections.chats = {
      sampleSize: chatsSnap.size,
      samples: chatsSnap.docs.map((d) => {
        const data = d.data();
        const lastMsg = data.lastMessage || {};
        const messages = data.messages || [];
        return {
          id: d.id,
          hasLastMessage: !!data.lastMessage,
          lastMessageGameType: lastMsg.gameType,
          lastMessagePhaseId: lastMsg.phaseId,
          lastMessagePhaseName: lastMsg.phaseName,
          messagesCount: messages.length,
          firstMessagePhaseId: messages[0]?.phaseId,
          hasDirtyWordInMessages: messages.some((m) => m.hasDirtyWord),
          hasGiveupInMessages: messages.some((m) => m.hasGiveup),
          lastUpdated: data.lastUpdated?.toDate?.()?.toISOString?.() ?? null,
        };
      }),
    };

    // 3. processing_jobs - contagem por status
    const jobsSnap = await db.collection('processing_jobs').limit(500).get();
    const byStatus = { pending: 0, processing: 0, done: 0, failed: 0 };
    jobsSnap.docs.forEach((d) => {
      const s = d.data().status || 'pending';
      if (byStatus[s] !== undefined) byStatus[s]++;
    });
    result.collections.processing_jobs = {
      sampled: jobsSnap.size,
      byStatus,
      sampleDoc: jobsSnap.docs[0]
        ? {
            id: jobsSnap.docs[0].id,
            status: jobsSnap.docs[0].data().status,
            hasStartedAt: !!jobsSnap.docs[0].data().startedAt,
            hasFinishedAt: !!jobsSnap.docs[0].data().finishedAt,
          }
        : null,
    };
  } catch (err) {
    result.error = err.message;
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
