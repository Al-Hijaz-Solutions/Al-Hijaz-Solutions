require('dotenv').config();
const express = require('express');
const OAuth2Client = require('intuit-oauth');
const connectDB = require('./config/mongodb');
const cors = require('cors');

const zatcaStorage = require('./utils/zatcaStorage');

const qboSession = require('./state/qboSession');
const zatcaRouter = require('./routes/zatcaRoutes');
const qboRouter = require('./routes/qboRoutes');
const authRouter = require('./routes/authRoutes');

const oauthclient = new OAuth2Client({
  clientId: process.env.CLIENT_ID,
  clientSecret: process.env.CLIENT_SECRET,
  redirectUri: process.env.REDIRECT_URI,
  environment: process.env.ENVIRONMENT
});

const app = express();

app.use(cors());
app.use(express.json());

qboSession.setSession('', oauthclient);

app.use("/api/zatca", zatcaRouter);
app.use("/api/qbo", qboRouter);
app.use(authRouter);

app.get('/', (req, res) => {
  res.send('<h1>QBO Connector</h1><a href="/auth">Connect</a>');
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'An unexpected error occurred.' });
});

connectDB(); // connect database

module.exports = app;   // 👈 THIS IS REQUIRED FOR VERCEL
