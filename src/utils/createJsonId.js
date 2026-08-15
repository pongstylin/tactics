import crypto from 'node:crypto';
import { configure } from 'safe-stable-stringify';

const stringify = configure({ deterministic:true, bigint:true, strict:true, circularValue:Error });

export default obj => crypto.hash('sha256', stringify(obj), 'base64').slice(0, 22);