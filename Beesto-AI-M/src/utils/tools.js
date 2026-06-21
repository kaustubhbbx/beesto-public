// FILE: src/utils/tools.js
// Executes tools in parallel, returns context string + toolsUsed metadata.
// Every tool is individually try/catched — one failure never blocks others.
//
// BUGS FIXED:
//   [BUG] fetchSearch: only treated 503 as a silent skip. The server returns
//         500 when TAVILY_API_KEY is not set (the Tavily SDK throws, Express
//         catches it and sends 500). Fix: treat 4xx/5xx server-config errors
//         (500, 501, 503) as silent skips — only throw on genuine network/data errors.
//   [BUG] fetchNews: same 500-vs-503 issue, same fix applied.
//   [NOTE] 404 still throws a descriptive error so devs know the route is
//          not registered in server.js.

// ── Weather ───────────────────────────────────────────────────────────────────
async function fetchWeather(userMessage, signal) {
  const cityMatch =
    userMessage.match(/(?:weather|temperature|forecast|raining|rain|sunny|cloudy|hot|cold)\s+(?:in|for|at|like in)\s+([A-Za-z\s,]+?)(?:\?|$|today|tomorrow|right now|currently)/i) ||
    userMessage.match(/(?:in|for|at)\s+([A-Za-z\s,]{2,25})(?:\?|$|\s*(?:right now|today|currently))/i);

  const city = cityMatch ? cityMatch[1].trim().replace(/\s+$/, '') : 'auto';

  const res = await fetch(
    `https://wttr.in/${encodeURIComponent(city)}?format=j1`,
    { signal }
  );
  if (!res.ok) throw new Error('Weather fetch failed');
  const data = await res.json();
  const c = data.current_condition?.[0];
  if (!c) throw new Error('No weather data');

  const cityName    = data.nearest_area?.[0]?.areaName?.[0]?.value || city;
  const country     = data.nearest_area?.[0]?.country?.[0]?.value  || '';
  const locationStr = country ? `${cityName}, ${country}` : cityName;

  return {
    text: `Current weather in ${locationStr}: ${c.temp_C}°C (feels like ${c.FeelsLikeC}°C), ${c.weatherDesc?.[0]?.value}, humidity ${c.humidity}%, wind ${c.windspeedKmph} km/h.`,
    meta: { icon: '🌤️', label: `Weather: ${cityName}` },
  };
}

// ── Math ──────────────────────────────────────────────────────────────────────
async function fetchMath(userMessage, signal) {
  const opMatch = userMessage.match(
    /(\d[\d\s]*(?:[+\-*/^%().]|\d)+[\d\s]*(?:sqrt|sin|cos|tan|log|pi|e)?[\d\s]*)/i
  );

  const wordMatch =
    userMessage.match(/([\d.]+)\s*(?:times|multiplied by|x)\s*([\d.]+)/i) ||
    userMessage.match(/([\d.]+)\s*(?:plus|added to)\s*([\d.]+)/i)         ||
    userMessage.match(/([\d.]+)\s*(?:minus|subtract(?:ed)?)\s*([\d.]+)/i)  ||
    userMessage.match(/([\d.]+)\s*(?:divided by|over)\s*([\d.]+)/i)        ||
    userMessage.match(/([\d.]+)\s*(?:to the power of|\^)\s*([\d.]+)/i);

  let expr = null;

  if (opMatch) {
    expr = opMatch[1].replace(/\s+/g, '').trim();
  } else if (wordMatch) {
    const a = wordMatch[1]; const b = wordMatch[2];
    if (/times|multiplied|x/i.test(userMessage))  expr = `${a}*${b}`;
    else if (/plus|added/i.test(userMessage))      expr = `${a}+${b}`;
    else if (/minus|subtract/i.test(userMessage))  expr = `${a}-${b}`;
    else if (/divided|over/i.test(userMessage))    expr = `${a}/${b}`;
    else if (/power/i.test(userMessage))            expr = `${a}^${b}`;
  }

  if (!expr) {
    const bare = userMessage.match(/\d+\s*[+\-*/^%]\s*\d+(?:\s*[+\-*/^%]\s*\d+)*/);
    if (bare) expr = bare[0].replace(/\s+/g, '');
  }

  if (!expr) throw new Error('No valid math expression found');

  const res = await fetch(`https://api.mathjs.org/v4/?expr=${encodeURIComponent(expr)}`, { signal });
  if (!res.ok) throw new Error(`Math API failed: ${res.status}`);
  const result = await res.text();
  if (result.includes('Error') || result.includes('SyntaxError')) throw new Error('Math parse error: ' + result);

  return {
    text: `Mathematical result: ${expr} = ${result.trim()}`,
    meta: { icon: '🧮', label: 'Calculator' },
  };
}

