// Génère la clé d'accès de l'app et les clés VAPID (notifications). À lancer une seule fois.
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { writeFileSync, existsSync } from 'node:fs';
if (existsSync('.dev.vars')) { console.log('.dev.vars existe déjà, rien à faire.'); process.exit(0); }
const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwk = privateKey.export({ format: 'jwk' });
const pub = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64url');
const appKey = randomBytes(18).toString('base64url');
writeFileSync('.dev.vars', `APP_KEY=${appKey}\nVAPID_PRIVATE_JWK=${JSON.stringify(jwk)}\n`);
console.log('VAPID_PUBLIC =', pub);
