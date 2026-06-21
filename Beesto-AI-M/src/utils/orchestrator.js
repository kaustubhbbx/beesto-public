// FILE: src/utils/orchestrator.js
// ─────────────────────────────────────────────────────────────────────────────
// Beesto AI — Re-purposed Orchestrator Model
//
// Direct streaming chat and tool-calling model featuring an always-on reasoner.
// Fallback Chain:
//   1. Google Gemma 4 (gemma-4-31b-it) [Primary]
//   2. Groq Qwen 32B (qwen/qwen3-32b)
//   3. Groq GPT-OSS 120B (openai/gpt-oss-120b)
//   4. Google Gemini 3.1 Flash Lite (gemini-3.1-flash-lite)
// ─────────────────────────────────────────────────────────────────────────────

import { GoogleGenAI } from '@google/genai';
import { DEFAULT_KEYS } from '../constants/api';

// ── Hardcore system prompt for always-on reasoning ───────────────────────────
const REASONER_SYSTEM_PROMPT = `You are Beesto, a premium AI assistant with an always-on advanced reasoning engine.

CRITICAL BEHAVIOR:
1. You MUST first output your step-by-step thinking process.
2. This thinking process MUST be wrapped entirely inside <think> and </think> tags.
3. The tags <think> and </think> must start and end your reasoning block exactly.
4. After the closing </think> tag, output your final, clear, and polished response to the user.

Example Output Structure:
<think>
[Detailed step-by-step reasoning, calculations, planning, and tool evaluation]
</think>
[Final user response here]

Follow this structure for EVERY response. Do not deviate from this output format under any circumstances.`;

// ── Message formatting for Google GenAI SDK ──────────────────────────────────
function formatGeminiMessages(messages, systemInstruction, isGemma) {
  const geminiMsgs = [];
  if (isGemma) {
    // Gemma requires prepended system instructions as a user turn
    geminiMsgs.push({ role: 'user', parts: [{ text: `System Instructions:\n${systemInstruction}` }] });
    geminiMsgs.push({ role: 'model', parts: [{ text: 'Understood.' }] });
  }
  for (const m of messages) {
    const role = m.role === 'assistant' ? 'model' : 'user';
    geminiMsgs.push({ role, parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }] });
  }
  return geminiMsgs;
}

// ── Streaming Helper: Google Gemini / Gemma ──────────────────────────────────
async function streamGeminiHelper({ modelId, system, messages, apiKey, onToken, signal }) {
  if (!apiKey) throw new Error(`Gemini API key not configured for ${modelId}`);
  const ai = new GoogleGenAI({ apiKey });
  const isGemma = modelId.startsWith('gemma-');
  const geminiMsgs = formatGeminiMessages(messages, system, isGemma);

  const config = {
    maxOutputTokens: 8192,
  };
  if (!isGemma) {
    config.systemInstruction = system;
  }

  const responseStream = await ai.models.generateContentStream({
    model: modelId,
    contents: geminiMsgs,
    config,
  }, { signal });

  for await (const chunk of responseStream) {
    if (signal?.aborted) {
      const e = new Error('AbortError');
      e.name = 'AbortError';
      throw e;
    }
    if (chunk.text) {
      onToken(chunk.text);
    }
  }
}

// ── Streaming Helper: Groq ───────────────────────────────────────────────────
async function streamGroqHelper({ modelId, system, messages, apiKey, onToken, signal }) {
  if (!apiKey) throw new Error(`Groq API key not configured for ${modelId}`);

  const groqMsgs = [
    { role: 'system', content: system },
    ...messages.map(m => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    }))
  ];

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: modelId,
      messages: groqMsgs,
      stream: true,
      max_tokens: 8192
    })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Groq API error ${res.status} (${modelId})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let sentStartTag = false;
  let sentEndTag = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (!raw || raw === '[DONE]') continue;
      try {
        const p = JSON.parse(raw);
        const delta = p.choices?.[0]?.delta;
        if (!delta) continue;

        // Capture native reasoning if present (e.g. from DeepSeek R1 models)
        if (delta.reasoning_content) {
          if (!sentStartTag) {
            onToken('<think>\n');
            sentStartTag = true;
          }
          onToken(delta.reasoning_content);
        }

        if (delta.content) {
          if (sentStartTag && !sentEndTag) {
            onToken('\n</think>\n');
            sentEndTag = true;
          }
          onToken(delta.content);
        }
      } catch {
        // incomplete SSE chunk
      }
    }
  }
}

// ── MAIN ORCHESTRATOR ENTRY POINT ────────────────────────────────────────────
export async function runOrchestrator({
  messages,
  apiKeys,
  systemPrompt,
  signal,
  onToken,
  onStageUpdate,
}) {
  const keyMap = apiKeys || {};
  const geminiKey = keyMap.gemini || DEFAULT_KEYS.gemini;
  const groqKey = keyMap.groq || DEFAULT_KEYS.groq;

  const combinedSystemPrompt = `${REASONER_SYSTEM_PROMPT}\n\n${systemPrompt || ''}`;

  // Fallback models configuration
  const chain = [
    {
      provider: 'gemini',
      modelId: 'gemma-4-31b-it',
      key: geminiKey,
      label: 'EMMA-#31',
    },
    {
      provider: 'groq',
      modelId: 'qwen/qwen3-32b',
      key: groqKey,
      label: 'Groq Qwen3 32B',
    },
    {
      provider: 'groq',
      modelId: 'openai/gpt-oss-120b',
      key: groqKey,
      label: 'Groq GPT-OSS 120B',
    },
    {
      provider: 'gemini',
      modelId: 'gemini-3.1-flash-lite',
      key: geminiKey,
      label: 'MINI-FL',
    }
  ];

  let lastError = null;

  for (const step of chain) {
    if (!step.key) {
      console.warn(`[Orchestrator] Skipped ${step.label} (${step.modelId}) - key not configured`);
      continue;
    }

    let tokensWritten = false;
    const trackedOnToken = (token) => {
      if (!tokensWritten) {
        // Clear stage update spinner when streaming commences
        onStageUpdate?.(null);
        tokensWritten = true;
      }
      onToken(token);
    };

    try {
      onStageUpdate?.(`Beesto is analysing request…`);
      
      if (step.provider === 'gemini') {
        await streamGeminiHelper({
          modelId: step.modelId,
          system: combinedSystemPrompt,
          messages,
          apiKey: step.key,
          onToken: trackedOnToken,
          signal,
        });
      } else if (step.provider === 'groq') {
        await streamGroqHelper({
          modelId: step.modelId,
          system: combinedSystemPrompt,
          messages,
          apiKey: step.key,
          onToken: trackedOnToken,
          signal,
        });
      }

      onStageUpdate?.(null);
      return; // Complete!

    } catch (err) {
      if (err.name === 'AbortError' || signal?.aborted) {
        throw err;
      }
      
      // If we already started writing tokens, we cannot safely try the fallback model
      if (tokensWritten) {
        console.error(`[Orchestrator] Stream error on ${step.label}:`, err.message);
        throw err;
      }

      console.warn(`[Orchestrator] ${step.label} failed: ${err.message}. Retrying fallback…`);
      lastError = err;
    }
  }

  // All attempts exhausted
  onStageUpdate?.(null);
  const errMsg = lastError ? lastError.message : 'No API keys configured or all models failed';
  onToken(`⚠️ **Orchestrator Failed**\n\n*Error: ${errMsg}*\n\nPlease check your Gemini and Groq API keys in Settings.`);
}