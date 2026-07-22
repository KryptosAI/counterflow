const fs = require('fs');
const path = require('path');

function normalizeName(name) {
  return (name || '').toLowerCase().trim();
}

function setDiff(a, b) {
  const bSet = new Set((b || []).map(normalizeName));
  return (a || []).filter(item => !bSet.has(normalizeName(item)));
}

function intersect(a, b) {
  const bSet = new Set((b || []).map(normalizeName));
  return (a || []).filter(item => bSet.has(normalizeName(item)));
}

function lookupFunction(binding, name) {
  if (!binding || !Array.isArray(binding.functions)) return null;
  const norm = normalizeName(name);
  return binding.functions.find(fn => normalizeName(fn.name) === norm) || null;
}

function functionNames(binding) {
  if (!binding || !Array.isArray(binding.functions)) return [];
  return binding.functions.map(fn => normalizeName(fn.name));
}

function formatList(items) {
  if (!items || items.length === 0) return 'none';
  return items.join(', ');
}

function buildMessage(type, fnName, llmItems, slitherItems, slitherFn, contractPath) {
  const slitherList = formatList(slitherItems);
  const llmList = formatList(llmItems);
  const lines = slitherFn?.source_lines;
  const lineRef = lines && lines.length > 0 ? ` at line ${lines[0]}` : '';

  const templates = {
    MISSING_GUARD: `Slither found ${slitherList} guard(s)${lineRef}, but LLM binding omits it`,
    EXTRA_GUARD: `LLM binding claims ${llmList} guard(s) but no corresponding check found in source`,
    MISSING_EFFECT: `Slither found ${slitherList} effect(s)${lineRef}, but LLM binding omits it`,
    EXTRA_EFFECT: `LLM binding claims ${llmList} effect(s) but not present in source`,
    WRONG_EFFECT: `LLM binding uses ${llmList} but source suggests ${slitherList}`,
    MISSING_FUNCTION: `function ${fnName} found in source${lineRef} but missing from LLM binding`,
    EXTRA_FUNCTION: `function ${fnName} found in LLM binding but not in source`,
  };

  return templates[type] || `${type}: ${fnName}`;
}

function allMismatched(fnName, llmGuards, slitherGuards, llmEffects, slitherEffects, slitherFn, contractPath) {
  const results = [];
  const sfConfidence = slitherFn?.confidence || 'HIGH';

  const missingGuards = setDiff(slitherGuards, llmGuards);
  const extraGuards = setDiff(llmGuards, slitherGuards);
  const missingEffects = setDiff(slitherEffects, llmEffects);
  const extraEffects = setDiff(llmEffects, slitherEffects);

  for (const g of missingGuards) {
    results.push({
      function: fnName,
      type: 'MISSING_GUARD',
      llm: [],
      slither: [g],
      confidence: sfConfidence,
      message: buildMessage('MISSING_GUARD', fnName, [], [g], slitherFn, contractPath),
    });
  }

  for (const g of extraGuards) {
    results.push({
      function: fnName,
      type: 'EXTRA_GUARD',
      llm: [g],
      slither: [],
      confidence: sfConfidence === 'HIGH' ? 'HIGH' : 'MEDIUM',
      message: buildMessage('EXTRA_GUARD', fnName, [g], [], slitherFn, contractPath),
    });
  }

  for (const e of missingEffects) {
    results.push({
      function: fnName,
      type: 'MISSING_EFFECT',
      llm: [],
      slither: [e],
      confidence: sfConfidence,
      message: buildMessage('MISSING_EFFECT', fnName, [], [e], slitherFn, contractPath),
    });
  }

  for (const e of extraEffects) {
    const hasSlitherEffects = slitherEffects.length > 0;
    const diffType = hasSlitherEffects ? 'WRONG_EFFECT' : 'EXTRA_EFFECT';
    results.push({
      function: fnName,
      type: diffType,
      llm: [e],
      slither: hasSlitherEffects ? slitherEffects.slice(0, 1) : [],
      confidence: hasSlitherEffects ? sfConfidence : (sfConfidence === 'HIGH' ? 'MEDIUM' : sfConfidence),
      message: buildMessage(diffType, fnName, [e], hasSlitherEffects ? slitherEffects.slice(0, 1) : [], slitherFn, contractPath),
    });
  }

  return results;
}

function countByType(differences, type) {
  return differences.filter(d => d.type === type).length;
}

/**
 * Compare an LLM-generated binding against a Slither-extracted ground-truth binding
 * and surface discrepancies.
 *
 * @param {object} previousLLMBinding - The LLM-generated binding object
 * @param {object} slitherExtraction  - The Slither-extracted ground-truth binding object
 * @param {string} [contractPath]     - Path to the source contract for file references in messages
 * @returns {object} A diff report JSON
 */
