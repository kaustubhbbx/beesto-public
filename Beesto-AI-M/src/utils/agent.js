import { DEFAULT_KEYS }  from '../constants/api';
import { GoogleGenAI }   from '@google/genai';

const LOG = (emoji, msg, data) => {
  if (data !== undefined) console.log(`[Agent] ${emoji} ${msg}`, data);
  else                    console.log(`[Agent] ${emoji} ${msg}`);
};

function extractText(content) {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(b => b?.text || b?.content || '').join('');
  if (typeof content === 'object') return content.text || content.content || JSON.stringify(content);
  return String(content);
}

function isWeatherPrompt(p = '') {
  return /\b(weather|temperature|forecast|rain|sunny|cloudy|hot|cold|humidity|wind)\b/i.test(p);
}
function isDeepResearchIntent(p = '') {
  const t = p.toLowerCase().trim();
  return (
    t.startsWith('research ')            || t.startsWith('deep research')        ||
    t.startsWith('write a report on')    || t.startsWith('write a report about') ||
    t.includes('comprehensive report')   || t.includes('in-depth analysis')      ||
    t.includes('detailed research')      || t.includes('literature review')      ||
    t.includes('competitive analysis')   || t.includes('market analysis')
  );
}
function isMapsIntent(p = '') {
  const t = p.toLowerCase();
  return (
    t.includes('near me')        || t.includes('restaurants in') ||
    t.includes('hotels in')      || t.includes('places to visit') ||
    t.includes('directions to')  || t.includes('find places') ||
    t.includes('map of')         || t.includes('location of')
  );
}

function extractFromResponse(response) {
  const text = response.text || '';
  const groundingMeta = response.candidates?.[0]?.groundingMetadata;
  const sources = groundingMeta?.groundingChunks
    ?.map(c => c.web).filter(Boolean)
    .map(w => `[${w.title || w.uri}](${w.uri})`);
  return { text, sources: sources ? [...new Set(sources)] : [] };
}

async function streamSDKResponse(stream, onToken, signal) {
  let charCount = 0;
  for await (const chunk of stream) {
    if (signal?.aborted) break;
    if (chunk.text) {
      onToken(chunk.text);
      charCount += chunk.text.length;
    }
  }
  LOG('📤', `Streamed ${charCount} chars`);
}

