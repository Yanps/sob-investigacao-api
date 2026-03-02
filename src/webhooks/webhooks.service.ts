import { Injectable } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { Firestore } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import { FIRESTORE } from '../infra/firebase/firebase.provider';
import type {
  ShopifyOrderPayload,
  ShopifyCustomerPayload,
} from '../shared/types/shopify.types';

const YAMPI_NOTE_PREFIX = 'Pedido Yampi';

function normalizePhone(
  rawPhone: string | null | undefined,
): { phoneNumber: string; phoneNumberAlt: string } | null {
  if (rawPhone == null || rawPhone === '') return null;
  const digits = String(rawPhone).replace(/\D/g, '');
  if (digits.length === 0) return null;
  let phone = digits;
  const hasPlus = String(rawPhone).trim().startsWith('+');
  if (!hasPlus && (phone.length === 10 || phone.length === 11)) {
    phone = '55' + phone;
  }
  let phoneNumberAlt = phone;
  if (phone.length === 13 && phone.startsWith('55')) {
    phoneNumberAlt = phone.slice(0, 4) + phone.slice(5);
  } else if (phone.length === 12 && phone.startsWith('55')) {
    phoneNumberAlt = phone.slice(0, 4) + '9' + phone.slice(4);
  }
  return { phoneNumber: phone, phoneNumberAlt };
}

function extractPhoneFromOrder(
  payload: ShopifyOrderPayload,
): { phoneNumber: string; phoneNumberAlt: string } | null {
  let raw: string | null =
    payload.customer?.phone ??
    payload.billing_address?.phone ??
    payload.customer?.default_address?.phone ??
    payload.phone ??
    null;
  if (!raw && payload.note_attributes?.length) {
    const phoneAttr = payload.note_attributes.find(
      (a) =>
        a.name.toLowerCase().includes('phone') || a.value.includes('55'),
    );
    if (phoneAttr) {
      const match = phoneAttr.value.match(/(?:55\d{11,12})/);
      if (match) raw = match[0];
    }
  }
  return normalizePhone(raw);
}

function extractNameFromOrder(payload: ShopifyOrderPayload): string {
  const c = payload.customer;
  if (c?.first_name || c?.last_name) {
    return [c.first_name, c.last_name].filter(Boolean).join(' ').trim();
  }
  return 'Cliente';
}

function extractCpfFromOrder(payload: ShopifyOrderPayload): string | null {
  return payload.billing_address?.company ?? null;
}

@Injectable()
export class WebhooksService {
  constructor(
    @Inject(FIRESTORE)
    private readonly firestore: Firestore,
  ) {}