function diff(previousLLMBinding, slitherExtraction, contractPath) {
  const llmBinding = previousLLMBinding;
  const slitherBinding = slitherExtraction;

  if (!llmBinding || !slitherBinding) {
    return {
      summary: {
        total_functions: 0,
        matched: 0,
        guard_mismatches: 0,
        effect_mismatches: 0,
        missing_functions: 0,
        extra_functions: 0,
      },
      differences: [],
      error: 'Both previousLLMBinding and slitherExtraction are required',
    };
  }

  const llmFnNames = functionNames(llmBinding);
  const slitherFnNames = functionNames(slitherBinding);
  const matchedNames = intersect(llmFnNames, slitherFnNames);
  const onlyLlm = setDiff(llmFnNames, slitherFnNames);
  const onlySlither = setDiff(slitherFnNames, llmFnNames);

  const differences = [];

  for (const name of onlySlither) {
    const sf = lookupFunction(slitherBinding, name);
    differences.push({
      function: name,
      type: 'MISSING_FUNCTION',
      llm: null,
      slither: sf ? { guards: sf.guards || [], effects: sf.effects || [] } : null,
      confidence: sf?.confidence || 'HIGH',
      message: buildMessage('MISSING_FUNCTION', name, [], [], sf, contractPath),
    });
  }

  for (const name of onlyLlm) {
    const lf = lookupFunction(llmBinding, name);
    differences.push({
      function: name,
      type: 'EXTRA_FUNCTION',
      llm: lf ? { guards: lf.guards || [], effects: lf.effects || [] } : null,
      slither: null,
      confidence: 'MEDIUM',
      message: buildMessage('EXTRA_FUNCTION', name, [], [], null, contractPath),
    });
  }

  for (const name of matchedNames) {
    const lf = lookupFunction(llmBinding, name);
    const sf = lookupFunction(slitherBinding, name);
    const llmGuards = lf?.guards || [];
    const slitherGuards = sf?.guards || [];
    const llmEffects = lf?.effects || [];
    const slitherEffects = sf?.effects || [];

    const mismatches = allMismatched(name, llmGuards, slitherGuards, llmEffects, slitherEffects, sf, contractPath);
    differences.push(...mismatches);
  }

  const totalFunctions = Math.max(llmFnNames.length, slitherFnNames.length);
  const guardMismatchTypes = ['MISSING_GUARD', 'EXTRA_GUARD'];
  const effectMismatchTypes = ['MISSING_EFFECT', 'EXTRA_EFFECT', 'WRONG_EFFECT'];

  const guardMismatches = guardMismatchTypes.reduce((sum, t) => sum + countByType(differences, t), 0);
  const effectMismatches = effectMismatchTypes.reduce((sum, t) => sum + countByType(differences, t), 0);

  return {
    summary: {
      total_functions: totalFunctions,
      matched: matchedNames.length,
      guard_mismatches: guardMismatches,
      effect_mismatches: effectMismatches,
      missing_functions: onlySlither.length,
      extra_functions: onlyLlm.length,
    },
    differences,
  };
}

/**
 * Merge the Slither ground truth into the LLM binding.
 * Slither data overrides LLM data for matched functions; Slither-only functions
 * are appended; LLM-only functions are kept for review with a _origin flag.
 *
 * @param {object} llmBinding    - The LLM-generated binding
 * @param {object} slitherBinding - The Slither-extracted ground-truth binding
 * @returns {object} A merged binding suggestion
 */
function generateSuggestedBinding(llmBinding, slitherBinding) {
  if (!llmBinding && !slitherBinding) return null;
  const base = llmBinding
    ? JSON.parse(JSON.stringify(llmBinding))
    : { model: 'erc20_pool', functions: [], invariants: [], invariant_mapping: [] };

  if (!slitherBinding || !Array.isArray(slitherBinding.functions)) {
    return base;
  }

  const slitherFnNames = functionNames(slitherBinding);
  const baseFnLookup = new Map();
  for (const fn of base.functions || []) {
    baseFnLookup.set(normalizeName(fn.name), fn);
  }

  const mergedFunctions = [];

  for (const sf of slitherBinding.functions) {
    const key = normalizeName(sf.name);
    const existing = baseFnLookup.get(key);
    if (existing) {
      mergedFunctions.push({
        name: existing.name,
        guards: sf.guards || [],
        effects: sf.effects || [],
        _merged: true,
        _origin: 'slither',
        _confidence: sf.confidence || null,
      });
      baseFnLookup.delete(key);
    } else {
      mergedFunctions.push({
        name: sf.name,
        guards: sf.guards || [],
        effects: sf.effects || [],
        _merged: true,
        _origin: 'slither',
        _confidence: sf.confidence || null,
      });
    }
  }

  for (const remaining of baseFnLookup.values()) {
    mergedFunctions.push({
      ...remaining,
      _origin: 'llm',
      _review: true,
    });
  }

  base.functions = mergedFunctions;

  if (Array.isArray(slitherBinding.invariants) && slitherBinding.invariants.length > 0) {
    base.invariants = slitherBinding.invariants;
  }

  if (Array.isArray(slitherBinding.invariant_mapping) && slitherBinding.invariant_mapping.length > 0) {
    base.invariant_mapping = slitherBinding.invariant_mapping;
  }

  return base;
}

module.exports = { diff, generateSuggestedBinding };
