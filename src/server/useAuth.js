import crypto from 'crypto';
import express from 'express';

import config from '#config/server.js';
import ServerError from '#server/Error.js';
import services from '#server/services.js';

const PATH = config.local.path;

function parseSignedRequest(signedRequest) {
  const [ encodedSig, payload ] = signedRequest.split('.');
  const secret = config.auth.providers.facebook.client.client_secret;

  // decode the data
  const sig = urlDecode(encodedSig);
  const data = JSON.parse(atob(urlDecode(payload)));

  // confirm the signature
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payload);
  const expectedSig = hmac.digest('base64');
  if (atob(sig) !== atob(expectedSig))
    throw new ServerError(400, 'Signature mismatch');

  return data;
}

function urlDecode(input) {
  return input.replace(/-/g, '+').replace(/_/g, '/');
}

export default app => {
  if (config.auth.enabled === false)
    return;

  app.use(express.urlencoded({ extended:false }));

  /*
   * If a redirect URL is present, then repackage oauth params and pass along.
   * Otherwise, return the auth callback page to post them to the opener window.
   */
  app.get(`${PATH}/auth/callback`, (req, res, next) => {
    if (!req.query.state)
      throw new ServerError(400, 'Missing state parameter');

    try {
      const state = JSON.parse(config.auth.decryptState(req.query.state));
      const link = config.auth.encryptState(JSON.stringify(req.query));

      const redirectURL = new URL(state.redirectURL);
      redirectURL.search = (redirectURL.search ? `${redirectURL.search}&` : '') + `link=${encodeURIComponent(link)}`;
      res.redirect(redirectURL);
    } catch (e) {
      // Since encryption keys are ephemeral, we can fail to decrypt the state
      // if server is restarted after authorization started and before it ended.
      const redirectURL = new URL(`${config.origin}/online.html`);
      redirectURL.search = (redirectURL.search ? `${redirectURL.search}&` : '') + `link=failed`;
      res.redirect(redirectURL);
    }
  });

  /*
   * Facebook-related data deletion
   */
  app.post(`${PATH}/delete/facebook/callback`, (req, res, next) => {
    const signedRequest = req.body.signed_request;
    const data = parseSignedRequest(signedRequest);
    const userId = data.user_id;
    const statusUrl = `${config.origin}${PATH}/delete/facebook/status`;
    const confirmationCode = crypto.randomBytes(10).toString('hex');

    services.get('auth').unlinkAuthProvider('facebook', userId).then(() => {
      res.type('json');
      res.send(JSON.stringify({ url:statusUrl, confirmation_code:confirmationCode }));
    }).catch(error => next(error));
  });

  app.get(`${PATH}/delete/facebook/status`, (req, res, next) => {
    res.send('Facebook account unlinked.  No facebook data has been retained.');
  });
};
