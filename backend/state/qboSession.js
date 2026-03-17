/**
 * Shared QBO session state - realmId and oauthclient.
 * Set by server.js on auth callback/signout; read by authQbo middleware.
 */
let _realmId = '';
let _oauthclient = null;

function setSession(realmId, oauthclient) {
  _realmId = realmId || '';
  _oauthclient = oauthclient;
}

function getSession() {
  return { realmId: _realmId, oauthclient: _oauthclient };
}

module.exports = { setSession, getSession };
