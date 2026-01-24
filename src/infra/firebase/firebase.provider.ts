import { Provider } from '@nestjs/common';
import admin from 'firebase-admin';
import { Firestore } from 'firebase-admin/firestore';

export const FIRESTORE = Symbol('FIRESTORE');

export const firebaseProvider: Provider = {
  provide: FIRESTORE,
  useFactory: (): Firestore => {
    try {
      if (admin.apps.length === 0) {
        console.log('🔥 Initializing Firebase Admin...');
        admin.initializeApp({
          credential: admin.credential.applicationDefault(),
        });
        console.log('✅ Firebase Admin initialized');
      }

      const firestore = admin.firestore();
      console.log('✅ Firestore instance created');
      return firestore;
    } catch (error) {
      console.error('❌ Error initializing Firebase:', error);
      throw error;
    }
  },
};
