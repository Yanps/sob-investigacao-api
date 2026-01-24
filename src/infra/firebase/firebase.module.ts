import { Module, Global } from '@nestjs/common';
import { firebaseProvider, FIRESTORE } from './firebase.provider';

@Global()
@Module({
  providers: [firebaseProvider],
  exports: [firebaseProvider, FIRESTORE],
})
export class FirebaseModule {}