// ── Web Search ────────────────────────────────────────────────────────────────
// FIXED: 500 (Tavily key not set) is now a silent skip, same as 503.
//        Only 404 throws — that means the route is not registered in server.js.
async function fetchSearch(userMessage, signal) {
  const query = userMessage
    .replace(/^(search for|look up|find|tell me about|google|what is|who is|who won)\s+/i, '')
    .replace(/[?!]+$/, '')
    .trim()
    .slice(0, 200);

  let res;
  try {
    res = await fetch(`/api/tools/search?q=${encodeURIComponent(query)}`, { signal });
  } catch (networkErr) {
    // Network-level failure (server not running) — silent skip
    console.warn('[Tool: search] Network error — server may be offline:', networkErr.message);
    return null;
  }

  // 404 = route not wired up → tell the dev explicitly
  if (res.status === 404) {
    throw new Error('Search route not registered in server.js — add: app.use("/api/tools", require("./routes/tools"))');
  }

  // 500 / 501 / 503 = server-side config issue (missing API key, upstream crash)
  // These are non-fatal — return null so the AI answers without search context.
  if (res.status === 500 || res.status === 501 || res.status === 503) {
    console.warn(`[Tool: search] Server returned ${res.status} — Tavily key may not be configured. Skipping silently.`);
    return null;
  }

  if (!res.ok) throw new Error(`Search failed: ${res.status}`);

  const data = await res.json();
  let text = '';
  if (data.answer)        text += `Summary: ${data.answer}\n`;
  if (data.results?.length) {
    text += data.results.map(r => `• ${r.title}: ${r.snippet}`).join('\n');
  }
  if (!text.trim()) return null;

  return {
    text: `[Web Search Results for "${query}"]\n${text.trim()}`,
    meta: { icon: '🔍', label: 'Web search' },
  };
}

// ── News ──────────────────────────────────────────────────────────────────────
// FIXED: same 500-vs-503 silent-skip fix as fetchSearch.
async function fetchNews(userMessage, signal) {
  const query = userMessage
    .replace(/\b(latest|recent|news|headlines|about|on|for|what'?s|today'?s|breaking|show me|give me)\b/gi, '')
    .replace(/[?!]+$/, '')
    .trim()
    .slice(0, 200) || userMessage.trim().slice(0, 200);

  let res;
  try {
    res = await fetch(`/api/tools/news?q=${encodeURIComponent(query)}`, { signal });
  } catch (networkErr) {
    console.warn('[Tool: news] Network error — server may be offline:', networkErr.message);
    return null;
  }

  if (res.status === 404) {
    throw new Error('News route not registered — add tools route to server.js');
  }

  if (res.status === 500 || res.status === 501 || res.status === 503) {
    console.warn(`[Tool: news] Server returned ${res.status} — NewsAPI key may not be configured. Skipping silently.`);
    return null;
  }

  if (!res.ok) throw new Error(`News failed: ${res.status}`);

  const data = await res.json();
  if (!data.articles?.length) return null;

  const text = data.articles.map(a => {
    const date = a.publishedAt ? new Date(a.publishedAt).toLocaleDateString('en-IN') : '';
    return `• [${a.source || 'News'}${date ? ', ' + date : ''}] ${a.title}${a.description ? ': ' + a.description : ''}`;
  }).join('\n');

  return {
    text: `[Latest News about "${query}"]\n${text}`,
    meta: { icon: '📰', label: 'News' },
  };
}

// ── Master runner — parallel execution ────────────────────────────────────────
export async function runTools(toolNames, userMessage, signal) {
  if (!toolNames?.length) return { contextString: '', toolsUsed: [] };

  const runners = {
    weather: fetchWeather,
    math:    fetchMath,
    search:  fetchSearch,
    news:    fetchNews,
  };

  const results = await Promise.all(
    toolNames.map(async (name) => {
      if (!runners[name]) return null;
      try {
        return await runners[name](userMessage, signal);
      } catch (err) {
        console.warn(`[Tool: ${name}] failed (non-fatal):`, err.message);
        return null;
      }
    })
  );

  const successful = results.filter(Boolean);

  const contextString = successful.length
    ? '\n\n=== LIVE TOOL DATA (use this to answer — do NOT say you cannot access real-time info) ===\n' +
      successful.map(r => r.text).join('\n\n') +
      '\n==='
    : '';

  const toolsUsed = successful.map(r => r.meta);

  return { contextString, toolsUsed };
}