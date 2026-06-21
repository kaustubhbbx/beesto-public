export const CORE_SANDBOX_RULES = `
OUTPUT RULES:
1. Start every file with: // FILE: <relative/path/to/file.ext> (No markdown fences).
2. NEVER write completion markers (e.g. END_FILE) or closing tags (e.g. </html>, </body>, </script>, </svg>).
3. Write ONLY code or completion signal. When resuming, continue exactly where you left off.
4. Completion signals: Use exactly "[MORE]" (on a new line, if more code is needed) or "[DONE]" (on a new line, when absolutely finished). Do not use DONE inside comments/strings.
5. Follow the CONTRACT (CSS variables, classes, IDs, functions). Write only files in the FILE PLAN.
6. To edit a previously written file, re-emit it fully using standard "// FILE:" marker.
7. NO PLACEHOLDERS, NO ABBREVIATIONS, NO SHORTCUTS. Write all code/CSS/HTML fully.
8. Responsive Mandate: Include viewport meta; use Flex/Grid & relative units (rem, %, vw); use media queries (tablet max 768px, mobile max 480px); images/videos must be max-width:100%; height:auto; use semantic HTML.
9. Hyperlinks: Use relative paths; comment near placeholder/external links.
10. NO BROKEN IMAGES: NEVER use non-existent local image paths (like "placeholder.jpg", "logo.png"), and NEVER use "images.unsplash.com" or "source.unsplash.com". For images, ONLY use Picsum URLs with dimensions and a search query parameter 'q' representing the relevant photo keyword, plus a random query parameter for variety (e.g., "https://picsum.photos/800/600?q=bakery&random=1", "https://picsum.photos/800/600?q=croissant&random=2"). This allows the system to replace them with beautiful, relevant Pexels/Pixabay photos dynamically. Alternatively, write clean, self-contained inline SVG code/CSS gradients.
11. Pacing & Completeness: Do NOT compromise on detail or completeness to fit code within a single pass. If the code is long or you are reaching your token limit, output [MORE] on a new line and wait for the continuation pass. Only output [DONE] when all code is completely and fully implemented.
12. DESIGN EXECUTION STANDARD (non-negotiable):
    - Use ONLY the design tokens (colors, spacing, radius, shadows, fonts, transitions) defined in the CONTRACT — never hardcode ad-hoc hex values, pixel paddings, or font names that bypass them.
    - Every interactive element (buttons, links, nav items, cards, inputs) MUST define hover AND focus states with a transition of 150-300ms ease — no static, flat interactive elements.
    - Use box-shadow for elevation on cards, modals, dropdowns, and sticky nav — avoid flat, borderless, shadowless layouts.
    - Avoid pure #000/#fff for text/backgrounds — use the near-black/near-white tokens from the CONTRACT for softer contrast.
    - Body text: line-height 1.5–1.8. Section padding: min 4rem vertical on desktop, 2.5rem on mobile.
    - Vary the layout pattern of each major section per the design style preset's "Layout" spec — do NOT repeat the same centered single-column block for every section.
    - Implement at least one tasteful motion/microinteraction per page in pure CSS or small vanilla JS (e.g. IntersectionObserver for scroll-reveal) — no heavy animation libraries.
    - Style empty/loading/error states for any dynamic UI — never leave them as unstyled plain text.
`.trim();
