// server.js — Beesto AI backend (Clerk auth edition)
require('dotenv').config();

const express   = require('express');
const cors      = require('cors');
const connectDB = require('./config/db');
const { installClerkMiddleware, requireAuth } = require('./middleware/auth');
const cohereRoutes = require('./routes/cohere');
const deepResearchRoutes = require('./routes/deepResearch'); // 👈 ADDED

const app = express();

connectDB();

const allowedOrigins = ['https://beesto.online'];
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (
      origin.startsWith('http://localhost:') || 
      origin.startsWith('http://127.0.0.1:') || 
      origin === 'http://localhost' || 
      origin === 'http://127.0.0.1' ||
      (process.env.FRONTEND_URL && origin === process.env.FRONTEND_URL) ||
      allowedOrigins.includes(origin)
    ) {
      return callback(null, true);
    }
    return callback(new Error('Blocked by CORS policy'));
  },
  credentials: true,
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use(installClerkMiddleware);

app.use('/api/chats',    require('./routes/chats'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/user',     require('./routes/user'));
app.use('/api/cohere',   cohereRoutes);
app.use('/api/tools',    require('./routes/tools'));
app.use('/api/deep-research', deepResearchRoutes); // 👈 ADDED
app.use('/api/images',   require('./routes/images'));
app.use('/api/shared-previews', require('./routes/sharedPreviews'));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString(), env: process.env.NODE_ENV });
});

app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🐝 Beesto AI server running on http://localhost:${PORT}`);
});