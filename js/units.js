/*
 * PlateRate unit system
 *
 * Every unit belongs to exactly one category and stores a conversion factor
 * relative to that category's base unit:
 *
 *   weight -> grams
 *   volume -> milliliters (US customary definitions)
 *   count  -> each
 *
 * Conversions are only allowed inside the same category. Weight is never
 * converted to volume because that requires an ingredient-specific density,
 * and PlateRate does not invent those values.
 */
(function (global) {
  "use strict";

  const CATEGORY_ORDER = ["weight", "volume", "count"];

  const CATEGORY_LABELS = {
    weight: "Weight",
    volume: "Volume",
    count: "Count"
  };

  const UNITS = Object.freeze({
    // Weight
    g: {
      id: "g",
      label: "g",
      name: "grams",
      category: "weight",
      toBase: 1
    },
    kg: {
      id: "kg",
      label: "kg",
      name: "kilograms",
      category: "weight",
      toBase: 1000
    },
    oz: {
      id: "oz",
      label: "oz",
      name: "ounces (weight)",
      category: "weight",
      toBase: 28.349523125
    },
    lb: {
      id: "lb",
      label: "lb",
      name: "pounds",
      category: "weight",
      toBase: 453.59237
    },

    // Volume (US customary)
    ml: {
      id: "ml",
      label: "ml",
      name: "milliliters",
      category: "volume",
      toBase: 1
    },
    l: {
      id: "l",
      label: "L",
      name: "liters",
      category: "volume",
      toBase: 1000
    },
    tsp: {
      id: "tsp",
      label: "tsp",
      name: "US teaspoons",
      category: "volume",
      toBase: 4.92892159375
    },
    tbsp: {
      id: "tbsp",
      label: "tbsp",
      name: "US tablespoons",
      category: "volume",
      toBase: 14.78676478125
    },
    floz: {
      id: "floz",
      label: "fl oz",
      name: "US fluid ounces",
      category: "volume",
      toBase: 29.5735295625
    },
    cup: {
      id: "cup",
      label: "cup",
      name: "US cups",
      category: "volume",
      toBase: 236.5882365
    },
    pint: {
      id: "pint",
      label: "pt",
      name: "US pints",
      category: "volume",
      toBase: 473.176473
    },
    quart: {
      id: "quart",
      label: "qt",
      name: "US quarts",
      category: "volume",
      toBase: 946.352946
    },
    gallon: {
      id: "gallon",
      label: "gal",
      name: "US gallons",
      category: "volume",
      toBase: 3785.411784
    },

    // Count
    each: {
      id: "each",
      label: "each",
      name: "each / pieces",
      category: "count",
      toBase: 1
    }
  });

  function getUnit(unitId) {
    return Object.prototype.hasOwnProperty.call(UNITS, unitId)
      ? UNITS[unitId]
      : null;
  }

  function getCategory(unitId) {
    const unit = getUnit(unitId);
    return unit ? unit.category : null;
  }

  function getCategoryLabel(unitId) {
    const category = getCategory(unitId);
    return category ? CATEGORY_LABELS[category] : "";
  }

  function areCompatible(firstUnitId, secondUnitId) {
    const first = getUnit(firstUnitId);
    const second = getUnit(secondUnitId);

    return Boolean(first && second && first.category === second.category);
  }

  /**
   * Convert a quantity between units in the same category.
   *
   * Returns a result object instead of throwing so form validation can show
   * a useful message without interrupting live calculations.
   */
  function convert(value, fromUnitId, toUnitId) {
    if (!Number.isFinite(value)) {
      return {
        ok: false,
        reason: "invalid-value",
        message: "Enter a valid number to convert."
      };
    }

    const from = getUnit(fromUnitId);
    const to = getUnit(toUnitId);

    if (!from || !to) {
      return {
        ok: false,
        reason: "unknown-unit",
        message: "Choose a valid unit."
      };
    }

    if (from.category !== to.category) {
      return {
        ok: false,
        reason: "incompatible-units",
        message:
          `${from.name} and ${to.name} measure different things ` +
          `(${CATEGORY_LABELS[from.category]} vs ${CATEGORY_LABELS[to.category]}). ` +
          "Use units from the same category."
      };
    }

    return {
      ok: true,
      value: (value * from.toBase) / to.toBase
    };
  }

  /**
   * Return units grouped for <optgroup> rendering, in a stable display order.
   */
  function getGroupedUnits() {
    return CATEGORY_ORDER.map(function (category) {
      return {
        id: category,
        label: CATEGORY_LABELS[category],
        units: Object.values(UNITS).filter(function (unit) {
          return unit.category === category;
        })
      };
    });
  }

  const api = {
    CATEGORY_ORDER: CATEGORY_ORDER,
    CATEGORY_LABELS: CATEGORY_LABELS,
    UNITS: UNITS,
    getUnit: getUnit,
    getCategory: getCategory,
    getCategoryLabel: getCategoryLabel,
    areCompatible: areCompatible,
    convert: convert,
    getGroupedUnits: getGroupedUnits
  };

  global.PlateRate = global.PlateRate || {};
  global.PlateRate.units = api;

  // Allows the pure module to be loaded directly by the Node test runner.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(globalThis);
