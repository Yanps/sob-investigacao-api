import {
  Injectable,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Firestore } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import * as bcrypt from 'bcryptjs';
import { FIRESTORE } from '../infra/firebase/firebase.provider';

const COLLECTION = 'dashboard_users';
const SALT_ROUNDS = 10;
const PLACEHOLDER_HASH = 'placeholder';

@Injectable()
export class AuthService {
  constructor(
    @Inject(FIRESTORE)
    private readonly firestore: Firestore,
    private readonly jwtService: JwtService,
  ) {}

  private normalizeEmail(email: string): string {
    return String(email).trim().toLowerCase();
  }

  async login(
    email: string,
    password: string,
  ): Promise<{ access_token: string; user: { id: string; email: string; name: string; role: string } }> {
    const normalized = this.normalizeEmail(email);
    if (!normalized || !password) {
      throw new UnauthorizedException('Email e senha são obrigatórios.');
    }

    const snapshot = await this.firestore
      .collection(COLLECTION)
      .where('email', '==', normalized)
      .limit(1)
      .get();

    if (snapshot.empty) {
      throw new UnauthorizedException('Credenciais inválidas.');
    }

    const doc = snapshot.docs[0]!;
    const data = doc.data();
    const passwordHash = data['passwordHash'] as string;

    if (!passwordHash || passwordHash === PLACEHOLDER_HASH) {
      throw new UnauthorizedException(
        'Senha ainda não definida. Use o endpoint de definição de senha (com API Key) ou peça a um administrador.',
      );
    }

    const match = await bcrypt.compare(password, passwordHash);
    if (!match) {
      throw new UnauthorizedException('Credenciais inválidas.');
    }

    const payload = {
      sub: doc.id,
      email: data['email'] as string,
      role: (data['role'] as string) ?? 'admin',
    };
    const access_token = this.jwtService.sign(payload);

    return {
      access_token,
      user: {
        id: doc.id,
        email: data['email'] as string,
        name: (data['name'] as string) ?? '',
        role: (data['role'] as string) ?? 'admin',
      },
    };
  }

  async setPassword(email: string, newPassword: string): Promise<{ success: boolean; message: string }> {
    const normalized = this.normalizeEmail(email);
    if (!normalized || !newPassword || newPassword.length < 6) {
      throw new BadRequestException('Email e nova senha (mín. 6 caracteres) são obrigatórios.');
    }

    const snapshot = await this.firestore
      .collection(COLLECTION)
      .where('email', '==', normalized)
      .limit(1)
      .get();

    if (snapshot.empty) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    const doc = snapshot.docs[0]!;
    const hash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await doc.ref.update({
      passwordHash: hash,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {
      success: true,
      message: 'Senha definida com sucesso. Faça login com o novo password.',
    };
  }
}
