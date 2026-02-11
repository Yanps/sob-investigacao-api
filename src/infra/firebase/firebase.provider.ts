import { Provider } from '@nestjs/common';
import admin from 'firebase-admin';
import { Firestore } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

export const FIRESTORE = Symbol('FIRESTORE');

function initializeFirebaseApp(): void {
  if (admin.apps.length > 0) {
    return;
  }

  try {
    const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

    if (credentialsPath) {
      const resolvedPath = isAbsolute(credentialsPath)
        ? credentialsPath
        : join(process.cwd(), credentialsPath);

      console.log(
        `🔥 Initializing Firebase Admin with service account credentials from ${resolvedPath}...`,
      );

      const fileContents = readFileSync(resolvedPath, 'utf8');
      const serviceAccount = JSON.parse(fileContents);

      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
      });
    } else {
      console.log(
        '🔥 Initializing Firebase Admin with application default credentials (no GOOGLE_APPLICATION_CREDENTIALS set)...',
      );
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
      });
    }

    console.log('✅ Firebase Admin initialized');
  } catch (error) {
    console.error('❌ Error initializing Firebase Admin:', error);
    throw error;
  }
}

export const firebaseProvider: Provider = {
  provide: FIRESTORE,
  useFactory: (): Firestore => {
    try {
      initializeFirebaseApp();

      const firestore = admin.firestore();
      console.log('✅ Firestore instance created');
      return firestore;
    } catch (error) {
      console.error('❌ Error getting Firestore instance:', error);
      throw error;
    }
  },
};
