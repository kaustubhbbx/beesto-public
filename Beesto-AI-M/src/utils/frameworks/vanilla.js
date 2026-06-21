export default {
  id: 'vanilla',
  label: 'Vanilla HTML/CSS/JS',
  allowESModules: false,

  sandboxAdditions: `
13. JavaScript Connectivity: Do NOT use ES modules (import/export statements) in vanilla HTML/CSS/JS applications unless explicitly requested. Define all functions globally so they can be loaded via standard script tags.
`.trim(),

  blueprintAdditions: `
- For vanilla HTML/CSS/JS projects, the FIRST file is the main entry point (usually index.html).
- Group files into a logical, systematic folder structure. Group related files into subdirectories: css/, js/, etc. Do NOT dump all files in the root.
`.trim(),

  getSimpleRequestPlan: (request) => {
    if (!request) return null;
    const req = request.toLowerCase().trim();

    // 1. Check for single file indicators
    const isSingleFile =
      req.includes('single file') ||
      req.includes('one file') ||
      req.includes('all in one') ||
      req.includes('index.html only') ||
      req.includes('only one file') ||
      req.includes('only index.html') ||
      req.includes('all in index.html');

    if (isSingleFile) {
      return {
        type: 'single',
        files: [
          { path: 'index.html', description: 'Single-file application containing all HTML, CSS, and JavaScript inlined.', estimatedLines: 250 }
        ],
        contract: '/* Single-file App Contract - all code in index.html */'
      };
    }

    // 2. Check for simple application keywords
    const isSimpleApp =
      req.includes('calculator') ||
      req.includes('simple landing page') ||
      req.includes('simple widget') ||
      req.includes('todo list') ||
      req.includes('to-do list') ||
      req.includes('timer') ||
      req.includes('stopwatch') ||
      req.includes('weather app') ||
      req.includes('analog clock') ||
      req.includes('digital clock') ||
      req.includes('counter app');

    if (isSimpleApp) {
      return {
        type: 'simple',
        files: [
          { path: 'index.html', description: 'Main application entry point with HTML structure.', estimatedLines: 200 },
          { path: 'css/style.css', description: 'Application styles and responsive layouts.', estimatedLines: 100 },
          { path: 'js/app.js', description: 'Application logic and interactivity.', estimatedLines: 150 }
        ],
        contract: `/* CSS Variables */
:root {
  --primary: #3b82f6;
  --secondary: #1e293b;
  --background: #f8fafc;
  --text: #0f172a;
}
/* Import Links */
<link rel="stylesheet" href="css/style.css">
<script defer src="js/app.js"></script>`
      };
    }

    return null;
  },

  primaryExtensions: ['html', 'css', 'js'],
  detectionKeywords: [], // default fallback — matches nothing, used as the catch-all
};
