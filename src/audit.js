const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const GENESIS_HASH = '0'.repeat(64);
const LOG_PATH = process.env.COUNTERFLOW_AUDIT || path.join(__dirname, '..', 'audit.jsonl');

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}';
}

function computeHash(prevHash, dataWithoutHash) {
  const combined = Buffer.concat([
    Buffer.from(prevHash, 'utf-8'),
    Buffer.from(canonicalJson(dataWithoutHash), 'utf-8'),
  ]);
  return crypto.createHash('sha256').update(combined).digest('hex');
}

function chainHead() {
  if (!fs.existsSync(LOG_PATH)) return GENESIS_HASH;
  const lines = fs.readFileSync(LOG_PATH, 'utf-8').trim().split('\n').filter(Boolean);
  if (lines.length === 0) return GENESIS_HASH;
  return JSON.parse(lines[lines.length - 1]).hash;
}

function logRun({ contractPath, contractSha256, invariantsText, binding, bindingSource, verdict, solverOutput, llmUsage, durationMs }) {
  const prev = chainHead();
  const dataWithoutHash = {
    entry_id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    contract_path: contractPath,
    contract_sha256: contractSha256,
    invariants_text: invariantsText,
    binding: JSON.stringify(binding),
    binding_source: bindingSource,
    verdict,
    solver_output_sha256: crypto.createHash('sha256').update(JSON.stringify(solverOutput)).digest('hex'),
    llm_provider: llmUsage?.provider || null,
    llm_model: llmUsage?.model || null,
    llm_input_tokens: llmUsage?.inputTokens || 0,
    llm_output_tokens: llmUsage?.outputTokens || 0,
    duration_ms: durationMs,
    prev_hash: prev,
  };
  const hash = computeHash(prev, dataWithoutHash);
  const entry = { ...dataWithoutHash, hash };
  fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + '\n');
  return entry.entry_id;
}

function verifyChain() {
  if (!fs.existsSync(LOG_PATH)) return { valid: true, entries: 0 };
  const lines = fs.readFileSync(LOG_PATH, 'utf-8').trim().split('\n').filter(Boolean);
  let expectedPrev = GENESIS_HASH;
  for (let i = 0; i < lines.length; i++) {
    const entry = JSON.parse(lines[i]);
    const { hash, ...data } = entry;
    if (entry.prev_hash !== expectedPrev) {
      return { valid: false, broken_at: i, error: `prev_hash mismatch at entry ${i}` };
    }
    if (hash !== computeHash(entry.prev_hash, data)) {
      return { valid: false, broken_at: i, error: `hash mismatch at entry ${i}` };
    }
    expectedPrev = hash;
  }
  return { valid: true, entries: lines.length };
}

module.exports = { logRun, verifyChain, LOG_PATH, GENESIS_HASH };
