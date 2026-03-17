require('dotenv').config();
const express = require('express');
const OAuth2Client = require('intuit-oauth');
const path = require('path');
const connectDB = require('./config/mongodb');
const zatcaStorage = require('./utils/zatcaStorage');

const oauthclient = new OAuth2Client({
    clientId: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    redirectUri: process.env.REDIRECT_URI,
    environment: process.env.ENVIRONMENT
});

const app = express();

const cors = require('cors');

app.use(cors());
app.use(express.json());
const port = process.env.PORT || 3000;


const qboSession = require('./state/qboSession');
const zatcaRouter = require('./routes/zatcaRoutes');
const qboRouter = require('./routes/qboRoutes');
const authRouter = require('./routes/authRoutes');

qboSession.setSession('', oauthclient);

app.use("/api/zatca", zatcaRouter);
app.use("/api/qbo", qboRouter);
app.use(authRouter);

app.get('/', (req, res) => {
    res.send('<h1>QBO Connector</h1><a href="/auth">Connect</a> | <a href="/invoices">Invoices</a>');
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'An unexpected error occurred.' });
});

async function start() {
  try {
    await connectDB();
    const server = app.listen(port, () => {
    console.log(`Server started on http://localhost:${port}`);
});
    const shutdown = async () => {
      console.log('Shutting down...');
      await zatcaStorage.closeConnection();
      server.close(() => process.exit(0));
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();