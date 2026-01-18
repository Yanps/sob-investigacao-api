import { Global, Module } from '@nestjs/common';
import { firebaseProvider } from './firebase.provider';

@Global()
@Module({
  providers: [firebaseProvider],
  exports: [firebaseProvider],
})
export class FirebaseModule {}
