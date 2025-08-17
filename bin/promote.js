import '#plugins/index.js';
import IdentityToken from '#server/IdentityToken.js';

const apiRoot = process.argv[2];
const playerId = process.argv[3];
const token = IdentityToken.create({
  subject: playerId,
  expiresIn: 60,
  admin: true,
});

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const rsp = await fetch(`${apiRoot}/promote`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
  },
});

console.log(rsp.status, rsp.statusText, await rsp.json());
