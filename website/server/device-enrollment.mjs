import { createHmac, randomBytes, createHash } from 'node:crypto';
import { equal, uuid } from './protocol.mjs';
export const difficulty = 18;
const hash = value => createHash('sha256').update(value).digest();
const sign = (value, key) => createHmac('sha256', key).update('dmh-device-enrollment-v1:' + value).digest('base64url');
export function challenge(input, key, now = Date.now()) {
  if (!uuid(input.deviceId) || !/^[a-f0-9]{64}$/.test(input.credentialHash || '')) throw new Error('Ungültige Anfrage.');
  const data = Buffer.from(JSON.stringify({deviceId:input.deviceId,credentialHash:input.credentialHash,expires:now+300000,nonce:randomBytes(16).toString('hex')})).toString('base64url');
  return {challenge:`${data}.${sign(data,key)}`,difficulty};
}
export function validProof(input, key, now = Date.now()) {
  try {
    if (typeof input.challenge !== 'string' || input.challenge.length > 1024 || !Number.isSafeInteger(input.nonce) || input.nonce < 0 || input.nonce > 10000000) return false;
    const [data, signature, extra] = input.challenge.split('.');
    if (extra || !equal(signature || '', sign(data,key))) return false;
    const bound = JSON.parse(Buffer.from(data,'base64url').toString());
    if (bound.expires < now || bound.expires > now+300000 || bound.deviceId !== input.deviceId || bound.credentialHash !== hash(input.token).toString('hex')) return false;
    const work = hash(`${input.challenge}:${input.nonce}`);
    return work[0] === 0 && work[1] === 0 && work[2] < 64;
  } catch { return false; }
}
