import { Inject, Injectable } from '@nestjs/common';
import { Firestore } from 'firebase-admin/firestore';
import { FIRESTORE } from '../infra/firebase/firebase.provider';

@Injectable()
export class UsersService {
  constructor(
    @Inject(FIRESTORE)
    private readonly db: Firestore,
  ) {}

  async findById(userId: string) {
    const snap = await this.db.collection('users').doc(userId).get();
    return snap.exists ? snap.data() : null;
  }
}