  private async logWebhook(
    topic: string,
    payloadSummary: Record<string, unknown>,
    status: 'success' | 'error',
    error?: string,
  ): Promise<void> {
    await this.firestore.collection('webhook_logs').add({
      source: 'shopify',
      topic,
      payload: payloadSummary,
      status,
      ...(error && { error }),
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  async handleOrderCreated(payload: ShopifyOrderPayload): Promise<void> {
    console.log(`[Service] 🔄 Iniciando processamento handleOrderCreated - Order ID: ${payload.id}`);

    if (payload.note?.startsWith(YAMPI_NOTE_PREFIX)) {
      console.log(`[Service] ⏭️  Ignorando pedido Yampi - Order ID: ${payload.id}`);
      await this.logWebhook(
        'order-created',
        { skipped: true, reason: 'Pedido Yampi' },
        'success',
      );
      return;
    }

    const email = (payload.email ?? payload.contact_email ?? '').toLowerCase();
    if (!email) {
      console.error(`[Service] ❌ Email ausente - Order ID: ${payload.id}`);
      await this.logWebhook(
        'order-created',
        { orderId: payload.id },
        'error',
        'Email ausente',
      );
      return;
    }
    console.log(`[Service] 📧 Email extraído: ${email}`);

    const phoneData = extractPhoneFromOrder(payload);
    const name = extractNameFromOrder(payload);
    const cpf = extractCpfFromOrder(payload);
    const products =
      payload.line_items?.map((i) => i.title ?? i.name ?? '') ?? [];
    const createdAt = payload.created_at;

    console.log(`[Service] 📱 Telefone: ${phoneData?.phoneNumber || 'não encontrado'}`);
    console.log(`[Service] 👤 Nome: ${name}`);
    console.log(`[Service] 🛍️  Produtos: ${products.length} item(ns)`);

    const customerRef = this.firestore.collection('customers').doc(email);
    const customerSnap = await customerRef.get();

    if (!customerSnap.exists) {
      console.log(`[Service] 👤 Cliente não existe, criando novo: ${email}`);
      if (!phoneData) {
        console.error(`[Service] ❌ Telefone ausente para criar customer - Order ID: ${payload.id}`);
        await this.logWebhook(
          'order-created',
          { orderId: payload.id, email },
          'error',
          'Telefone ausente para criar customer',
        );
        return;
      }
      await customerRef.set({
        email,
        phoneNumber: phoneData.phoneNumber,
        phoneNumberAlt: phoneData.phoneNumberAlt,
        name,
        cpf: cpf ?? null,
        twoFactorAuth: 'empty',
        twoFactorTimestamp: createdAt,
        aiMessages: 1,
        createdAt: createdAt ?? FieldValue.serverTimestamp(),
      });
      console.log(`[Service] ✅ Cliente criado: ${email}`);
    } else {
      console.log(`[Service] ✅ Cliente já existe: ${email}`);
    }

    console.log(`[Service] 💳 Status financeiro: ${payload.financial_status}`);
    if (payload.financial_status !== 'paid') {
      console.log(`[Service] ⏱️  Pedido não pago, aguardando pagamento - Order ID: ${payload.id}`);
      await this.logWebhook(
        'order-created',
        {
          orderId: payload.id,
          email,
          financial_status: payload.financial_status,
        },
        'success',
      );
      return;
    }

    if (!phoneData) {
      console.error(`[Service] ❌ Telefone ausente para criar order - Order ID: ${payload.id}`);
      await this.logWebhook(
        'order-created',
        { orderId: payload.id, email },
        'error',
        'Telefone ausente para criar order',
      );
      return;
    }

    const orderRef = this.firestore.collection('orders').doc(String(payload.id));
    await orderRef.set({
      orderId: payload.id,
      email,
      phoneNumber: phoneData.phoneNumber,
      phoneNumberAlt: phoneData.phoneNumberAlt,
      name,
      cpf: cpf ?? null,
      products,
      createdAt: createdAt ?? FieldValue.serverTimestamp(),
    });
    console.log(`[Service] 📦 Pedido criado no Firestore - Order ID: ${payload.id}`);

    await this.logWebhook(
      'order-created',
      { orderId: payload.id, email, status: 'paid' },
      'success',
    );
    console.log(`[Service] ✅ handleOrderCreated finalizado com sucesso - Order ID: ${payload.id}`);
  }

  async handleOrderApproved(payload: ShopifyOrderPayload): Promise<void> {
    console.log(`[Service] 🔄 Iniciando processamento handleOrderApproved - Order ID: ${payload.id}`);

    const email = (payload.email ?? payload.contact_email ?? '').toLowerCase();
    if (!email) {
      console.error(`[Service] ❌ Email ausente - Order ID: ${payload.id}`);
      await this.logWebhook(
        'order-approved',
        { orderId: payload.id },
        'error',
        'Email ausente',
      );
      return;
    }
    console.log(`[Service] 📧 Email extraído: ${email}`);

    const phoneData = extractPhoneFromOrder(payload);
    if (!phoneData) {
      console.error(`[Service] ❌ Telefone ausente - Order ID: ${payload.id}`);
      await this.logWebhook(
        'order-approved',
        { orderId: payload.id, email },
        'error',
        'Telefone ausente',
      );
      return;
    }
    console.log(`[Service] 📱 Telefone: ${phoneData.phoneNumber}`);

    const name = extractNameFromOrder(payload);
    const cpf = extractCpfFromOrder(payload);
    const products =
      payload.line_items?.map((i) => i.title ?? i.name ?? '') ?? [];
    const createdAt = payload.created_at;

    console.log(`[Service] 👤 Nome: ${name}`);
    console.log(`[Service] 🛍️  Produtos: ${products.length} item(ns)`);

    const orderRef = this.firestore.collection('orders').doc(String(payload.id));
    const snap = await orderRef.get();

    if (snap.exists) {
      console.log(`[Service] ✅ Pedido existe, atualizando com approvedAt - Order ID: ${payload.id}`);
      // Order já existe, atualiza com status de aprovação
      await orderRef.update({
        name,
        cpf: cpf ?? null,
        products,
        approvedAt: payload.updated_at ?? FieldValue.serverTimestamp(),
      });
    } else {
      console.log(`[Service] 📦 Pedido não existe, criando novo com approvedAt - Order ID: ${payload.id}`);
      // Cria a ordem se não existir
      await orderRef.set({
        orderId: payload.id,
        email,
        phoneNumber: phoneData.phoneNumber,
        phoneNumberAlt: phoneData.phoneNumberAlt,
        name,
        cpf: cpf ?? null,
        products,
        createdAt: createdAt ?? FieldValue.serverTimestamp(),
        approvedAt: payload.updated_at ?? FieldValue.serverTimestamp(),
      });
    }

    await this.logWebhook(
      'order-approved',
      { orderId: payload.id, email },
      'success',
    );
    console.log(`[Service] ✅ handleOrderApproved finalizado com sucesso - Order ID: ${payload.id}`);
  }

  async handleOrderCancelled(payload: { id: number }): Promise<void> {
    console.log(`[Service] 🔄 Iniciando processamento handleOrderCancelled - Order ID: ${payload.id}`);

    const orderRef = this.firestore.collection('orders').doc(String(payload.id));
    const snap = await orderRef.get();
    if (snap.exists) {
      console.log(`[Service] 🗑️  Deletando pedido - Order ID: ${payload.id}`);
      await orderRef.delete();
      console.log(`[Service] ✅ Pedido deletado - Order ID: ${payload.id}`);
    } else {
      console.log(`[Service] ℹ️  Pedido não existe para deletar - Order ID: ${payload.id}`);
    }
    await this.logWebhook('order-cancelled', { orderId: payload.id }, 'success');
    console.log(`[Service] ✅ handleOrderCancelled finalizado - Order ID: ${payload.id}`);
  }

  async handleOrderUpdated(payload: ShopifyOrderPayload): Promise<void> {
    console.log(`[Service] 🔄 Iniciando processamento handleOrderUpdated - Order ID: ${payload.id}`);

    const orderRef = this.firestore.collection('orders').doc(String(payload.id));
    const snap = await orderRef.get();
    if (!snap.exists) {
      console.log(`[Service] ℹ️  Pedido não existe, nada a atualizar - Order ID: ${payload.id}`);
      await this.logWebhook('order-updated', { orderId: payload.id }, 'success');
      return;
    }

    const phoneData = extractPhoneFromOrder(payload);
    const name = extractNameFromOrder(payload);
    const cpf = extractCpfFromOrder(payload);
    const products =
      payload.line_items?.map((i) => i.title ?? i.name ?? '') ?? [];
    const updates: Record<string, unknown> = {
      name,
      cpf: cpf ?? null,
      products,
      updatedAt: payload.updated_at ?? FieldValue.serverTimestamp(),
    };
    if (phoneData) {
      updates.phoneNumber = phoneData.phoneNumber;
      updates.phoneNumberAlt = phoneData.phoneNumberAlt;
      console.log(`[Service] 📱 Telefone atualizado: ${phoneData.phoneNumber}`);
    }
    const email = (payload.email ?? payload.contact_email ?? '').toLowerCase();
    if (email) {
      updates.email = email;
      console.log(`[Service] 📧 Email atualizado: ${email}`);
    }

    console.log(`[Service] 📝 Atualizando pedido no Firestore - Order ID: ${payload.id}`);
    await orderRef.update(updates);
    await this.logWebhook('order-updated', { orderId: payload.id }, 'success');
    console.log(`[Service] ✅ handleOrderUpdated finalizado com sucesso - Order ID: ${payload.id}`);
  }

  async handleCustomerUpdated(
    payload: ShopifyCustomerPayload,
  ): Promise<void> {
    console.log(`[Service] 🔄 Iniciando processamento handleCustomerUpdated - Customer ID: ${payload.id}`);

    const rawPhone =
      payload.phone ?? payload.default_address?.phone ?? null;
    if (!rawPhone) {
      console.log(`[Service] ℹ️  Nenhum telefone encontrado - Customer ID: ${payload.id}`);
      await this.logWebhook(
        'customer-updated',
        { customerId: payload.id },
        'success',
      );
      return;
    }
    console.log(`[Service] 📱 Telefone bruto extraído: ${rawPhone}`);

    const phoneData = normalizePhone(rawPhone);
    if (!phoneData) {
      console.log(`[Service] ⚠️  Telefone inválido - Customer ID: ${payload.id}`);
      await this.logWebhook(
        'customer-updated',
        { customerId: payload.id },
        'success',
      );
      return;
    }
    console.log(`[Service] 📱 Telefone normalizado: ${phoneData.phoneNumber}`);

    const email = (payload.email ?? '').toLowerCase();
    if (!email) {
      console.error(`[Service] ❌ Email ausente - Customer ID: ${payload.id}`);
      await this.logWebhook(
        'customer-updated',
        { customerId: payload.id },
        'error',
        'Email ausente',
      );
      return;
    }
    console.log(`[Service] 📧 Email: ${email}`);

    const name =
      payload.first_name || payload.last_name
        ? [payload.first_name, payload.last_name]
            .filter(Boolean)
            .join(' ')
            .trim()
        : payload.default_address
          ? [
              payload.default_address.first_name,
              payload.default_address.last_name,
            ]
              .filter(Boolean)
              .join(' ')
              .trim()
          : 'Cliente';
    console.log(`[Service] 👤 Nome: ${name}`);

    const customerByEmailRef = this.firestore.collection('customers').doc(email);
    const customerByEmailSnap = await customerByEmailRef.get();

    if (customerByEmailSnap.exists) {
      console.log(`[Service] ✅ Cliente já existe por email - Email: ${email}`);
      await this.logWebhook(
        'customer-updated',
        { email, customerId: payload.id },
        'success',
      );
      return;
    }
    console.log(`[Service] 🔍 Cliente não existe por email, buscando por telefone`);

    const customersByPhoneSnap = await this.firestore
      .collection('customers')
      .where('phoneNumber', '==', phoneData.phoneNumber)
      .limit(1)
      .get();

    const altSnap = await this.firestore
      .collection('customers')
      .where('phoneNumberAlt', '==', phoneData.phoneNumber)
      .limit(1)
      .get();

    const existingDoc =
      customersByPhoneSnap.docs[0] ?? altSnap.docs[0];
    if (!existingDoc) {
      console.log(`[Service] 👤 Cliente não existe, criando novo - Email: ${email}`);
      await customerByEmailRef.set({
        email,
        phoneNumber: phoneData.phoneNumber,
        phoneNumberAlt: phoneData.phoneNumberAlt,
        name,
        cpf: null,
        twoFactorAuth: 'empty',
        aiMessages: 0,
        createdAt: FieldValue.serverTimestamp(),
      });
      console.log(`[Service] ✅ Cliente criado - Email: ${email}`);
      await this.logWebhook(
        'customer-updated',
        { email, customerId: payload.id, created: true },
        'success',
      );
      return;
    }

    console.log(`[Service] 🔄 Cliente encontrado por telefone, consolidando registros`);
    const oldData = existingDoc.data();
    const newDoc = {
      email,
      phoneNumber: phoneData.phoneNumber,
      phoneNumberAlt: phoneData.phoneNumberAlt,
      name,
      cpf: (oldData?.cpf as string) ?? null,
      twoFactorAuth: (oldData?.twoFactorAuth as string) ?? 'empty',
      twoFactorTimestamp: oldData?.twoFactorTimestamp ?? null,
      aiMessages: (oldData?.aiMessages as number) ?? 0,
      createdAt: oldData?.createdAt ?? FieldValue.serverTimestamp(),
    };
    await customerByEmailRef.set(newDoc);
    console.log(`[Service] 📝 Cliente atualizado com novo email - Email: ${email}`);

    await this.firestore.collection('customers').doc(existingDoc.id).delete();
    console.log(`[Service] 🗑️  Cliente antigo deletado - Doc ID: ${existingDoc.id}`);

    const ordersSnap = await this.firestore
      .collection('orders')
      .where('phoneNumber', '==', phoneData.phoneNumber)
      .get();
    const ordersAltSnap = await this.firestore
      .collection('orders')
      .where('phoneNumberAlt', '==', phoneData.phoneNumber)
      .get();

    console.log(`[Service] 📦 Atualizando ${ordersSnap.docs.length + ordersAltSnap.docs.length} pedido(s)`);

    const batch = this.firestore.batch();
    for (const doc of ordersSnap.docs) {
      batch.update(doc.ref, { email });
    }
    for (const doc of ordersAltSnap.docs) {
      batch.update(doc.ref, { email });
    }
    await batch.commit();
    console.log(`[Service] ✅ Pedidos atualizados com novo email`);

    await this.logWebhook(
      'customer-updated',
      {
        email,
        oldDocId: existingDoc.id,
        customerId: payload.id,
      },
      'success',
    );
    console.log(`[Service] ✅ handleCustomerUpdated finalizado com sucesso - Email: ${email}`);
  }
}
