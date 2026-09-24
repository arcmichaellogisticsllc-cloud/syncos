'use strict';
const { createHash } = require('node:crypto');

// Internal normalized contract, NOT a claim about Passport's wire JSON/statuses.
const statuses = new Set(['pending', 'completed', 'failed', 'returned', 'reversed']);
const terminal = new Set(['failed', 'returned', 'reversed']);
const id = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(value);
function money(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,12})\.\d{2}$/.test(value)) throw new Error('Amount must be a decimal string with two places');
  return BigInt(value.replace('.', ''));
}
function normalize(input) {
  for (const key of ['customerId','accountId','transactionId','payeeId']) if (!id(input[key])) throw new Error(`Invalid ${key}`);
  if (!statuses.has(input.status) || input.direction !== 'outgoing' || !/^[A-Z]{3}$/.test(input.currency)) throw new Error('Unrecognized transaction contract');
  if (money(input.amount) <= 0n) throw new Error('Amount must be positive');
  if (!Number.isSafeInteger(input.version) || input.version < 1) throw new Error('Authoritative monotonic version required');
  if (input.status === 'completed' && (!/^\d{4}-\d{2}-\d{2}$/.test(input.completedDate || '') || !Number.isFinite(Date.parse(input.completedDate)) || new Date(input.completedDate).toISOString().slice(0,10) !== input.completedDate)) throw new Error('Valid completion date required');
  // Allowlist only; never persist bank data, credentials or the raw provider body.
  return Object.fromEntries(['customerId','accountId','transactionId','payeeId','status','direction','currency','amount','version','completedDate'].filter(k => input[k] !== undefined).map(k => [k,input[k]]));
}
const keyOf = t => JSON.stringify([t.customerId,t.accountId,t.transactionId]);
const fingerprint = t => createHash('sha256').update(JSON.stringify(t)).digest('hex');

/** All mutations use one repository transaction. The simulation repository below
 * is not production persistence; PostgreSQL wiring must enforce this same atomicity. */
async function reconcile(repository, binding, input, now = new Date()) {
  if (binding.mode !== 'simulation') throw new Error('Live reconciliation is not implemented; sandbox verification required');
  if (!id(binding.tenantId) || !id(binding.customerId) || !id(binding.accountId)) throw new Error('Trusted binding required');
  const t = normalize(input), key = keyOf(t), hash = fingerprint(t);
  if (t.customerId !== binding.customerId || t.accountId !== binding.accountId) throw new Error('Provider account does not match trusted binding');
  return repository.transaction(async state => {
    const scopedKey = JSON.stringify([binding.tenantId,key]);
    const prior = state.observations[scopedKey];
    const issue = reason => {
      const issueKey = JSON.stringify([scopedKey,hash,reason]);
      state.exceptions[issueKey] ??= {tenantId:binding.tenantId,transactionId:t.transactionId,reason,status:'open',amount:t.amount,currency:t.currency};
      return {outcome:'exception',reason};
    };
    if (prior && t.version < prior.transaction.version) return {outcome:'stale'};
    if (prior && t.version === prior.transaction.version) {
      if (prior.hash !== hash) return issue('conflicting_same_version');
      if (prior.outcome === 'recorded' || prior.outcome === 'pending') return {outcome:'duplicate'};
      // Unmatched or ineligible items may be retried after setup is corrected.
    }
    const existing = state.recordings[scopedKey];
    if (existing) {
      if (terminal.has(t.status)) return issue('recorded_payment_return_or_reversal');
      if (t.status !== 'completed' || existing.amount !== t.amount || existing.currency !== t.currency || existing.payeeId !== t.payeeId || existing.completedDate !== t.completedDate) return issue('recorded_payment_changed');
      return {outcome:'duplicate'};
    }
    if (prior && terminal.has(prior.transaction.status) && t.status !== prior.transaction.status) return issue('terminal_status_changed');
    state.observations[scopedKey] = {transaction:t,hash,outcome:'pending'};
    if (t.status === 'pending') return {outcome:'pending'};
    state.observations[scopedKey].outcome = 'exception';
    if (terminal.has(t.status)) return issue(`provider_${t.status}`);
    if (t.completedDate > now.toISOString().slice(0,10)) return issue('future_completion_date');
    // Explicit transaction-to-payable association, never amount/name guessing.
    const matches = state.mappings.filter(m => m.tenantId === binding.tenantId && m.customerId === t.customerId && m.accountId === t.accountId && m.transactionId === t.transactionId);
    if (matches.length !== 1) return issue(matches.length ? 'ambiguous_mapping' : 'unmatched_payment');
    const m = matches[0], payable = state.payables[m.payableId];
    if (!payable || payable.tenantId !== binding.tenantId || m.payeeId !== t.payeeId || payable.payeeId !== t.payeeId) return issue('payee_or_tenant_mismatch');
    if (payable.workforce !== 'partner') return issue('employee_work_not_partner_debt');
    if (m.amount !== t.amount || payable.currency !== t.currency || m.currency !== t.currency) return issue('amount_or_currency_mismatch');
    if (!payable.accepted || !payable.approved || !payable.cashClearedAndAllocated) return issue('payable_not_eligible');
    const amount = money(t.amount), available = money(payable.eligibleAmount) - money(payable.paidAmount) - money(payable.inFlightAmount);
    if (amount > available) return issue('exceeds_available_balance');
    // Manual recordings must participate in the same deduplication contract.
    if (state.manualReferences.some(r => r.tenantId === binding.tenantId && r.customerId === t.customerId && r.transactionId === t.transactionId)) return issue('already_recorded_manually');
    state.recordings[scopedKey] = {tenantId:binding.tenantId,payableId:m.payableId,transactionId:t.transactionId,payeeId:t.payeeId,amount:t.amount,currency:t.currency,completedDate:t.completedDate,source:'passport_simulation',fingerprint:hash};
    const paid = money(payable.paidAmount) + amount;
    payable.paidAmount = `${paid / 100n}.${String(paid % 100n).padStart(2,'0')}`;
    state.audit.push({tenantId:binding.tenantId,action:'passport.simulated_recording',transactionId:t.transactionId,payableId:m.payableId,fingerprint:hash});
    state.observations[scopedKey].outcome = 'recorded';
    for (const row of Object.values(state.exceptions)) if (row.tenantId === binding.tenantId && row.transactionId === t.transactionId) row.status = 'resolved_by_reconciliation';
    return {outcome:'recorded'};
  });
}

