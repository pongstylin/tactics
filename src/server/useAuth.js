import config from 'config/server.js';
import ServerError from 'server/Error.js';

const PATH = config.local.path;

export default app => {
  if (config.auth.enabled === false)
    return;

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
};
