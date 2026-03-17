const qboSession = require('../state/qboSession');

/**
 * Auth middleware: attaches realmId & oauthclient to req, ensures user is connected to QuickBooks.
 * Similar to authUser in doctor project - protects routes that need QB access.
 */
function authQbo(req, res, next) {
  try {
    const { realmId, oauthclient } = qboSession.getSession();
    req.realmId = realmId;
    req.oauthclient = oauthclient;
    if (!oauthclient || !oauthclient.isAccessTokenValid || !oauthclient.isAccessTokenValid()) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized. Please connect to QuickBooks via /auth first.',
      });
    }
    if (!realmId) {
      return res.status(401).json({
        success: false,
        message: 'Not connected to QuickBooks. Please connect via /auth first.',
      });
    }
    next();
  } catch (error) {
    console.error('authQbo error:', error);
    res.status(401).json({
      success: false,
      message: error.message || 'Unauthorized',
    });
  }
}

module.exports = authQbo;
