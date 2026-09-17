"use strict";

const { allToolMetadata } = require("./toolRegistry");

function _param(type, description) {
  return { type, description };
}

const TOOL_PARAM_SCHEMAS = {
  // Revenue
  revenueSummary: {
    period: _param("string", "Time period: today, yesterday, this_week, this_month, this_year, or a custom date range (start..end)"),
    groupBy: _param("string", "Group results by: service, employee, customer, payment_method, day, week, month, quarter, year"),
  },
  revenueTrends: {
    period: _param("string", "Time period: this_month, last_month, this_year, or a date range"),
    comparison: _param("string", "Comparison type: previous_period, same_period_last_year"),
  },
  serviceRevenueBreakdown: {
    period: _param("string", "Time period for the breakdown"),
    groupBy: _param("string", "Group by: service, staff"),
  },

  // Expenses
  expenseAnalysis: {
    period: _param("string", "Time period for expense analysis"),
    category: _param("string", "Optional expense category filter"),
  },
  unusualExpenses: {
    period: _param("string", "Time period to check for unusual expenses"),
    threshold: _param("number", "Deviation threshold in standard deviations (default: 2)"),
  },

  // Profitability
  profitAnalysis: {
    period: _param("string", "Time period for profit analysis"),
  },
  profitMarginBreakdown: {
    period: _param("string", "Time period for margin breakdown"),
    groupBy: _param("string", "Group by: service"),
  },

  // Customers
  customerIntelligence: {
    period: _param("string", "Time period for customer analysis"),
  },
  topCustomers: {
    limit: _param("number", "Number of top customers to return (default: 10)"),
    period: _param("string", "Time period for ranking"),
  },
  customerActivity: {
    period: _param("string", "Time period for activity analysis"),
    daysInactive: _param("number", "Days since last visit to consider inactive"),
  },

  // Services
  serviceIntelligence: {
    period: _param("string", "Time period for service analysis"),
  },
  serviceProfitability: {
    period: _param("string", "Time period for profitability analysis"),
  },

  // Sales
  salesSummary: {
    period: _param("string", "Time period for sales summary"),
  },

  // Forecasting
  revenueForecast: {
    period: _param("string", "Forecast period: next_month, next_quarter, next_year"),
    method: _param("string", "Forecast method: trend, seasonal, average"),
  },
  expenseForecast: {
    period: _param("string", "Forecast period for expenses"),
  },
  demandForecast: {
    period: _param("string", "Forecast period for demand"),
    serviceId: _param("string", "Optional service identifier"),
  },

  // Risk
  riskDetection: {
    period: _param("string", "Time period for risk assessment"),
  },
  cashFlowAnalysis: {
    period: _param("string", "Time period for cash flow analysis"),
  },

  // Opportunities
  opportunityDetection: {
    period: _param("string", "Time period for opportunity detection"),
  },
  staffPerformance: {
    period: _param("string", "Time period for staff performance"),
  },

  // Business Health
  businessHealthScore: {
    period: _param("string", "Time period for health score calculation"),
  },
  executiveSummary: {
    period: _param("string", "Time period for executive summary"),
  },

  // New revenue breakdowns
  revenueByEmployee: {
    period: _param("string", "Time period for employee revenue breakdown"),
  },
  revenueByService: {
    period: _param("string", "Time period for service revenue breakdown"),
  },
  revenueByPaymentMethod: {
    period: _param("string", "Time period for payment method breakdown"),
  },

  // Search
  searchBusinessData: {
    query: _param("string", "Search query text"),
    type: _param("string", "Entity type to search: all, customers, transactions, services, expenses"),
  },

  // Dashboard
  dashboardData: {
    period: _param("string", "Time period for dashboard data"),
  },
};

const REQUIRED_PARAMS = Object.freeze({
  searchBusinessData: ["query"],
});

function _buildRequired(toolId, paramSchemas) {
  const meta = TOOL_PARAM_SCHEMAS[toolId];
  if (!meta) return [];
  const required = REQUIRED_PARAMS[toolId] || [];
  return Object.keys(meta).filter((k) => required.includes(k));
}

function toolSchemaForProvider(toolId) {
  const allMeta = allToolMetadata();
  const meta = allMeta.find((m) => m.id === toolId);
  if (!meta) return null;

  const paramSchemas = TOOL_PARAM_SCHEMAS[toolId];
  if (!paramSchemas) return null;

  const properties = {};
  for (const [key, desc] of Object.entries(paramSchemas)) {
    properties[key] = { type: desc.type, description: desc.description };
  }

  const required = _buildRequired(toolId, paramSchemas);
  const parameters = { type: "object", properties, additionalProperties: false };
  if (required.length > 0) parameters.required = required;

  return {
    type: "function",
    function: {
      name: meta.id,
      description: meta.description,
      parameters,
    },
  };
}

function toolSchemasForProvider() {
  const allMeta = allToolMetadata();
  const schemas = [];
  for (const meta of allMeta) {
    const schema = toolSchemaForProvider(meta.id);
    if (schema) schemas.push(schema);
  }
  return schemas;
}

module.exports = { toolSchemasForProvider, toolSchemaForProvider };
