import vanilla from './vanilla.js';
import react from './react.js';
import { CORE_SANDBOX_RULES } from './core.js';
import { pickDesignPreset, getPresetById } from './presets/index.js';

export const FRAMEWORKS = { vanilla, react /*, vue, nextjs, ... */ };

export function detectFramework(userRequest, sandboxFiles) {
  // 1. Try to detect from existing files in the sandbox first (highest priority)
  if (sandboxFiles && Object.keys(sandboxFiles).length > 0) {
    const detected = detectFrameworkFromFiles(sandboxFiles);
    if (detected && detected.id !== 'vanilla') {
      return detected;
    }
  }

  // 2. Fallback to keywords in the user request
  const req = (userRequest || '').toLowerCase();
  for (const profile of Object.values(FRAMEWORKS)) {
    if (profile.detectionKeywords && profile.detectionKeywords.some(k => req.includes(k))) {
      return profile;
    }
  }
  return FRAMEWORKS.vanilla; // default — preserves current behavior
}

export function resolveProfile(explicitId, userRequest, sandboxFiles) {
  if (explicitId && FRAMEWORKS[explicitId]) {
    return FRAMEWORKS[explicitId];
  }
  return detectFramework(userRequest, sandboxFiles);
}

export function buildSandboxInjection(profile) {
  return [CORE_SANDBOX_RULES, profile.sandboxAdditions].filter(Boolean).join('\n\n');
}

export function buildBlueprintSystem(BLUEPRINT_SYSTEM_BASE, profile) {
  return [BLUEPRINT_SYSTEM_BASE, profile.blueprintAdditions].filter(Boolean).join('\n\n');
}

export function buildPlannerSystem(PLANNER_SYSTEM_BASE, profile) {
  return [PLANNER_SYSTEM_BASE, profile.blueprintAdditions].filter(Boolean).join('\n\n');
}

export function detectFrameworkFromFiles(sandboxFiles) {
  if (!sandboxFiles) return FRAMEWORKS.vanilla;
  const paths = Object.keys(sandboxFiles);
  const hasReactFiles = paths.some(p => {
    const ext = p.split('.').pop().toLowerCase();
    return ext === 'jsx' || ext === 'tsx' || p.includes('src/main.jsx') || p.includes('src/App.jsx');
  });
  if (hasReactFiles) return FRAMEWORKS.react;
  
  const pkgPath = paths.find(p => p.endsWith('package.json'));
  if (pkgPath && sandboxFiles[pkgPath]) {
    try {
      const pkg = JSON.parse(sandboxFiles[pkgPath]);
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps.react || deps['react-dom']) {
        return FRAMEWORKS.react;
      }
    } catch (e) {}
  }
  return FRAMEWORKS.vanilla;
}

export function resolvePresetIdBySuggestion(suggestion) {
  if (!suggestion || typeof suggestion !== 'string') return null;
  const s = suggestion.toLowerCase().trim();
  
  if (s.includes('design-01') || s.includes('neo-brutalist') || s.includes('neobrutalist') || s.includes('brutalist') || s.includes('brutalism')) {
    return 'DESIGN-01';
  }
  if (s.includes('design-02') || s.includes('soft-editorial') || s.includes('editorial') || s.includes('magazine') || s.includes('serif')) {
    return 'DESIGN-02';
  }
  if (s.includes('design-03') || s.includes('dark-saas') || s.includes('saas') || s.includes('dark dashboard') || s.includes('dashboard')) {
    return 'DESIGN-03';
  }
  if (s.includes('design-04') || s.includes('warm-organic') || s.includes('organic') || s.includes('lifestyle') || s.includes('friendly') || s.includes('wellness') || s.includes('warm organic')) {
    return 'DESIGN-04';
  }
  if (s.includes('design-05') || s.includes('glassmorphic') || s.includes('glassmorphism') || s.includes('glass panel') || s.includes('glassmorphic vibrant')) {
    return 'DESIGN-05';
  }
  if (s.includes('design-06') || s.includes('luxury') || s.includes('monochrome') || s.includes('mono-luxury') || s.includes('premium')) {
    return 'DESIGN-06';
  }
  if (s.includes('design-07') || s.includes('playful') || s.includes('maximalist') || s.includes('playful-max') || s.includes('playful maximalist')) {
    return 'DESIGN-07';
  }
  if (s.includes('design-08') || s.includes('fintech') || s.includes('corporate') || s.includes('trust') || s.includes('finance') || s.includes('fintech-trust')) {
    return 'DESIGN-08';
  }
  return null;
}

export function buildGenerationDirective(framework, userRequest, presetId, sandboxFiles) {
  const profile = resolveProfile(framework, userRequest, sandboxFiles);
  
  let selectedPresetId = presetId;
  if (!selectedPresetId && userRequest) {
    selectedPresetId = resolvePresetIdBySuggestion(userRequest);
  }
  
  const preset = selectedPresetId ? getPresetById(selectedPresetId) : pickDesignPreset();
  return { profile, preset };
}


