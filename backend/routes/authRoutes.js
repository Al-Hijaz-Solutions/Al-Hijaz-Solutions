const express = require('express');
const { getAuth, callback, signout, authStatus, verifyAccess } = require('../controllers/authController');

const authRouter = express.Router();

authRouter.get('/auth', getAuth);
authRouter.post('/verify-access', verifyAccess);
authRouter.get('/callback', callback);
authRouter.get('/signout', signout);
authRouter.get('/auth-status', authStatus);

module.exports = authRouter;
