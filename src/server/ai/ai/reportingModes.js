"use strict";

const REPORTING_MODES = Object.freeze({
  CURRENT_OPERATIONAL: "CURRENT_OPERATIONAL",
  DAILY: "DAILY",
  WEEKLY: "WEEKLY",
  MONTHLY: "MONTHLY",
  QUARTERLY: "QUARTERLY",
  YEARLY: "YEARLY",
  CUSTOM_RANGE: "CUSTOM_RANGE",
});

const MODE_DESCRIPTIONS = Object.freeze({
  CURRENT_OPERATIONAL: "Current operational period — shows data for the most recent active period.",
  DAILY: "Daily view — shows data aggregated by day.",
  WEEKLY: "Weekly view — shows data aggregated by week.",
  MONTHLY: "Monthly view — shows data aggregated by month.",
  QUARTERLY: "Quarterly view — shows data aggregated by quarter.",
  YEARLY: "Yearly view — shows data aggregated by year.",
  CUSTOM_RANGE: "Custom date range — user-specified start and end dates.",
});

const INTENT_MODE_MAP = Object.freeze([
  {
    keywords: ["today", "daily", "this day"],
    mode: REPORTING_MODES.DAILY,
    reason: "User is asking about daily figures.",
  },
  {
    keywords: ["this week", "weekly", "past week", "last week"],
    mode: REPORTING_MODES.WEEKLY,
    reason: "User is asking about weekly figures.",
  },
  {
    keywords: ["this month", "monthly", "past month", "last month"],
    mode: REPORTING_MODES.MONTHLY,
    reason: "User is asking about monthly figures.",
  },
  {
    keywords: ["this quarter", "quarterly", "past quarter", "last quarter"],
    mode: REPORTING_MODES.QUARTERLY,
    reason: "User is asking about quarterly figures.",
  },
  {
    keywords: ["this year", "yearly", "annual", "year to date", "ytd"],
    mode: REPORTING_MODES.YEARLY,
    reason: "User is asking about yearly or year-to-date figures.",
  },
  {
    keywords: ["outstanding", "debt", "arrears", "overdue", "current balance", "currently", "what is due"],
    mode: REPORTING_MODES.CURRENT_OPERATIONAL,
    reason: "User is asking about current outstanding amounts.",
  },
]);

function detectReportingMode(message) {
  const lower = message.toLowerCase().trim();
  if (!lower) return { mode: REPORTING_MODES.CURRENT_OPERATIONAL, reason: "Default operational mode applied (no query detected)." };

  for (const entry of INTENT_MODE_MAP) {
    for (const kw of entry.keywords) {
      if (lower.includes(kw)) {
        return { mode: entry.mode, reason: entry.reason };
      }
    }
  }

  return { mode: REPORTING_MODES.CURRENT_OPERATIONAL, reason: "No specific time period detected; default operational mode." };
}

function buildReportingModePrompt(message) {
  const { mode, reason } = detectReportingMode(message);
  return {
    reportingMode: mode,
    reportingReason: reason,
    prompt: `[REPORTING MODE: ${mode}]
${reason}
${MODE_DESCRIPTIONS[mode] || ""}`,
  };
}

module.exports = { detectReportingMode, buildReportingModePrompt, REPORTING_MODES, MODE_DESCRIPTIONS };
