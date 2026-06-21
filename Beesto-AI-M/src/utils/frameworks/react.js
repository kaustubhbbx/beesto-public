export default {
  id: 'react',
  label: 'React (Vite)',
  allowESModules: true,

  sandboxAdditions: `
13. Module & Component Rules:
    - Use ES modules (import/export) throughout. No global script-tag style code.
    - Functional components + hooks ONLY (useState, useEffect, useContext, etc.) — no class components.
    - One component per file, PascalCase filenames (e.g. src/components/Navbar.jsx).
    - ALWAYS specify explicit '.jsx' extensions for relative imports of React components (e.g. use "import MyComponent from './MyComponent.jsx'" instead of "import MyComponent from './MyComponent'").
    - State/data shared across components MUST follow the ownership defined in the CONTRACT (lift to a parent, or a context defined in src/context/).
    - package.json must list every dependency actually imported, with realistic version ranges. Include "dev" and "build" scripts for Vite.
    - Limit the project size: never create more than 8 files in total, and limit components under "src/components/" to a maximum of 4 files.
14. React State & Variable Safety:
    - NEVER write or assign global state directly to window properties (like 'window.portfolioData.activeSection = ...' or 'window.activeSection'). Always use standard React state hooks (useState/useContext) or lift state up to share values.
    - Prevent runtime crashes: ALWAYS check if refs or asynchronous objects are defined before writing properties, and use optional chaining (e.g. 'settings?.activeSection' or 'state?.activeSection') when accessing properties of potentially uninitialized values to avoid 'Cannot set properties of undefined (setting activeSection)' type errors.
`.trim(),

  blueprintAdditions: `
- React projects use this structure: package.json, vite.config.js, index.html (Vite entry), src/main.jsx, src/App.jsx, src/components/*.jsx, src/index.css.
- Keep sandbox scale small: do not plan or generate more than 8 files in total, and limit components under "src/components/" to a maximum of 4 files.
- ALWAYS specify explicit '.jsx' extensions in relative import paths when describing components in the CONTRACT or planning files.
- The CONTRACT must additionally define: each shared component's prop interface (name + types), where global state lives, and any context/provider names.
`.trim(),

  getSimpleRequestPlan: (request) => {
    if (!request) return null;
    const req = request.toLowerCase();
    if (req.includes('single component') || req.includes('one component')) {
      return {
        type: 'single',
        files: [
          { path: 'src/App.jsx', description: 'Single-component React app.', estimatedLines: 150 },
          { path: 'src/main.jsx', description: 'Vite/React entry point.', estimatedLines: 10 },
          { path: 'src/index.css', description: 'Global styles.', estimatedLines: 80 },
          { path: 'package.json', description: 'Dependencies and scripts.', estimatedLines: 20 },
          { path: 'index.html', description: 'Vite HTML entry.', estimatedLines: 15 },
        ],
        contract: `/* CSS Variables */\n:root { --primary: #2563eb; }\n/* Components */\nApp.jsx — owns all state`
      };
    }
    return null; // fall through to the generic blueprint pass
  },

  primaryExtensions: ['jsx', 'tsx', 'css', 'json'],
  detectionKeywords: ['react', 'jsx', 'usestate', 'useeffect', 'vite react', 'react app', 'react component'],
};
