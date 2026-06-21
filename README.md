# 🐝 Beesto AI — Core Orchestration & Security

> **Version: Core v6.1.0**  
> **Live Demo:** [beesto.online](https://beesto.online)  
> 🎥 **Demo Video:** [Watch on YouTube](https://youtu.be/K9rX2v_0SO8)  
> **Kaggle Hackathon Submission: AI Agents: Intensive Vibe Coding Capstone Project**

### 🤖 Beesto Core Models & Modes
Beesto operates in three specialized modes designed for code generation, agent orchestration, and full-workspace vibe coding:
- **Beesto IDE (`beesto-ide`)**: A fully autonomous workspace agent that handles project blueprinting, writing, patching/editing, and execution of files in real time. It communicates directly with our interactive terminal toolset.
- **Beesto (`beesto` / `beesto-orchestrator`)**: The default conversational agent with an always-on reasoning engine (`<think>` tags). It implements a multi-model fallback chain (Gemma 4 → Qwen 3 → GPT-OSS → Gemini) to ensure zero-downtime conversation.
- **Beesto Coder (`beesto-coder` / `beesto-parallel`)**: A code generation and sandboxing engine that supports single-turn or parallel multi-agent generation of React (`.jsx`) and Vanilla JS/CSS applications with real-time UI/UX previews.

---

### ⚠️ IMPORTANT: Demo Repository Notice
To protect **three months of proprietary development** from direct plagiarism and unauthorized copying during the Kaggle Hackathon, this repository contains the **curated core logic** of Beesto AI. 

We have included the files that represent our **AI agent architecture, multi-model routing, tool execution pipelines, and security/authentication layers**. Non-logic files (such as React page views, styled CSS components, and environment configurations) are omitted from this public repository. 

To experience the full operational system in real-time, please access the live application at:  
👉 **[https://beesto.online](https://beesto.online)**

---

## 🌟 Architecture Overview

Beesto AI is a full-stack AI agent orchestration platform providing access to 20+ AI models across multiple providers. The core implementation relies on three main architectural pillars included in this repository:

1. **Multi-Agent Orchestration & Fallback Routing (`Beesto-AI-M/src/utils/orchestrator.js` & `apiClient.js`)**
   - Implements a resilient model routing chain that detects user intent, automatically routes multi-modal attachments, and handles live API failovers.
   - Leverages a custom step-by-step thinking reasoner wrapped in `<think>` blocks.

2. **Multi-Framework Sandbox Engine (`Beesto-AI-M/src/utils/frameworks/`)**
   - Automatically detects whether the agent is generating React (`.jsx`) or Vanilla JS/CSS (`.js`) applications and executes compilation sandboxing rules under strict security presets.

3. **Secure User Isolation (`beesto-server/middleware/auth.js` & `routes/chats.js`)**
   - Protects backend APIs using Clerk Bearer token validation.
   - Isolates MongoDB queries at the database query level via `req.clerkUserId` so that no user's chat history or API key settings can ever be accessed by other sessions.

---

## 📁 Full Project Structure (Reference)
Below is the directory tree of the complete, operational Beesto AI application (including the components and configurations omitted from this public repo):

```
BEESTO-AI-MERN--master/
├── package.json                    ← Root (Google GenAI dependency)
├── Readme.md                       ← Main documentation
│
├── Beesto-AI-M/                    ← React Frontend (Vite v5) | Port 3000
│   ├── public/                     ← Static assets
│   │
│   ├── src/
│   │   ├── main.jsx                ← React entry point
│   │   ├── App.jsx                 ← Router + layout wrapper
│   │   ├── index.css               ← Tailwind CSS global styles
│   │   │
│   │   ├── components/             ← React components (Omitted in demo repo)
│   │   │   ├── chat/               ← Chat Area, Message List, Input Bar, Welcome Screen
│   │   │   ├── layout/             ← Sidebar, Header, Clerk Init, Theme Injector
│   │   │   ├── modals/             ← Settings Modal, API Keys Panel, Onboarding Wizard
│   │   │   ├── ui/                 ← Model Picker, Toasts, Lightbox, Visual Orchestrator Stage
│   │   │   └── settings/           ← Image Gen Panel
│   │   │
│   │   ├── context/                ← React Context (Global state)
│   │   │   ├── AppContext.jsx      ← State machine: chats, streaming, callback registers
│   │   │   └── AuthContext.jsx     ← [INCLUDED] Clerk user state & backend sync
│   │   │
│   │   ├── hooks/                  ← React Hooks (useChats, useSettings, useTimer)
│   │   │
│   │   ├── services/               ← API fetch layer with Clerk Token Injector
│   │   │
│   │   ├── utils/                  ← Core Logic Folder
│   │   │   ├── frameworks/         ← [INCLUDED] Multi-framework profiles (React / Vanilla)
│   │   │   │   ├── core.js         ← [INCLUDED] Shared sandbox security rules
│   │   │   │   ├── index.js        ← [INCLUDED] Framework router & detection
│   │   │   │   ├── react.js        ← [INCLUDED] React/Vite specifications
│   │   │   │   └── vanilla.js      ← [INCLUDED] Vanilla HTML/CSS/JS presets
│   │   │   │
│   │   │   ├── apiClient.js        ← [INCLUDED] Routing logic, streaming, model failover
│   │   │   ├── orchestrator.js     ← [INCLUDED] Multi-agent task reasoning chain
│   │   │   ├── agent.js            ← [INCLUDED] Tool definitions (search, weather, math)
│   │   │   ├── tools.js            ← [INCLUDED] Tool execution engine
│   │   │   ├── classifier.js       ← [INCLUDED] Intent classification utility
│   │   │   ├── fileProcessors.js   ← File text extractor (PDFs, audio)
│   │   │   └── markdown.js         ← GFM parser with highlighting
│   │   │
│   │   └── constants/              ← Static provider config (models.js, api.js)
│   │
│   ├── index.html                  ← Entry HTML
│   ├── package.json                ← Frontend dependencies
│   ├── vite.config.js              ← Dev proxies
│   └── tailwind.config.js          ← Tailwind configuration
│
└── beesto-server/                  ← Express.js Backend | Port 5000
    ├── server.js                   ← [INCLUDED] Main entry: middleware stack, routes, setup
    ├── package.json                ← Backend dependencies
    ├── config/                     
    │   └── db.js                   ← [INCLUDED] MongoDB Atlas Mongoose connection
    │
    ├── middleware/                 
    │   └── auth.js                 ← [INCLUDED] Clerk token validator & JWT Guard
    │
    ├── models/                     ← Mongoose database schemas (User, Chat, Settings)
    │
    ├── routes/                     
    │   ├── chats.js                ← [INCLUDED] Protected User Chat CRUD
    │   ├── settings.js             ← Settings CRUD
    │   ├── user.js                 ← User profiles
    │   ├── tools.js                ← tavily/wttr proxies
    │   └── cohere.js               ← Cohere SSE Streaming
    └── .env.example                ← Template configuration
```

---

## 🛠️ Deep Dive: Core Modules Included

### 1. Smart Model Routing (`Beesto-AI-M/src/utils/apiClient.js`)
Coordinates client-side model routing. It intercepts messages to determine:
- Whether the user requested image generation (routing to Google Imagen or Pollinations fallbacks).
- If specific tools are required (e.g., Tavily Web Search, News, or Math execution) via `classifier.js` and `tools.js`.
- Fallbacks to stream handlers for Google Gemini SDK, Groq, OpenAI, Anthropic, Mistral, and custom endpoints.

### 2. Thinking Agent Orchestrator (`Beesto-AI-M/src/utils/orchestrator.js`)
Implements an advanced fallback reasoning chain that guides models to output step-by-step thinking using native reasoning or prompt encapsulation inside `<think></think>` tags. The fallback sequence follows:
$$\text{Gemma 4 (31B)} \longrightarrow \text{Qwen 3 32B} \longrightarrow \text{GPT-OSS 120B} \longrightarrow \text{Gemini 3.1 Flash Lite}$$

### 3. Multi-Framework Code Sandbox (`Beesto-AI-M/src/utils/frameworks/`)
Enables vibe coding output templates. It matches the generated code blocks against specifications:
- `react.js`: Configures sandbox parameters to support `.jsx` React components running over Vite.
- `vanilla.js`: Configures sandboxing parameters for plain HTML5/CSS/JS execution.
- `core.js`: Implements the base sandbox boundary rules to prevent code injections or script escapes during execution.

### 4. Clerk Auth & MongoDB Security (`beesto-server/middleware/auth.js`)
Validates tokens passed in the `Authorization` header. On validation, it updates `req.clerkUserId`, which is then passed directly to database queries inside `routes/chats.js`:
```javascript
// Secured Chat retrieval inside routes/chats.js
router.get('/', requireAuth, async (req, res) => {
  try {
    const chats = await Chat.find({ userId: req.clerkUserId }).sort({ updatedAt: -1 });
    res.json(chats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

---

## 🏆 Kaggle Capstone Course Compliance
This project incorporates all key concepts taught in the Google and Kaggle AI Agents course:
- **System Instructions & Modalities**: Configured using direct SDK instructions (such as `systemInstruction` parameters).
- **Agent Orchestration**: Modular tool agents coordinating and falling back automatically.
- **Function Calling & Tool Use**: Safe sandboxed math evaluation, search pipelines, and multi-modal image descriptors.

For detailed information or questions regarding the implementation, feel free to inspect the logic code blocks in this repository or run our live application at [beesto.online](https://beesto.online).