class SimulationRepository {
  constructor(seed = {}) {
    this.state = structuredClone({observations:{},recordings:{},exceptions:{},mappings:[],payables:{},manualReferences:[],audit:[],checkpoints:{},...seed});
    this.queue = Promise.resolve();
  }
  transaction(fn) {
    const operation = this.queue.then(async () => {const next = structuredClone(this.state); const result = await fn(next); this.state = next; return result;});
    this.queue = operation.catch(() => {});
    return operation;
  }
  exceptionsFor(tenantId, permissions) {
    if (!permissions.includes('partner_payment.confirm')) throw new Error('Finance reconciliation permission required');
    return structuredClone(Object.values(this.state.exceptions).filter(r => r.tenantId === tenantId));
  }
}

// A webhook is only a refresh hint. No financial data supplied in a notification
// is trusted. Provider-specific verification/decoding cannot be guessed.
async function receiveWebhook({rawBody,headers,verify,decode,enqueue,binding}) {
  if (!Buffer.isBuffer(rawBody) || rawBody.length > 65536) throw new Error('Invalid webhook body');
  if (typeof verify !== 'function' || !await verify(rawBody,headers)) throw new Error('Webhook verification required');
  const hint = await decode(rawBody);
  if (!id(hint.transactionId) || hint.customerId !== binding.customerId) throw new Error('Webhook scope mismatch');
  await enqueue({tenantId:binding.tenantId,customerId:binding.customerId,transactionId:hint.transactionId});
  return {accepted:true};
}

// Retry-safe page consumption. Cursor is committed only after every observation
// succeeds. Replay after a crash is deduplicated by the reconciliation ledger.
async function poll({repository,binding,listPage,maxPages=100}) {
  if (binding.mode !== 'simulation') throw new Error('Live polling is disabled');
  const scope = JSON.stringify([binding.tenantId,binding.customerId,binding.accountId]);
  let cursor = repository.state.checkpoints[scope] ?? null;
  const seen = new Set();
  for (let page=0;page<maxPages;page++) {
    if (seen.has(JSON.stringify(cursor))) throw new Error('Repeated provider cursor');
    seen.add(JSON.stringify(cursor));
    const result = await listPage(cursor);
    if (!Array.isArray(result.items) || result.items.length > 1000 || typeof result.done !== 'boolean') throw new Error('Invalid page contract');
    if (!result.done && (typeof result.nextCursor !== 'string' || !result.nextCursor)) throw new Error('Missing next cursor');
    for (const transaction of result.items) await reconcile(repository,binding,transaction);
    cursor = result.nextCursor ?? null;
    await repository.transaction(state => {state.checkpoints[scope] = cursor;});
    if (result.done) return {pages:page+1};
  }
  throw new Error('Page limit reached; resume from saved cursor');
}

// Explicitly read-only sandbox helper. No production hosts, transfer methods,
// redirects, credential logging, automatic subscriptions or automatic retries.
function sandboxReader({enabled=false,apiKey,fetchImpl=fetch}) {
  return {async getTransaction(customerId,transactionId) {
    if (!enabled) throw new Error('Passport sandbox reads are disabled');
    if (!id(customerId) || !id(transactionId) || !apiKey) throw new Error('Sandbox identifiers and credential required');
    const url = `https://sandbox-api.prioritycommerce.com/v1/passport/v1/customer/id/${encodeURIComponent(customerId)}/transaction/id/${encodeURIComponent(transactionId)}`;
    const response = await fetchImpl(url,{method:'GET',headers:{'x-api-key':apiKey,'Accept':'application/json'},redirect:'error',signal:AbortSignal.timeout(10000)});
    if (!response.ok) {const error=new Error(`Passport read failed (${response.status})`); error.retryable=response.status===429 || response.status>=500; throw error;}
    return response.json(); // Wire body still requires sandbox-verified normalization.
  }};
}
module.exports = {money,normalize,reconcile,SimulationRepository,receiveWebhook,poll,sandboxReader};
