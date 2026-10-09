// Vérifie que notre chiffrement Web Push est déchiffrable par la lib de référence (http_ece).
import ece from 'http_ece';
import { createECDH, randomBytes } from 'node:crypto';
import { encrypt } from '../src/push.js';
const ua = createECDH('prime256v1'); ua.generateKeys();
const auth = randomBytes(16);
const sub = { p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url') };
const body = await encrypt(sub, { title: 'Test', body: 'é ok' });
const out = ece.decrypt(Buffer.from(body), { version: 'aes128gcm', privateKey: ua, dh: undefined, authSecret: auth });
const msg = JSON.parse(out.toString());
if (msg.body !== 'é ok') throw new Error('échec');
console.log('push OK', msg);
