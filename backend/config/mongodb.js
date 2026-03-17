const mongoose = require('mongoose');

const connectDB = async () => {
  mongoose.connection.on('connected', () => {
    console.log('Database Connected');
  });

  const uri = (process.env.MONGODB_URI || '').trim();
  const dbName = process.env.DB_NAME || 'zatca_connector';

  if (!uri) {
    throw new Error('MONGODB_URI is not set in .env');
  }

  const connectionString = uri.endsWith('/') ? `${uri}${dbName}` : `${uri}/${dbName}`;
  console.log('MongoDB URI: configured');
  await mongoose.connect(connectionString);
};

module.exports = connectDB;
