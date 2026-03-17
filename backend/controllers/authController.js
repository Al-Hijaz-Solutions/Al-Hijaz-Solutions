/**
 * Auth Controller - Handles OAuth and session.
 * Uses oauthclient from qboSession (set by server.js at startup).
 */

const OAuth2Client = require('intuit-oauth');
const qboSession = require('../state/qboSession');

function getOAuthClient() {
  return qboSession.getSession().oauthclient;
}

/**
 * GET /auth - Redirect to QuickBooks OAuth consent (Protected by Option A: Access Code)
 */
function getAuth(req, res) {
  const accessCodesStr = process.env.ACCESS_CODES;
  if (accessCodesStr && accessCodesStr.trim() !== '') {
    const validCodes = accessCodesStr.split(',').map(c => c.trim());
    const providedCode = req.query.accessCode;
    if (!providedCode || !validCodes.includes(providedCode)) {
      return res.status(401).send('Invalid or missing Access Code. Cannot proceed to QuickBooks authorization.');
    }
  }
  const authUrl = getOAuthClient().authorizeUri({
    scope: [OAuth2Client.scopes.Accounting, OAuth2Client.scopes.OpenId],
    state: 'Init'
  });
  res.redirect(authUrl);
}

/**
 * GET /callback - OAuth callback, exchange code for token
 */
async function callback(req, res) {
  try {
    const oauthclient = getOAuthClient();
    const authResponse = await oauthclient.createToken(req.url);
    const realmId = req.query.realmId || (authResponse.token && authResponse.token.realmId);

    // Option B: Realm ID Lock
    const allowedRealmIdsStr = process.env.ALLOWED_REALM_IDS;
    if (allowedRealmIdsStr && allowedRealmIdsStr.trim() !== '') {
      const allowedRealmIds = allowedRealmIdsStr.split(',').map(id => id.trim());
      if (!allowedRealmIds.includes(realmId)) {
        console.error(`Unauthorized Realm ID attempt: ${realmId}. Allowed: ${allowedRealmIds}`);
        oauthclient.token.setToken({}); // Clear the token locally immediately
        qboSession.setSession('', oauthclient);
        return res.status(403).send('Access Denied. Nice try Diddy!');
      }
    }

    qboSession.setSession(realmId, oauthclient);

    console.log('--- Authorization Successful ---');
    console.log('Realm ID:', realmId);

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}/?auth=success`);
  } catch (e) {
    console.error('Callback Error:', e);
    res.status(500).send('Authentication failed. Please try again.');
  }
}

/**
 * GET /signout - Clear token and session
 */
function signout(req, res) {
  const oauthclient = getOAuthClient();
  oauthclient.token.setToken({});
  qboSession.setSession('', oauthclient);
  console.log('--- User Signed Out ---');
  res.json({ success: true });
}

/**
 * GET /auth-status - Current auth state
 */
function authStatus(req, res) {
  const isValid = getOAuthClient().isAccessTokenValid();
  const { realmId } = qboSession.getSession();
  console.log(`--- Auth Status Check --- Authorized: ${isValid}, RealmID: ${realmId}`);
  res.json({
    authorized: isValid,
    realmId: realmId || ''
  });
}

/**
 * POST /verify-access - Validate the access code without redirecting
 */
function verifyAccess(req, res) {
  const accessCodesStr = process.env.ACCESS_CODES;
  if (accessCodesStr && accessCodesStr.trim() !== '') {
    const validCodes = accessCodesStr.split(',').map(c => c.trim());
    const providedCode = req.body.accessCode;
    if (!providedCode || !validCodes.includes(providedCode)) {
      return res.status(401).json({ success: false, message: 'Invalid or missing Access Code' });
    }
  }
  return res.json({ success: true });
}

module.exports = {
  getAuth,
  callback,
  signout,
  authStatus,
  verifyAccess
};
