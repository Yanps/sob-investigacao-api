/**
 * Lista todas as collections do Firestore e os campos encontrados nos documentos.
 * Gera um JSON com collections e campos (incluindo aninhados, ex.: lastMessage.gameType).
 * Carrega .env (GOOGLE_APPLICATION_CREDENTIALS, GCLOUD_PROJECT).
 *
 * Uso: node scripts/export-firestore-schema.js
 *      node scripts/export-firestore-schema.js --out=schema.json
 */
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const SAMPLE_SIZE = 100; // documentos máximos por collection para inferir campos

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
      'Project ID não encontrado. Defina GOOGLE_APPLICATION_CREDENTIALS ou GCLOUD_PROJECT no .env.',
    );
  }
  return admin.firestore();
}

function getValueType(val) {
  if (val === null) return 'null';
  if (val instanceof Date) return 'timestamp';
  if (typeof val === 'object' && val !== null && typeof val.toDate === 'function') return 'timestamp';
  if (Array.isArray(val)) return 'array';
  if (typeof val === 'object' && val !== null && typeof val.toMillis === 'function') return 'timestamp';
  if (typeof val === 'object' && val !== null) return 'map';
  return typeof val;
}

/** Extrai todos os caminhos de campos (ex.: "lastMessage.gameType") e o tipo do valor. */
function collectFieldPaths(obj, prefix = '', out = new Map()) {
  if (obj === null || typeof obj !== 'object') return out;
  // Firestore Timestamp, GeoPoint, DocumentReference: não recursar
  if (typeof obj === 'object' && obj !== null && (obj.toDate || obj.toMillis || obj.latitude !== undefined)) {
    out.set(prefix, getValueType(obj));
    return out;
  }
  if (Array.isArray(obj)) {
    out.set(prefix, 'array');
    if (obj.length > 0 && typeof obj[0] === 'object' && obj[0] !== null && !(obj[0].toDate)) {
      collectFieldPaths(obj[0], prefix + '[]', out);
    }
    return out;
  }
  for (const key of Object.keys(obj)) {
    const fieldPath = prefix ? `${prefix}.${key}` : key;
    const val = obj[key];
    const type = getValueType(val);
    out.set(fieldPath, type);
    if (type === 'map' && val !== null && !val.toDate && !val.toMillis) {
      collectFieldPaths(val, fieldPath, out);
    }
    if (type === 'array' && val && val.length > 0 && typeof val[0] === 'object' && val[0] !== null) {
      collectFieldPaths(val[0], fieldPath + '[]', out);
    }
  }
  return out;
}

async function main() {
  const outArg = process.argv.find((a) => a.startsWith('--out='));
  const outFile = outArg ? outArg.slice('--out='.length).trim() : null;

  console.log('Conectando ao Firestore...');
  const db = initFirebase();

  const collectionIds = await db.listCollections().then((cols) => cols.map((c) => c.id));
  console.log(`Collections encontradas: ${collectionIds.length}\n`);

  const schema = { collections: {}, summary: { totalCollections: collectionIds.length } };

  for (const collId of collectionIds) {
    const snap = await db.collection(collId).limit(SAMPLE_SIZE).get();
    const fieldPathsMap = new Map(); // path -> type
    let docCount = 0;
    for (const doc of snap.docs) {
      docCount++;
      const data = doc.data();
      collectFieldPaths(data, '', fieldPathsMap);
    }
    const fields = {};
    for (const [fieldPath, type] of fieldPathsMap.entries()) {
      fields[fieldPath] = type;
    }
    const sortedKeys = Object.keys(fields).sort();
    schema.collections[collId] = {
      documentsSampled: docCount,
      fields: sortedKeys.reduce((acc, k) => {
        acc[k] = fields[k];
        return acc;
      }, {}),
    };
    console.log(`${collId}: ${docCount} doc(s), ${sortedKeys.length} campo(s)`);
  }

  const result = { schema, exportedAt: new Date().toISOString() };
  const json = JSON.stringify(result, null, 2);

  if (outFile) {
    const resolved = path.isAbsolute(outFile) ? outFile : path.join(process.cwd(), outFile);
    fs.writeFileSync(resolved, json, 'utf8');
    console.log(`\nSchema salvo em: ${resolved}`);
  } else {
    console.log('\n--- Schema (use --out=schema.json para salvar em arquivo) ---\n');
    console.log(json);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
