import { Provider } from '@nestjs/common';
import admin, { ServiceAccount } from 'firebase-admin';

export const FIRESTORE = Symbol('FIRESTORE');

export const firebaseProvider: Provider = {
  provide: FIRESTORE,
  useFactory: () => {
    if (admin.apps.length === 0) {
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
      });
    }

    return admin.firestore();
  },
};