// ── Weather ───────────────────────────────────────────────────────────────────
async function fetchWeather(prompt) {
  const match =
    prompt.match(/(?:weather|temperature|forecast|rain|hot|cold)\s+(?:in|for|at)\s+([A-Za-z\s,]+?)(?:\?|$|today|tomorrow)/i) ||
    prompt.match(/(?:in|for|at)\s+([A-Za-z\s,]{2,25})(?:\?|$|\s*(?:right now|today))/i);
  const city = match ? match[1].trim() : 'auto';
  LOG('🌤️', `Fetching weather for: "${city}"`);
  const res  = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`);
  if (!res.ok) throw new Error('Weather fetch failed');
  const data = await res.json();
  const c    = data.current_condition?.[0];
  const name = data.nearest_area?.[0]?.areaName?.[0]?.value || city;
  const ctry = data.nearest_area?.[0]?.country?.[0]?.value  || '';
  const result = `**${name}${ctry ? ', ' + ctry : ''}:** ${c.temp_C}°C (feels ${c.FeelsLikeC}°C), ${c.weatherDesc?.[0]?.value}, humidity ${c.humidity}%, wind ${c.windspeedKmph} km/h.`;
  LOG('🌤️', `Weather result:`, result);
  return result;
}

// ── Search Grounding ──────────────────────────────────────────────────────────
async function runSearchGrounding({ prompt, ai, onToken, onStageUpdate, signal }) {
  LOG('🔍', `Search Grounding START — prompt: "${prompt.slice(0, 80)}"`);
  onStageUpdate('🔍 Searching the web…');

  const stream = await ai.models.generateContentStream({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: { 
      systemInstruction: `You are Beesto, a helpful AI assistant. Current date and time: ${new Date().toLocaleString()}.`,
      tools: [{ googleSearch: {} }], 
      maxOutputTokens: 4096 
    },
  });

  let fullText = '', groundingMeta = null;
  for await (const chunk of stream) {
    if (signal?.aborted) break;
    if (chunk.text) { onToken(chunk.text); fullText += chunk.text; }
    if (chunk.candidates?.[0]?.groundingMetadata) {
      groundingMeta = chunk.candidates[0].groundingMetadata;
    }
  }

  LOG('🔍', `Search Grounding DONE — ${fullText.length} chars`);

  const sources = groundingMeta?.groundingChunks
    ?.map(c => c.web).filter(Boolean)
    .map(w => `[${w.title || w.uri}](${w.uri})`);
  const queries = groundingMeta?.webSearchQueries || [];
  LOG('🔍', `Queries used:`, queries);
  LOG('🔍', `Sources found: ${sources?.length || 0}`);

  if (sources?.length) {
    const unique = [...new Set(sources)];
    onToken(`\n\n---\n**Sources:** ${unique.join(' · ')}`);
  }

  onStageUpdate(null);
}

// ── Map Grounding ─────────────────────────────────────────────────────────────
async function runMapGrounding({ prompt, ai, onToken, onStageUpdate, signal }) {
  LOG('🗺️', `Map Grounding START — prompt: "${prompt.slice(0, 80)}"`);
  onStageUpdate('🗺️ Looking up locations…');

  try {
    LOG('🗺️', 'Trying googleMaps tool on gemini-3.1-flash-lite…');
    const stream = await ai.models.generateContentStream({
      model: 'gemini-3.1-flash-lite',
      contents: prompt,
      config: {
        systemInstruction: `You are a location expert. Include place names, addresses, ratings, opening hours, and visit tips. Current date and time: ${new Date().toLocaleString()}.`,
        tools: [{ googleMaps: {} }],
        maxOutputTokens: 4096,
      },
    });
    await streamSDKResponse(stream, onToken, signal);
    LOG('🗺️', 'Map Grounding DONE via googleMaps');
  } catch (mapsErr) {
    LOG('🗺️', `googleMaps failed (${mapsErr.message}), falling back to googleSearch`);
    onStageUpdate('🔍 Searching for location info…');
    const stream = await ai.models.generateContentStream({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        systemInstruction: `You are a location and travel expert. Answer with real place names, addresses, ratings, and visit tips. Current date and time: ${new Date().toLocaleString()}.`,
        tools: [{ googleSearch: {} }],
        maxOutputTokens: 4096,
      },
    });
    await streamSDKResponse(stream, onToken, signal);
    LOG('🗺️', 'Map Grounding DONE via googleSearch fallback');
  }

  onStageUpdate(null);
}

// ── Deep Research ─────────────────────────────────────────────────────────────
async function runDeepResearch({ prompt, ai, onToken, onStageUpdate, signal }) {
  LOG('📚', `Deep Research START — topic: "${prompt.slice(0, 80)}"`);
  onStageUpdate('🧠 Planning research…');

  // Round 1: decompose
  LOG('📚', 'Round 1: Decomposing into sub-questions…');
  const planRes = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: `Break this research topic into 4 focused sub-questions. Output ONLY a JSON array of strings, no markdown.\n\nTopic: ${prompt}`,
    config: { 
      systemInstruction: `Current date and time: ${new Date().toLocaleString()}.`,
      maxOutputTokens: 512 
    },
  });

  let subQuestions = [];
  try {
    subQuestions = JSON.parse(planRes.text?.replace(/```json|```/g, '').trim() || '[]');
  } catch { subQuestions = [prompt]; }
  if (!Array.isArray(subQuestions) || !subQuestions.length) subQuestions = [prompt];
  LOG('📚', `Sub-questions:`, subQuestions);

  // Round 2: research each
  const findings = [];
  for (let i = 0; i < subQuestions.length; i++) {
    if (signal?.aborted) return;
    LOG('📚', `Round 2 [${i + 1}/${subQuestions.length}]: Researching — "${subQuestions[i]}"`);
    onStageUpdate(`🔍 Researching ${i + 1}/${subQuestions.length}…`);
    try {
      const res = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: subQuestions[i],
        config: { 
          systemInstruction: `Current date and time: ${new Date().toLocaleString()}.`,
          tools: [{ googleSearch: {} }], 
          maxOutputTokens: 2048 
        },
      });
      const { text, sources } = extractFromResponse(res);
      LOG('📚', `  → ${text.length} chars, ${sources.length} sources`);
      findings.push({ q: subQuestions[i], a: text, sources });
    } catch (err) {
      LOG('📚', `  → FAILED: ${err.message}`);
      findings.push({ q: subQuestions[i], a: `Could not research: ${err.message}`, sources: [] });
    }
  }

  // Round 3: synthesize
  LOG('📚', 'Round 3: Synthesizing report…');
  onStageUpdate('✍️ Writing report…');

  const allSources = [...new Set(findings.flatMap(f => f.sources))];
  const findingsText = findings.map((f, i) => `[${i + 1}] Q: ${f.q}\nA: ${f.a}`).join('\n\n');

  const synthStream = await ai.models.generateContentStream({
    model: 'gemini-2.5-flash',
    contents: `Write a comprehensive research report on: "${prompt}"\n\nResearch findings:\n${findingsText}\n\nStructure: Executive Summary → Key Findings → Analysis → Conclusion. Use markdown headings.`,
    config: { 
      systemInstruction: `Current date and time: ${new Date().toLocaleString()}.`,
      maxOutputTokens: 8192 
    },
  });

  await streamSDKResponse(synthStream, onToken, signal);

  if (allSources.length) {
    onToken(`\n\n---\n**Sources:** ${allSources.join(' · ')}`);
    LOG('📚', `Report complete — ${allSources.length} total sources`);
  }

  LOG('📚', 'Deep Research DONE');
  onStageUpdate(null);
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN AGENT LOOP
// ─────────────────────────────────────────────────────────────────────────────
export async function runAgentLoop({
  messages, modelId, apiKey, geminiApiKey, localEndpoint,
  systemPrompt, signal, onToolUse, onToken, onThinking,
  onGoogleAgentMode,
}) {
  const groqKey = apiKey       || DEFAULT_KEYS.groq;
  const gemKey  = geminiApiKey || DEFAULT_KEYS.gemini;

  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  const prompt   = extractText(lastUser?.content) || '';
  const sysMsg   = systemPrompt || 'You are Beesto, a helpful AI assistant. Answer accurately and concisely.';

  LOG('🤖', `=== AGENT LOOP START ===`);
  LOG('🤖', `Model: ${modelId} | Prompt: "${prompt.slice(0, 80)}"`);

  // Helper: fires stage update + console log
  const onStageUpdate = (label) => {
    if (label) {
      LOG('📍', `Stage: ${label}`);
      onToolUse?.('__stage__', { label });
    } else {
      onToolUse?.('__stage__', { label: null });
    }
  };

  // Helper: fires tool badge + console log
  const fireTool = (name, args = {}) => {
    const ICONS = {
      get_weather:    '🌤️',
      search_web:     '🔍',
      research_topic: '📚',
      find_places:    '🗺️',
      Reasoner:       '🧠',
    };
    LOG('🔧', `Tool activated: ${name}`, args);
    onToolUse?.(name, args); // AppContext handles badge + stage
  };

  // ── PATH A: Reasoning models ──────────────────────────────────────────────
  const isReasoningModel =
    modelId === 'qwen/qwen3-32b' ||
    modelId === 'openai/gpt-oss-120b' ||
    !!localEndpoint;

  if (isReasoningModel) {
    LOG('🧠', `Reasoning model detected: ${modelId}`);
    fireTool('Reasoner', { info: 'Thinking...' });
    const endpoint = localEndpoint
      ? `${localEndpoint}/chat/completions`
      : 'https://api.groq.com/openai/v1/chat/completions';

    const loopMessages = [
      { role: 'system', content: sysMsg },
      ...[...messages].slice(-6).map(m => ({
        role: m.role,
        content: extractText(m.content).slice(0, 3000),
      })),
    ];

    const res = await fetch(endpoint, {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${groqKey}` },
      body: JSON.stringify({ model: modelId, messages: loopMessages, stream: true }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Reasoning model error ${res.status}`);
    }

    const reader  = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '', thoughtsAccumulated = '', answerBuffer = '';
    let lastRenderTime = Date.now(), answerStarted = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const clean = line.trim();
        if (!clean || clean === 'data: [DONE]' || !clean.startsWith('data: ')) continue;
        try {
          const parsed = JSON.parse(clean.slice(6));
          const delta  = parsed.choices?.[0]?.delta;
          if (!delta) continue;
          const rc = delta.reasoning_content ?? delta.reasoning ?? null;
          if (rc) thoughtsAccumulated += extractText(rc);
          if (delta.content) {
            const chunk = extractText(delta.content);
            if (chunk) {
              if (!answerStarted && thoughtsAccumulated) {
                LOG('🧠', `Thinking block complete — ${thoughtsAccumulated.length} chars`);
                onThinking?.(thoughtsAccumulated);
                answerStarted = true;
              }
              answerBuffer += chunk;
              const now = Date.now();
              if (now - lastRenderTime > 40) {
                onToken(answerBuffer);
                answerBuffer = '';
                lastRenderTime = now;
              }
            }
          }
        } catch { /* malformed SSE */ }
      }
    }
    if (answerBuffer) onToken(answerBuffer);
    if (!answerStarted && thoughtsAccumulated) onThinking?.(thoughtsAccumulated);
    LOG('🧠', 'Reasoning model DONE');
    return;
  }

  // ── PATH B: Gemini SDK ────────────────────────────────────────────────────
  LOG('✨', 'Using Gemini SDK path');

  if (!gemKey) {
    LOG('❌', 'No Gemini API key found');
    onToken('⚠️ **Gemini API key required for Agent Mode.** Add it in Settings → API Keys.');
    return;
  }

  const ai = new GoogleGenAI({ apiKey: gemKey });

  // Weather
  if (isWeatherPrompt(prompt)) {
    LOG('🌤️', 'Routing to: WEATHER');
    fireTool('get_weather', { location: prompt });
    try {
      const weatherData = await fetchWeather(prompt);
      const stream = await ai.models.generateContentStream({
        model: 'gemini-2.5-flash',
        contents: `The user asked: "${prompt}"\n\nReal-time weather data:\n${weatherData}\n\nGive a helpful, friendly weather response.`,
        config: { maxOutputTokens: 512 },
      });
      await streamSDKResponse(stream, onToken, signal);
      onStageUpdate(null);
      return;
    } catch (err) {
      LOG('🌤️', `Weather failed (${err.message}), falling back to search`);
    }
  }

  // Maps
  if (isMapsIntent(prompt)) {
    LOG('🗺️', 'Routing to: MAP GROUNDING');
    fireTool('find_places', { query: prompt });
    onGoogleAgentMode?.('map_grounding');
    try {
      return await runMapGrounding({ prompt, ai, onToken, onStageUpdate, signal });
    } finally {
      onGoogleAgentMode?.(null);
    }
  }

  // Deep Research
  if (isDeepResearchIntent(prompt)) {
    LOG('📚', 'Routing to: DEEP RESEARCH');
    fireTool('research_topic', { topic: prompt });
    onGoogleAgentMode?.('deep_research');
    try {
      return await runDeepResearch({ prompt, ai, onToken, onStageUpdate, signal });
    } finally {
      onGoogleAgentMode?.(null);
    }
  }

  // Default: Search Grounding
  LOG('🔍', 'Routing to: SEARCH GROUNDING (default)');
  fireTool('search_web', { query: prompt });
  onGoogleAgentMode?.('search_grounding');
  try {
    return await runSearchGrounding({ prompt, ai, onToken, onStageUpdate, signal });
  } finally {
    onGoogleAgentMode?.(null);
  }
}