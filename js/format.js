/*
 * PlateRate display formatting
 *
 * Intl.NumberFormat handles currency rounding for display only. Calculations
 * should always use the unrounded numbers produced by calculations.js.
 */
(function (global) {
  "use strict";

  const moneyFormatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  const smallMoneyFormatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4
  });

  const tinyMoneyFormatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 6
  });

  const percentFormatter = new Intl.NumberFormat("en-US", {
    style: "percent",
    minimumFractionDigits: 0,
    maximumFractionDigits: 1
  });

  const quantityFormatter = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 6
  });

  const multiplierFormatter = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 6
  });

  function formatSmallCurrency(value) {
    const fourDecimalValue = smallMoneyFormatter.format(value);

    // For extremely tiny non-zero values, four decimals can still round to
    // zero. Fall back to six decimals rather than showing a misleading $0.00.
    if (fourDecimalValue === "$0.00" || fourDecimalValue === "-$0.00") {
      return tinyMoneyFormatter.format(value);
    }

    return fourDecimalValue;
  }

  /**
   * Ordinary monetary values use two decimals. Only values that would
   * otherwise be displayed as $0.00 despite being non-zero get extra precision.
   */
  function formatCurrency(value) {
    if (!Number.isFinite(value)) {
      return "—";
    }

    if (value !== 0 && Math.abs(value) < 0.005) {
      return formatSmallCurrency(value);
    }

    return moneyFormatter.format(value);
  }

  /**
   * Cost-per-item values often become very small. If a value is below $1 and
   * is not an exact number of cents, show up to four decimals so meaningful
   * differences are not hidden. Values such as $0.80 still display as $0.80.
   */
  function formatPerItemCurrency(value) {
    if (!Number.isFinite(value)) {
      return "—";
    }

    if (value !== 0 && Math.abs(value) < 1) {
      const roundedToCents = Math.round(value * 100) / 100;

      if (Math.abs(value - roundedToCents) > 1e-9) {
        return formatSmallCurrency(value);
      }
    }

    return moneyFormatter.format(value);
  }

  /**
   * Accepts a percentage in percentage-point form (for example, 75 -> "75%").
   */
  function formatPercent(value) {
    if (!Number.isFinite(value)) {
      return "—";
    }

    return percentFormatter.format(value / 100);
  }

  function formatQuantity(value) {
    if (!Number.isFinite(value)) {
      return "—";
    }

    return quantityFormatter.format(value);
  }

  /**
   * Batch multipliers are display values, not calculations, so a trailing
   * multiplication sign makes them easier to read in the summary and readout.
   */
  function formatMultiplier(value) {
    if (!Number.isFinite(value) || value <= 0) {
      return "—";
    }

    return `${multiplierFormatter.format(value)}×`;
  }

  const IRREGULAR_SINGULARS = {
    people: "person",
    children: "child",
    loaves: "loaf",
    halves: "half",
    knives: "knife",
    leaves: "leaf",
    tomatoes: "tomato",
    potatoes: "potato",
    heroes: "hero"
  };

  function preserveCapitalization(original, singular) {
    if (original.length > 1 && original === original.toUpperCase()) {
      return singular.toUpperCase();
    }

    if (original.charAt(0) === original.charAt(0).toUpperCase()) {
      return singular.charAt(0).toUpperCase() + singular.slice(1);
    }

    return singular;
  }

  /**
   * Small display helper for yield descriptions. It intentionally handles the
   * common recipe nouns (rolls, cookies, servings, pieces, batches) rather than
   * trying to implement a complete English pluralization engine.
   */
  function singularizeWord(word) {
    const lower = word.toLowerCase();

    if (Object.prototype.hasOwnProperty.call(IRREGULAR_SINGULARS, lower)) {
      return preserveCapitalization(word, IRREGULAR_SINGULARS[lower]);
    }

    let singular = word;

    if (/[^s]s$/i.test(lower)) {
      if (/ches$/i.test(lower) || /shes$/i.test(lower) || /xes$/i.test(lower) || /zes$/i.test(lower)) {
        singular = word.slice(0, -2);
      } else if (/oes$/i.test(lower)) {
        singular = word.slice(0, -2);
      } else if (!/(ss|us|is)$/i.test(lower)) {
        singular = word.slice(0, -1);
      }
    }

    return preserveCapitalization(word, singular);
  }

  /**
   * Convert a yield description such as "cinnamon rolls" into the noun used
   * in "Per cinnamon roll". An empty description falls back to "item".
   */
  function singularizeYield(description) {
    const text =
      typeof description === "string" ? description.trim() : "";

    if (!text) {
      return "item";
    }

    const words = text.split(/\s+/);
    const lastWord = words.pop();

    return words.concat(singularizeWord(lastWord)).join(" ");
  }

  const api = {
    formatCurrency: formatCurrency,
    formatPerItemCurrency: formatPerItemCurrency,
    formatPercent: formatPercent,
    formatQuantity: formatQuantity,
    formatMultiplier: formatMultiplier,
    singularizeYield: singularizeYield
  };

  global.PlateRate = global.PlateRate || {};
  global.PlateRate.format = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(globalThis);
