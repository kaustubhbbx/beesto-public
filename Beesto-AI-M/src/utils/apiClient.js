// FILE: src/utils/apiClient.js
// ─────────────────────────────────────────────────────────────────────────────
// REBUILT — Clean routing, no duplicated logic, no broken SDK calls.
//
// Routing order:
//   1. Image generation (intent-based)
//   2. Tool pipeline (weather, search, news, math)
//   3. Orchestrator (beesto-orchestrator model ID)
//   4. BEESTO sandbox engine (beesto model ID) — imported from beesto.js
//   5. Provider-specific streaming (Groq, Gemini, OpenAI, etc.)
//   6. Custom models
// ─────────────────────────────────────────────────────────────────────────────

import { detectProvider } from './helpers';
import { ROUTE, DEFAULT_KEYS, GROQ_MODEL_MAX_TOKENS } from '../constants/api';
import { classifyTools } from './classifier';
import { runTools } from './tools';
import { GoogleGenAI, Modality } from '@google/genai';
import { runOrchestrator } from './orchestrator';
import { streamBeesto, loadSandbox, createSandbox } from './beesto';
import { streamBeestoParallel } from './beestoParallel';
import { detectGoogleAgentMode, runGoogleAgent } from './googleAgent';
import { runAgent } from '../beesto-ide/beesto-ide.js';

// ── Virtual / special model IDs ───────────────────────────────────────────────
export const ORCHESTRATOR_MODEL_ID = 'beesto';
export const BEESTO_MODEL_ID = 'beesto-coder';
export const BEESTO_PARALLEL_ID = 'beesto-parallel';
export const BEESTO_IDE_ID = 'beesto-ide';

export const GEMINI_IMAGE_MODELS = [
  'imagen-3.0-generate-002',
  'imagen-4-generate-002',
  'gemini-3.1-flash-image-preview',
];

export function isImageGenRequest(text = '') {
  const t = text.toLowerCase().trim();
  const imageKeywords = /\b(image|picture|photo|drawing|painting|illustration|art|logo|icon)\b/;

  const explicitVerbs = (
    t.startsWith('draw ') ||
    t.startsWith('imagine ') ||
    t.startsWith('paint ')
  );

  const generateWithImage = (
    /^(generate|create|make)\b/.test(t) && imageKeywords.test(t)
  );

  return explicitVerbs || generateWithImage;
}

// ── Message builders ──────────────────────────────────────────────────────────
function buildTextMessages(messages, systemPrompt, attachment) {
  const sys = systemPrompt || 'You are Beesto, a helpful AI assistant. Be concise and clear.';
  let lastText = messages[messages.length - 1]?.content || '';
  if (attachment?.text) lastText = `${attachment.text}\n\n---\n\n${lastText}`;
  const history = messages.slice(0, -1).map(m => ({ role: m.role, content: m.content }));
  history.push({ role: 'user', content: lastText });
  return { system: sys, messages: history };
}

function buildVisionMessages(messages, systemPrompt, attachment) {
  const sys = systemPrompt || 'You are Beesto, a helpful AI assistant. Describe and analyze images thoughtfully.';
  const lastMsg = messages[messages.length - 1];
  const contentParts = [];
  if (attachment?.data) {
    const parts = attachment.data.split(',');
    if (parts.length === 2 && parts[0].includes(':') && parts[0].includes(';')) {
      const [meta, b64] = parts;
      const mimeType = meta.split(':')[1].split(';')[0];
      contentParts.push({ type: 'image_url', image_url: { url: `data:${mimeType};base64,${b64}` } });
    } else {
      console.warn('Invalid attachment data URL format');
    }
  }
  contentParts.push({ type: 'text', text: lastMsg?.content || 'Describe this image.' });
  const history = messages.slice(0, -1).map(m => ({ role: m.role, content: m.content }));
  history.push({ role: 'user', content: contentParts });
  return { system: sys, messages: history };
}

