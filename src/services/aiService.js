/**
 * Sahaara AI — Model Service Health Monitor & Circuit Breaker
 *
 * §10.1 degradation SOP:
 *
 *   health poller → trip circuit breaker → activate offline fallback
 *     1. Lock local buffer        3. Display amber status
 *     2. Render manual form       4. Queue sync on restore
 *
 * The breaker exists so the platform degrades *predictably*: a handful of
 * consecutive failures opens the circuit immediately rather than letting a
 * reviewer sit through a slow timeout mid-call, and a probe in the half-open
 * state prevents flapping.
 */

/** Circuit / service states. */
export const STATE = {
  HEALTHY: "HEALTHY",
  DEGRADED: "DEGRADED",
  OFFLINE: "OFFLINE",
};

export const CIRCUIT = { CLOSED: "CLOSED", OPEN: "OPEN", HALF_OPEN: "HALF_OPEN" };

/**
 * @typedef {Object} AIServiceOptions
 * @property {number} [failureThreshold] Consecutive failures before opening.
 * @property {number} [successThreshold] Consecutive successes to close again.
 * @property {number} [probeIntervalMs]  How long the circuit stays open.
 * @property {number} [pollIntervalMs]   Health poll cadence (spec: 500 ms).
 */

export class AIServiceHealth {
  constructor(opts = {}) {
    this.failureThreshold = opts.failureThreshold ?? 3;
    this.successThreshold = opts.successThreshold ?? 2;
    this.probeIntervalMs = opts.probeIntervalMs ?? 5_000;
    this.pollIntervalMs = opts.pollIntervalMs ?? 500;

    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.circuit = CIRCUIT.CLOSED;
    this.state = STATE.HEALTHY;
    this.cause = null;
    this.openedAt = null;
    this.lastCheckedAt = null;
    this.history = [];
    this._timer = null;
    this._prober = null;
    /**
     * Operator-forced outage (the TC-14 kill switch). While true the poller
     * keeps probing but must NOT auto-close the circuit — a demo outage the
     * reviewer can't hold open is worse than no outage at all.
     */
    this.forcedOffline = false;
  }

  /** Record a health probe. Returns the resulting state. */
  reportHealth(ok, cause = null) {
    this.lastCheckedAt = new Date().toISOString();
    if (this.forcedOffline) return this.state;
    if (ok) {
      this.consecutiveFailures = 0;
      this.consecutiveSuccesses += 1;
      if (this.circuit === CIRCUIT.HALF_OPEN && this.consecutiveSuccesses >= this.successThreshold) {
        this._close();
      } else if (this.circuit === CIRCUIT.CLOSED && this.state !== STATE.HEALTHY) {
        this._recover();
      }
    } else {
      this.consecutiveSuccesses = 0;
      this.consecutiveFailures += 1;
      if (this.circuit === CIRCUIT.HALF_OPEN) {
        this._open(cause || this.cause || "probe_failed");
      } else if (this.consecutiveFailures >= this.failureThreshold) {
        this._open(cause || "model_service_unavailable");
      } else if (this.state === STATE.HEALTHY) {
        this._transition(STATE.DEGRADED, cause || "intermittent_failures");
      }
    }
    return this.state;
  }

  /** Manual kill switch — used by the TC-14 demo toggle. */
  simulateOutage(cause = "model_service_unavailable") {
    this.forcedOffline = true;
    this.consecutiveFailures = this.failureThreshold;
    this._open(cause);
    return this.state;
  }

  simulateRecovery() {
    this.forcedOffline = false;
    this.consecutiveSuccesses = 0;
    this.circuit = CIRCUIT.HALF_OPEN;
    this._recover();
    return this.state;
  }

  get isUnavailable() {
    return this.state === STATE.OFFLINE;
  }

  /** Should this request take the manual path? */
  get shouldDegrade() {
    if (this.state === STATE.OFFLINE) return true;
    if (this.circuit === CIRCUIT.OPEN && this._probeDue()) this.circuit = CIRCUIT.HALF_OPEN;
    return this.state === STATE.OFFLINE;
  }

  _probeDue() {
    return this.openedAt && Date.now() - this.openedAt >= this.probeIntervalMs;
  }

  _open(cause) {
    if (this.circuit !== CIRCUIT.OPEN) this._transition(STATE.OFFLINE, cause, CIRCUIT.OPEN);
    this.openedAt = Date.now();
  }

  _close() {
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.openedAt = null;
    this._transition(STATE.HEALTHY, null, CIRCUIT.CLOSED);
  }

  _recover() {
    this._transition(STATE.HEALTHY, null, this.circuit === CIRCUIT.HALF_OPEN ? CIRCUIT.HALF_OPEN : CIRCUIT.CLOSED);
  }

  _transition(state, cause, circuit) {
    if (circuit) this.circuit = circuit;
    if (state === this.state && cause === this.cause) return;
    const previous = this.state;
    this.state = state;
    this.cause = cause;
    this.history.push({
      at: new Date().toISOString(),
      from: previous,
      to: state,
      cause,
      circuit: this.circuit,
      consecutive_failures: this.consecutiveFailures,
    });
    if (this.history.length > 100) this.history.shift();
  }

  /** Start the 500 ms health poller (§10.1). Stops automatically on stop(). */
  start(healthCheck) {
    if (this._timer) return;
    const tick = () => {
      Promise.resolve()
        .then(() => healthCheck())
        .then((ok) => this.reportHealth(ok === true))
        .catch((err) => this.reportHealth(false, err?.message || "health_check_failed"));
    };
    this._timer = setInterval(tick, this.pollIntervalMs);
    this._timer.unref?.();
    tick();
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  snapshot() {
    return {
      service: "model_service",
      state: this.state,
      circuit: this.circuit,
      cause: this.cause,
      consecutive_failures: this.consecutiveFailures,
      last_checked_at: this.lastCheckedAt,
      opened_at: this.openedAt ? new Date(this.openedAt).toISOString() : null,
      probe_interval_ms: this.probeIntervalMs,
      poll_interval_ms: this.pollIntervalMs,
      fallback_active: this.shouldDegrade,
      forced_offline: this.forcedOffline,
      recent_transitions: this.history.slice(-5),
    };
  }
}

/** Process-wide monitor used by the API. */
export const aiService = new AIServiceHealth();
