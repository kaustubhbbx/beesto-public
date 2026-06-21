// FILE: src/utils/classifier.js
// ─────────────────────────────────────────────────────────────────────────────
// One cheap Groq call to decide which tools to run.
// Returns string[] e.g. ["weather", "search"] or [] for no tools.
// Always returns [] on failure — graceful degradation is the only mode.
//
// BUGS FIXED:
//   [BUG] Search tool was triggering on identity/introspective questions like
//         "which LLM are you", "are you Gemma", "what model are you" — these
//         hit /api/tools/search which returned 500, polluting the console and
//         wasting a Groq classifier call.
//   FIX:  Two-layer guard added BEFORE the Groq classifier call:
//         1. BLOCKLIST — regex patterns for introspective/greeting/casual queries
//            that should NEVER trigger any tool. Returns [] immediately.
//         2. The Groq classifier still runs for everything else, but we now
//            explicitly filter out 'search' for any query that slips through
//            if it matches introspective patterns.
// ─────────────────────────────────────────────────────────────────────────────

import { DEFAULT_KEYS } from '../constants/api';

// ── Patterns that should NEVER trigger any tool ───────────────────────────────
// Checked BEFORE the Groq classifier call — saves tokens + prevents 500s.
const TOOL_BLOCKLIST_PATTERNS = [
  // Identity / model questions
  /\b(which|what|are you|who are you|tell me about yourself)\b.*\b(llm|model|ai|gpt|gemma|gemini|claude|mistral|groq|beesto)\b/i,
  /\b(are you|is this|am i talking to)\b.*(gemma|gpt|claude|llama|gemini|ai|bot|assistant)\b/i,
  /\b(what (llm|model|ai|version) (are you|is this|do you use))\b/i,
  /\bwhich (llm|model|ai) (are you|powers you|is behind)\b/i,
  /\b(tell me (about yourself|who you are|what you are))\b/i,
  /\bwhat are (your capabilities|your features|you capable of)\b/i,
  /\b(who (made|created|built|trained) you)\b/i,
  /\byou (powered by|based on|trained on|built on|made by|created by)\b/i,

  // Pure greetings — never need tools
  /^(hi|hey|hello|yo|sup|howdy|hiya|greetings|good (morning|afternoon|evening|night))[\s!?.]*$/i,

  // Casual / opinion questions — never need real-time data
  /^(what do you think|your opinion|do you like|can you help|how are you|what'?s up)[\s?]*/i,
  /^(thanks?|thank you|thx|cheers|great|awesome|nice|cool|ok|okay|sure|got it|sounds good)[\s!.]*$/i,

  // Capability questions
  /\b(can you|do you|are you able to|what can you)\b/i,
];

// ── Check if a message matches the blocklist ──────────────────────────────────
function isBlocklisted(message) {
  const trimmed = message.trim();
  return TOOL_BLOCKLIST_PATTERNS.some(pattern => pattern.test(trimmed));
}

const CLASSIFIER_SYSTEM = `You are a strict tool selector for an AI assistant.
Given a user message, decide which real-time tools are needed to answer it.

Available tools:
- weather: user asks about weather, temperature, rain, forecast, humidity
- math: user wants arithmetic, a calculation, equation solved (must have numbers)
- search: user asks about external facts, companies, events, places, products — NOT about the AI itself
- news: user asks for latest news, recent headlines
- image: CRITICAL - user asks to generate, create, draw, paint, or imagine a picture, artwork, or photo of ANYTHING.

Rules:
- Return ONLY a JSON array of tool names. Example: ["weather"] or ["image"]
- Return [] for: casual chat, coding help, creative writing, opinions, questions ABOUT THE AI ITSELF.
- ABSOLUTE RULE: Never use "search" for questions about which AI you are, your capabilities, or who made you.
- ABSOLUTE RULE: If the user says "draw a...", "generate an image...", "paint...", or "create a picture...", you MUST return ["image"].
- Never return more than 2 tools.
- Output ONLY the JSON array — no markdown blocks, no text, no explanation.`;

export async function classifyTools(message, groqApiKey) {
  const key = groqApiKey || DEFAULT_KEYS.groq;
  if (!key) return [];

  // ── Layer 1: Blocklist guard — skip Groq call entirely ───────────────────
  if (isBlocklisted(message)) {
    console.log('[Classifier] Blocklisted — skipping tool classification:', message.slice(0, 60));
    return [];
  }

  // ── Layer 2: Groq classifier ──────────────────────────────────────────────
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model:       'llama-3.1-8b-instant',
        max_tokens:  30,
        temperature: 0,
        messages: [
          { role: 'system', content: CLASSIFIER_SYSTEM },
          { role: 'user',   content: message.slice(0, 500) },
        ],
      }),
    });

    if (!res.ok) return [];

    const data  = await res.json();
    const text  = data.choices?.[0]?.message?.content?.trim() || '[]';
    const clean = text.replace(/```json|```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch {
      // Try to extract array from any surrounding text
      const match = clean.match(/\[.*?\]/s);
      parsed = match ? JSON.parse(match[0]) : [];
    }

    if (!Array.isArray(parsed)) return [];

    const VALID = ['weather', 'math', 'search', 'news', 'image'];
    const filtered = parsed.filter(t => VALID.includes(t));

    // ── Layer 3: Post-filter — never search for AI identity questions ─────
    // Secondary guard in case the 8B model ignores the system prompt rule.
    const IDENTITY_PATTERNS = [
      /\b(which|what|are you|who are you)\b.*\b(llm|model|ai|gemma|gemini|claude)\b/i,
      /\b(are you|am i talking to)\b.*(ai|bot|gemma|llm)\b/i,
    ];
    const isIdentityQuery = IDENTITY_PATTERNS.some(p => p.test(message));
    if (isIdentityQuery) {
      return filtered.filter(t => t !== 'search');
    }

    return filtered;
  } catch (err) {
    console.warn('[Classifier] Failed:', err.message);
    return [];
  }
}