// ─────────────────────────────────────────────────────────────────────────────
// IMAGE GENERATION
// ─────────────────────────────────────────────────────────────────────────────
export async function generateGeminiImage(prompt, apiKey, modelId = 'imagen-3.0-generate-002') {
  if (!apiKey) throw new Error('Gemini API key not set. Add it in Settings → API Keys.');
  const ai = new GoogleGenAI({ apiKey });

  if (modelId.startsWith('imagen-')) {
    const response = await ai.models.generateImages({
      model: modelId,
      prompt,
      config: { numberOfImages: 1, aspectRatio: '1:1' },
    });
    const img = response.generatedImages?.[0];
    if (!img?.image?.imageBytes) throw new Error(`${modelId}: no image returned`);
    return { type: 'image', url: `data:image/png;base64,${img.image.imageBytes}`, provider: 'Imagen (Google)' };
  }

  const response = await ai.models.generateContent({
    model: modelId,
    contents: prompt,
    config: { responseModalities: [Modality.IMAGE, Modality.TEXT] },
  });
  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      const dataUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
      return { type: 'image', url: dataUrl, provider: 'Gemini Image (Google)' };
    }
  }
  throw new Error(`${modelId}: no image part in response`);
}

export async function generateImage(prompt, apiKeys, providerPreference = 'auto') {
  const pollinationsKey = apiKeys?.pollinations || import.meta.env.VITE_POLLINATIONS_API_KEY || '';
  const hfKey = apiKeys?.huggingface || import.meta.env.VITE_HF_API_KEY || '';
  const encodedPrompt = encodeURIComponent(prompt);
  const randomSeed = Math.floor(Math.random() * 1_000_000);

  const runPollinations = async () => {
    const keyParam = pollinationsKey ? `&key=${pollinationsKey}` : '';
    const url = `https://gen.pollinations.ai/image/${encodedPrompt}?width=1024&height=1024&model=flux&nologo=true&seed=${randomSeed}${keyParam}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Pollinations failed with status ${res.status}`);
    return { type: 'image', url: await blobToBase64(await res.blob()), provider: 'Pollinations' };
  };

  const runHuggingFace = async () => {
    const res = await fetch('https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell', {
      method: 'POST',
      headers: { Authorization: `Bearer ${hfKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: prompt }),
    });
    if (!res.ok) throw new Error(`HF Failed: ${await res.text()}`);
    return { type: 'image', url: await blobToBase64(await res.blob()), provider: 'Hugging Face (FLUX)' };
  };

  if (providerPreference === 'huggingface') return runHuggingFace();
  if (providerPreference === 'pollinations') return runPollinations();
  try { return await runPollinations(); } catch {
    console.warn('[Image] Pollinations failed → HF fallback');
    return runHuggingFace();
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('FileReader failed'));
    reader.readAsDataURL(blob);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN STREAMING ENTRYPOINT
// ─────────────────────────────────────────────────────────────────────────────
export async function streamMessage({
  messages,
  modelId,
  apiKeys,
  systemPrompt,
  attachment,
  onToken,
  onThinking,
  signal,
  onToolsUsed,
  onStageUpdate,
  onSandboxUpdate,
  chatId,
  onConsoleLog,
  onGoogleAgentMode,
  framework,
}) {
  let finalSystemPrompt = (systemPrompt || 'You are Beesto, a helpful AI assistant. Be concise and clear.') + `\n\n[System note: The current local date and time is ${new Date().toLocaleString()}.]`;
  let stopExecution = false;
  const keys = {};
  const isBeestoModel = modelId === BEESTO_MODEL_ID || modelId === BEESTO_PARALLEL_ID || modelId === BEESTO_IDE_ID || modelId === ORCHESTRATOR_MODEL_ID || modelId === 'beesto';
  for (const provider of ['groq', 'gemini', 'cerebras', 'openai', 'anthropic', 'mistral', 'cohere']) {
    const personalKey = apiKeys?.[provider]?.trim();
    if (isBeestoModel) {
      keys[provider] = personalKey || DEFAULT_KEYS[provider] || '';
    } else {
      keys[provider] = personalKey || '';
    }
  }

  // ── Beesto IDE Agent Routing (Bypasses standard tool classification & image gen) ──
  if (modelId === BEESTO_IDE_ID) {
    let sandbox = loadSandbox(chatId);
    if (!sandbox) {
      sandbox = createSandbox(chatId);
    }
    
    const geminiKey = keys.gemini;
    if (!geminiKey) {
      throw new Error('Gemini API key not set. Add it in Settings → API Keys.');
    }
    
    const lastUserMessage = messages[messages.length - 1]?.content || '';
    
    const agentResult = await runAgent(
      lastUserMessage,
      sandbox,
      geminiKey,
      {
        verbose: true,
        signal: signal,
        framework: framework || undefined,
        onProgress: (p) => {
          if (p.stage === 'writing' || p.stage === 'patching') {
            const lines = sandbox.files[p.path]?.lines || 0;
            const suffix = p.tokenCount > 0 ? ` (${p.tokenCount} tokens, ${lines} lines)` : '';
            onStageUpdate?.(`${p.message}${suffix}`);
          } else if (p.stage === 'executing') {
            onStageUpdate?.(`⚙️ Running ${p.tool}...`);
          } else {
            onStageUpdate?.(p.message || 'Thinking...');
          }
        },
        onSandboxUpdate: onSandboxUpdate,
        onToken: onToken,
        onConsoleLog: (logObj) => {
          onConsoleLog?.(logObj);
        }
      },
      messages
    );

    if (agentResult && agentResult.success === false) {
      throw new Error(agentResult.error || 'Failed to complete task');
    }

    return agentResult;
  }

  // ── 0. Google Advanced Agent Routing ─────────────────────────────────────
  const isSandboxOrParallel = modelId === BEESTO_MODEL_ID || modelId === BEESTO_PARALLEL_ID || modelId === BEESTO_IDE_ID;
  if (!isSandboxOrParallel) {
    const lastMessage = messages[messages.length - 1]?.content;
    if (lastMessage && typeof lastMessage === 'string' && lastMessage.trim()) {
      const googleMode = detectGoogleAgentMode(lastMessage);
      if (googleMode) {
        if (!keys.gemini) {
          throw new Error('Gemini API key required for Google Advanced Agent.');
        }
        onGoogleAgentMode?.(googleMode);
        try {
          await runGoogleAgent({
            mode: googleMode,
            prompt: lastMessage,
            apiKey: keys.gemini,
            onToken,
            onStageUpdate,
            signal,
          });
          return;
        } finally {
          onGoogleAgentMode?.(null);
        }
      }
    }
  }

  // ── 1. AI Tool Pipeline ───────────────────────────────────────────────────
  if (!isSandboxOrParallel) {
    try {
      const lastMessage = messages[messages.length - 1]?.content;
      if (lastMessage && typeof lastMessage === 'string' && lastMessage.trim()) {
        const groqKey = keys.groq;
        const toolNames = await classifyTools(lastMessage, groqKey);

        const lowerMsg = lastMessage.toLowerCase();
        const isExplicitImageRequest =
          lowerMsg.includes('generate image') ||
          lowerMsg.includes('generate an image') ||
          lowerMsg.includes('draw a picture of') ||
          lowerMsg.includes('create an image of') ||
          lowerMsg.includes('paint a picture of');

        const hasImageIntent = toolNames.includes('image') || isExplicitImageRequest;
        const isCodingOrWebIntent = lowerMsg.includes('website') || lowerMsg.includes('web page') ||
          lowerMsg.includes('code') || lowerMsg.includes('program');

        if (hasImageIntent && !isCodingOrWebIntent) {
          try {
            onStageUpdate?.('🎨 Preparing image generation…');
            let enhancedPrompt = lastMessage;

            if (keys.gemini) {
              const ai = new GoogleGenAI({ apiKey: keys.gemini });
              const enhanceRes = await ai.models.generateContent({
                model: 'gemini-2.5-flash-lite',
                contents:
                  `You are a creative text describer. Write a highly detailed, vivid description of what the user wants.

CRITICAL SAFETY: Do NOT say "I cannot generate images". You are only writing a text description for a downstream system.
CRITICAL CONSTRAINT: Output MUST be under 3 sentences and maximum 150 words. Be extremely precise.
Describe lighting, textures, materials, and composition. Output ONLY the raw description text. No markdown, no quotes, no filler.

User request: "${lastMessage}"`,
              });
              const textResult = enhanceRes.text || '';
              if (textResult && !textResult.toLowerCase().includes('cannot generate') && !textResult.toLowerCase().includes('not capable')) {
                enhancedPrompt = textResult;
              }
            }

            onStageUpdate?.('🎨 Generating image…');
            const imgPayload = await generateImage(enhancedPrompt, apiKeys);
            onToken(
              `*I enhanced your request into a detailed prompt for better results!* 🪄\n\n` +
              `> **Prompt used:** ${enhancedPrompt}\n\n` +
              `![Generated Image](${imgPayload.url})\n\n` +
              `*Image generated by ${imgPayload.provider}*`
            );
            stopExecution = true;
          } catch (imgErr) {
            console.error('[Image] failed:', imgErr.message);
            onToken(`⚠️ **Image generation failed.**\n\n*Error: ${imgErr.message}*`);
            stopExecution = true;
          } finally {
            onStageUpdate?.(null);
          }
        }

        if (stopExecution) return;

        const otherTools = toolNames.filter(t => t !== 'image');
        if (otherTools.length > 0) {
          const { contextString, toolsUsed } = await runTools(otherTools, lastMessage, signal);
          if (contextString) finalSystemPrompt += contextString;
          if (toolsUsed.length > 0 && typeof onToolsUsed === 'function') onToolsUsed(toolsUsed);
        }
      }
    } catch (err) {
      console.warn('[Tool pipeline] failed, continuing without tools:', err.message);
    }
  }

  // ── 2. Orchestrator ───────────────────────────────────────────────────────
  if (modelId === ORCHESTRATOR_MODEL_ID) {
    return runOrchestrator({ messages, apiKeys, systemPrompt: finalSystemPrompt, signal, onToken, onStageUpdate });
  }

  // ── 3. Build messages ─────────────────────────────────────────────────────
  const isVision = attachment?.route === ROUTE.VISION;
  const { system, messages: msgs } = isVision
    ? buildVisionMessages(messages, finalSystemPrompt, attachment)
    : buildTextMessages(messages, finalSystemPrompt, attachment);



  // ── 4b. BEESTO sandbox engine (Gemma) ──────────────────────────────────────
  if (modelId === BEESTO_MODEL_ID || modelId === BEESTO_IDE_ID) {
    let customOnStageUpdate = onStageUpdate;
    if (modelId === BEESTO_IDE_ID) {
      customOnStageUpdate = (stage) => {
        if (!stage) {
          onStageUpdate?.(null);
          return;
        }
        let mappedStage = stage;
        if (stage.includes('Writing code') || stage.includes('Generating files')) {
          mappedStage = '✍️ Writing code...';
        } else if (stage.includes('Blueprinting')) {
          mappedStage = '📋 Planning project structure...';
        } else if (stage.includes('Connecting') || stage.includes('Queueing') || stage.includes('analyzing') || stage.includes('preparing')) {
          mappedStage = '📡 Connecting to AI...';
        }
        onStageUpdate?.(mappedStage);
      };
    }
    return streamBeesto({ system, messages: msgs, apiKeys: keys, onToken, signal, onSandboxUpdate, chatId, onConsoleLog, onStageUpdate: customOnStageUpdate, framework });
  }

  // ── 4b. BEESTO parallel engine (multi-agent) ─────────────────────────────
  if (modelId === BEESTO_PARALLEL_ID) {
    return streamBeestoParallel({
      system,
      messages: msgs,
      apiKeys: keys,
      onToken,
      signal,
      onSandboxUpdate,
      chatId,
      onConsoleLog,
      onStageUpdate,
      framework,
    });
  }

  // ── 5. Live models → fallback to flash lite ───────────────────────────────
  if (
    modelId === 'gemini-3-flash-live' ||
    modelId === 'gemini-3.1-flash-live-preview' ||
    modelId === 'gemini-2.5-flash-live'
  ) {
    return streamGemini({ system, messages: msgs, modelId: 'gemini-2.5-flash-lite', apiKey: keys.gemini, onToken, signal });
  }

  // ── 6. Image models → fallback to flash lite ─────────────────────────────
  if (GEMINI_IMAGE_MODELS.includes(modelId)) {
    return streamGemini({ system, messages: msgs, modelId: 'gemini-2.5-flash-lite', apiKey: keys.gemini, onToken, signal });
  }

  // ── 7. Provider routing ───────────────────────────────────────────────────
  const provider = detectProvider(modelId);
  if (provider === 'groq') return streamGroq({ system, messages: msgs, modelId, apiKey: keys.groq, onToken, signal });
  if (provider === 'gemini') return streamGemini({ system, messages: msgs, modelId, apiKey: keys.gemini, onToken, signal, isVision, attachment });
  if (provider === 'openai') return streamOpenAI({ system, messages: msgs, modelId, apiKey: keys.openai, onToken, signal });
  if (provider === 'anthropic') return streamAnthropic({ system, messages: msgs, modelId, apiKey: keys.anthropic, onToken, signal });
  if (provider === 'mistral') return streamMistral({ system, messages: msgs, modelId, apiKey: keys.mistral, onToken, signal });
  if (provider === 'cohere') return streamCohere({ system, messages: msgs, modelId, apiKey: keys.cohere, onToken, signal });
  if (provider === 'cerebras') return streamCerebras({ system, messages: msgs, modelId, apiKey: keys.cerebras, onToken, signal });

  // ── 8. Custom models ──────────────────────────────────────────────────────
  const customModels = JSON.parse(localStorage.getItem('beesto_custom_models') || '[]');
  const custom = customModels.find(m => m.id === modelId);
  if (custom) return streamCustom({ system, messages: msgs, model: custom, onToken, signal });

  throw new Error(`Unknown model: "${modelId}". Check constants/models.js or add it as a custom model.`);
}

// ─────────────────────────────────────────────────────────────────────────────
// PROVIDER IMPLEMENTATIONS
// ─────────────────────────────────────────────────────────────────────────────
async function streamGroq({ system, messages, modelId, apiKey, onToken, signal }) {
  if (!apiKey) throw new Error('Groq API key not set. Add it in Settings → API Keys.');
  const GROQ_FALLBACK_MODEL = 'llama-3.1-8b-instant';
  const maxTokens = GROQ_MODEL_MAX_TOKENS[modelId] || 8192;
  const safeMessages = messages.slice(-4).map(m => ({
    role: m.role,
    content: typeof m.content === 'string' ? m.content.slice(0, 3000) : JSON.stringify(m.content).slice(0, 3000),
  }));

  async function attemptGroqRequest(targetModelId, targetMaxTokens) {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: targetModelId, max_tokens: targetMaxTokens, stream: true, messages: [{ role: 'system', content: system }, ...safeMessages] }),
    });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error?.message || `Groq ${res.status} on "${targetModelId}"`); }
    return readSSEStream(res, onToken);
  }

  function isGroqPayloadError(err) {
    const msg = err?.message?.toLowerCase() || '';
    return err?.message?.includes('413') || msg.includes('payload') || msg.includes('too large') ||
      msg.includes('token') || msg.includes('context_length_exceeded') || msg.includes('max_tokens') || msg.includes('rate_limit');
  }

  try {
    return await attemptGroqRequest(modelId, maxTokens);
  } catch (primaryErr) {
    if (primaryErr?.name === 'AbortError' || signal?.aborted) throw primaryErr;
    if (isGroqPayloadError(primaryErr) && modelId !== GROQ_FALLBACK_MODEL) {
      console.warn(`[Groq] ⚠️ Payload/token error on "${modelId}" — retrying with "${GROQ_FALLBACK_MODEL}"…`);
      return attemptGroqRequest(GROQ_FALLBACK_MODEL, 4096);
    }
    throw primaryErr;
  }
}

async function streamGemini({ system, messages, modelId, apiKey, onToken, signal }) {
  if (!apiKey) throw new Error('Gemini API key not set. Add it in Settings → API Keys.');
  const ai = new GoogleGenAI({ apiKey });
  const geminiMsgs = messages.map(m => {
    const role = m.role === 'assistant' ? 'model' : 'user';
    if (typeof m.content === 'string') return { role, parts: [{ text: m.content }] };
    const parts = m.content.map(part => {
      if (part.type === 'text') return { text: part.text };
      if (part.type === 'image_url') {
        const [meta, b64] = part.image_url.url.split(',');
        return { inlineData: { mimeType: meta.split(':')[1].split(';')[0], data: b64 } };
      }
      return null;
    }).filter(Boolean);
    return { role, parts };
  });
  const responseStream = await ai.models.generateContentStream({
    model: modelId, contents: geminiMsgs,
    config: { systemInstruction: system, maxOutputTokens: 8192 },
  }, {
    signal
  });
  for await (const chunk of responseStream) {
    if (signal?.aborted) { const e = new Error('AbortError'); e.name = 'AbortError'; throw e; }
    if (chunk.text) onToken(chunk.text);
  }
}

async function streamOpenAI({ system, messages, modelId, apiKey, onToken, signal }) {
  if (!apiKey) throw new Error('OpenAI API key not set. Add it in Settings → API Keys.');
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: modelId, stream: true, messages: [{ role: 'system', content: system }, ...messages] }),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error?.message || `OpenAI ${res.status}`); }
  return readSSEStream(res, onToken);
}

async function streamAnthropic({ system, messages, modelId, apiKey, onToken, signal }) {
  if (!apiKey) throw new Error('Anthropic API key not set. Add it in Settings → API Keys.');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify({ model: modelId, max_tokens: 8192, stream: true, system, messages }),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error?.message || `Anthropic ${res.status}`); }
  const reader = res.body.getReader(); const decoder = new TextDecoder(); let buf = '';
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim(); if (!raw || raw === '[DONE]') continue;
      try { const p = JSON.parse(raw); if (p.delta?.text) onToken(p.delta.text); } catch { /* incomplete */ }
    }
  }
}

async function streamMistral({ system, messages, modelId, apiKey, onToken, signal }) {
  if (!apiKey) throw new Error('Mistral API key not set. Add it in Settings → API Keys.');
  const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: modelId, stream: true, messages: [{ role: 'system', content: system }, ...messages] }),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error?.message || `Mistral ${res.status}`); }
  const reader = res.body.getReader(); const decoder = new TextDecoder(); let buf = '';
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim(); if (!raw || raw === '[DONE]') continue;
      try { const p = JSON.parse(raw); const t = p.choices?.[0]?.delta?.content; if (t) onToken(t); } catch { /* incomplete */ }
    }
  }
}

async function streamCohere({ system, messages, modelId, apiKey, onToken, signal }) {
  if (!apiKey) throw new Error('Cohere API key not set. Add it in Settings → API Keys.');
  const res = await fetch('/api/cohere/chat', {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', 'x-cohere-key': apiKey },
    body: JSON.stringify({ model: modelId, stream: true, messages: [{ role: 'system', content: system }, ...messages.map(m => ({ role: m.role, content: m.content }))] }),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message || e.error || `Cohere ${res.status}`); }
  const reader = res.body.getReader(); const decoder = new TextDecoder(); let buf = '';
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim(); if (!raw || raw === '[DONE]') continue;
      try { const p = JSON.parse(raw); if (p.type === 'content-delta') { const t = p.delta?.message?.content?.text; if (t) onToken(t); } } catch { /* incomplete */ }
    }
  }
}

async function streamCerebras({ system, messages, modelId, apiKey, onToken, signal }) {
  if (!apiKey) throw new Error('Cerebras API key not configured. Add it in Settings → API Keys.');
  const res = await fetch('https://api.cerebras.ai/v1/chat/completions', {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: modelId, max_tokens: 8192, stream: true, messages: [{ role: 'system', content: system }, ...messages] }),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error?.message || `Cerebras ${res.status}`); }
  return readSSEStream(res, onToken);
}

async function streamCustom({ system, messages, model, onToken, signal }) {
  const res = await fetch(`${model.baseUrl}/chat/completions`, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${model.apiKey || 'none'}` },
    body: JSON.stringify({ model: model.id, stream: true, messages: [{ role: 'system', content: system }, ...messages] }),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error?.message || `Custom model ${res.status}`); }
  return readSSEStream(res, onToken);
}

async function readSSEStream(res, onToken, onThinking) {
  const reader = res.body.getReader(); const decoder = new TextDecoder(); let buf = '';
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (!raw || raw === '[DONE]') continue;
      try {
        const p = JSON.parse(raw); const delta = p.choices?.[0]?.delta;
        if (!delta) continue;
        if (delta.reasoning_content && typeof onThinking === 'function') {
          onThinking(typeof delta.reasoning_content === 'string' ? delta.reasoning_content : JSON.stringify(delta.reasoning_content));
        }
        if (delta.content) {
          onToken(typeof delta.content === 'string' ? delta.content : JSON.stringify(delta.content));
        }
      } catch { /* incomplete SSE chunk */ }
    }
  }
}