const { GUARDS, EFFECTS, INVARIANTS } = require('./translate');

const KNOWN_MODELS = [
  'erc20_pool', 'amm_pool', 'lending_pool', 'staking_pool', 'cross_contract',
];

function validateBinding(binding) {
  const errors = [];

  if (!binding || typeof binding !== 'object') {
    return { valid: false, errors: ['binding is not an object'] };
  }
  if (!KNOWN_MODELS.includes(binding.model)) {
    errors.push(`unknown model: ${binding.model}`);
  }
  if (!Array.isArray(binding.functions) || binding.functions.length === 0) {
    errors.push('binding.functions must be a non-empty array');
  } else {
    binding.functions.forEach((fn, i) => {
      if (!fn.name || typeof fn.name !== 'string') {
        errors.push(`functions[${i}].name missing`);
      }
      const guards = fn.guards || [];
      const effects = fn.effects || [];
      if (!Array.isArray(guards)) errors.push(`functions[${i}].guards not an array`);
      if (!Array.isArray(effects)) errors.push(`functions[${i}].effects not an array`);
      for (const g of guards) {
        if (!GUARDS.includes(g)) errors.push(`functions[${i}] unknown guard: ${g}`);
      }
      for (const e of effects) {
        if (!EFFECTS.includes(e)) errors.push(`functions[${i}] unknown effect: ${e}`);
      }
    });
  }
  const invariants = binding.invariants || [];
  if (!Array.isArray(invariants) || invariants.length === 0) {
    errors.push('binding.invariants must be a non-empty array');
  } else {
    for (const inv of invariants) {
      if (!INVARIANTS.includes(inv)) errors.push(`unknown invariant: ${inv}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

module.exports = { validateBinding, KNOWN_MODELS };
