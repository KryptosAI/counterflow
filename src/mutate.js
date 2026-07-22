const { runSolver } = require('./verify');

function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

function generateMutations(binding) {
  const mutations = [];
  const fns = binding.functions || [];
  for (let i = 0; i < fns.length; i++) {
    const fn = fns[i];
    const guards = fn.guards || [];
    const effects = fn.effects || [];
    // Drop a guard
    for (const g of guards) {
      const m = deepClone(binding);
      m.functions[i].guards = guards.filter(x => x !== g);
      mutations.push({ type: 'drop_guard', function: fn.name, detail: `removed guard: ${g}`, binding: m });
    }
    // Drop an effect
    for (const e of effects) {
      const m = deepClone(binding);
      m.functions[i].effects = effects.filter(x => x !== e);
      mutations.push({ type: 'drop_effect', function: fn.name, detail: `removed effect: ${e}`, binding: m });
    }
    // Invert add↔sub effects
    for (let j = 0; j < effects.length; j++) {
      const e = effects[j];
      const inverted = e.includes('_add') ? e.replace('_add', '_sub') : e.includes('_sub') ? e.replace('_sub', '_add') : null;
      if (inverted && effects.includes(inverted)) continue;
      if (inverted) {
        const m = deepClone(binding);
        m.functions[i].effects = [...effects];
        m.functions[i].effects[j] = inverted;
        mutations.push({ type: 'invert_effect', function: fn.name, detail: `${e} → ${inverted}`, binding: m });
      }
    }
  }
  return mutations;
}

function runMutations(binding, opts = {}) {
  const mutations = generateMutations(binding);
  const maxMutations = opts.max != null ? opts.max : 50;
  const subset = mutations.slice(0, maxMutations);
  const baseResult = runSolver(binding);
  const baseVerdict = baseResult.ok ? baseResult.output.verdict : 'error';

  const results = [];
  let caught = 0;
  let missed = 0;

  for (const mut of subset) {
    const r = runSolver(mut.binding);
    const mutVerdict = r.ok ? r.output.verdict : 'error';
    const isCaught = baseVerdict === 'proved' && mutVerdict === 'violated';

    results.push({
      type: mut.type, function: mut.function, detail: mut.detail,
      baseVerdict, mutatedVerdict: mutVerdict, caught: isCaught,
    });
    if (isCaught) caught++; else missed++;
  }

  const total = subset.length;
  return {
    baseVerdict, totalMutations: total, caught, missed,
    score: total > 0 ? Math.round((caught / total) * 100) : 100,
    results,
  };
}

module.exports = { generateMutations, runMutations };
