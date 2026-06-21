// routes/chats.js
// All routes protected by Clerk — uses req.clerkUserId set by requireAuth middleware.

const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const Chat = require('../models/Chat');

function toFrontend(chat) {
  return {
    id:        chat.frontendId,
    title:     chat.title,
    messages:  chat.messages,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
  };
}

// GET /api/chats — all chats for the signed-in user, newest first
router.get('/', requireAuth, async (req, res) => {
  try {
    const chats = await Chat
      .find({ userId: req.clerkUserId })
      .sort({ updatedAt: -1 })
      .lean();
    res.json(chats.map(toFrontend));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/chats — create or upsert a chat
router.post('/', requireAuth, async (req, res) => {
  try {
    const { id, title, messages, createdAt, updatedAt } = req.body;
    if (!id) return res.status(400).json({ error: 'Chat id is required' });

    const chat = await Chat.findOneAndUpdate(
      { frontendId: id, userId: req.clerkUserId },
      { frontendId: id, userId: req.clerkUserId, title, messages: messages || [], createdAt, updatedAt },
      { upsert: true, new: true }
    );
    res.status(201).json(toFrontend(chat));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/chats/:id — update title and/or messages
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const { title, messages, updatedAt } = req.body;
    const chat = await Chat.findOneAndUpdate(
      { frontendId: req.params.id, userId: req.clerkUserId },
      {
        ...(title    !== undefined && { title }),
        ...(messages !== undefined && { messages }),
        updatedAt: updatedAt || Date.now(),
      },
      { new: true }
    );
    if (!chat) return res.status(404).json({ error: 'Chat not found' });
    res.json(toFrontend(chat));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/chats/:id — delete a single chat
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const result = await Chat.findOneAndDelete({
      frontendId: req.params.id,
      userId:     req.clerkUserId,
    });
    if (!result) return res.status(404).json({ error: 'Chat not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/chats — delete ALL chats for this user
router.delete('/', requireAuth, async (req, res) => {
  try {
    const result = await Chat.deleteMany({ userId: req.clerkUserId });
    res.json({ ok: true, deleted: result.deletedCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
