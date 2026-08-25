'use strict';

(function initPrivacy(root) {
  const NS = root.TrainingCollectorV02 = root.TrainingCollectorV02 || {};
  const SENSITIVE_RE = /(password|passwd|passcode|otp|one[- ]?time|token|secret|cvv|cvc|card.?number|credit.?card|authorization|bearer|session.?id)/i;

  function text(v) { return String(v || '').trim(); }

  function classifyElementMeta(meta = {}) {
    const type = text(meta.type).toLowerCase();
    const haystack = [meta.name, meta.id, meta.autocomplete, meta.ariaLabel, meta.placeholder, meta.label]
      .map(text).filter(Boolean).join(' ');
    if (type === 'password') return { sensitive: true, reason: 'password_type' };
    if (SENSITIVE_RE.test(haystack)) return { sensitive: true, reason: 'sensitive_metadata' };
    return { sensitive: false, reason: null };
  }

  function redactText(value, sensitive) {
    if (sensitive) return '[REDACTED]';
    return text(value).slice(0, 160);
  }

  function safeTextMetrics(value) {
    const s = String(value || '');
    return { length: s.length, empty: s.length === 0 };
  }

  NS.Privacy = { classifyElementMeta, redactText, safeTextMetrics };
  if (typeof module !== 'undefined' && module.exports) module.exports = NS.Privacy;
})(typeof globalThis !== 'undefined' ? globalThis : this);
