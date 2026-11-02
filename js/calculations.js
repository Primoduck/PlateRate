/*
 * PlateRate calculation engine
 *
 * This module contains no DOM code. It can be run in the browser or directly
 * from Node for testing. All costs are kept at full floating-point precision;
 * rounding happens only when values are formatted for display.
 */
(function (global) {
  "use strict";

  const unitApi =
    global.PlateRate && global.PlateRate.units
      ? global.PlateRate.units
      : typeof require === "function"
      ? require("./units.js")
      : null;

  const densityApi =
    global.PlateRate && global.PlateRate.densities
      ? global.PlateRate.densities
      : typeof require === "function"
      ? require("./densities.js")
      : null;

  if (!unitApi) {
    throw new Error(
      "The PlateRate units module must be loaded before calculations.js."
    );
  }

  if (!densityApi) {
    throw new Error(
      "The PlateRate densities module must be loaded before calculations.js."
    );
  }

  /**
   * Read a number from either an input string or a stored JSON value.
   * Missing values are distinct from malformed values so the interface can
   * show the most useful validation message.
   */
  function parseNumber(rawValue) {
    if (rawValue === null || rawValue === undefined) {
      return { state: "missing", value: null };
    }

    if (typeof rawValue === "number") {
      return Number.isFinite(rawValue)
        ? { state: "valid", value: rawValue }
        : { state: "invalid", value: null };
    }

    if (typeof rawValue === "string") {
      const trimmed = rawValue.trim();
      if (trimmed === "") {
        return { state: "missing", value: null };
      }

      const value = Number(trimmed);
      return Number.isFinite(value)
        ? { state: "valid", value: value }
        : { state: "invalid", value: null };
    }

    return { state: "invalid", value: null };
  }

  function normalizeText(rawValue) {
    if (rawValue === null || rawValue === undefined) {
      return "";
    }

    return String(rawValue).trim();
  }

  /**
   * A row is blank only when none of its user-editable data fields contain
   * content. Unit selects always have a default value, so they are not
   * considered when deciding whether a row is blank.
   */
  function isBlankIngredient(ingredient) {
    if (!ingredient || typeof ingredient !== "object") {
      return false;
    }

    return (
      normalizeText(ingredient.name) === "" &&
      normalizeText(ingredient.purchaseQuantity) === "" &&
      normalizeText(ingredient.purchasePrice) === "" &&
      normalizeText(ingredient.usageQuantity) === ""
    );
  }

  function normalizeMultiplier(rawValue) {
    if (rawValue === null || rawValue === undefined || rawValue === "") {
      return { isValid: true, value: 1 };
    }

    const value =
      typeof rawValue === "number"
        ? rawValue
        : Number(String(rawValue).trim());
    const isValid = Number.isFinite(value) && value > 0;

    // An invalid multiplier should never silently produce a wrong number.
    // Callers can inspect multiplierIsValid, while the safe default keeps the
    // interface usable if an invalid value ever reaches the engine.
    return { isValid: isValid, value: isValid ? value : 1 };
  }

  function addNumberError(errors, field, parsed, messages) {
    if (parsed.state === "missing") {
      errors.push({ field: field, message: messages.missing });
      return;
    }

    if (parsed.state === "invalid") {
      errors.push({ field: field, message: messages.invalid });
      return;
    }

    if (parsed.value < 0) {
      errors.push({ field: field, message: messages.negative });
    }
  }

  /**
   * Convert a usage quantity into the purchase unit using grams per US cup.
   *
   * This supports both directions:
   *   volume usage, weight purchase -> cups -> grams -> purchase unit
   *   weight usage, volume purchase -> grams -> cups -> purchase unit
   *
   * Only weight and volume can be bridged. Count units are never guessed.
   */
  function convertUsageWithDensity(value, usageUnit, purchaseUnit, profile) {
    if (!profile) {
      return {
        ok: false,
        reason: "missing-density",
        message: "Choose an ingredient density to convert between weight and volume."
      };
    }

    const usageCategory = usageUnit.category;
    const purchaseCategory = purchaseUnit.category;

    if (usageCategory === "volume" && purchaseCategory === "weight") {
      const cups = unitApi.convert(value, usageUnit.id, "cup");

      if (!cups.ok) {
        return cups;
      }

      return unitApi.convert(
        cups.value * profile.gramsPerCup,
        "g",
        purchaseUnit.id
      );
    }

    if (usageCategory === "weight" && purchaseCategory === "volume") {
      const grams = unitApi.convert(value, usageUnit.id, "g");

      if (!grams.ok) {
        return grams;
      }

      return unitApi.convert(
        grams.value / profile.gramsPerCup,
        "cup",
        purchaseUnit.id
      );
    }

    return {
      ok: false,
      reason: "incompatible-units",
      message:
        "Ingredient density conversion only works between weight and volume."
    };
  }

  /**
   * Calculate and validate one ingredient.
   *
   * status:
   *   "blank"      - an untouched row; ignored by the recipe summary
   *   "incomplete" - has data but needs attention; excluded from totals
   *   "valid"      - every required field is usable and cost is available
   */
  function calculateIngredient(ingredient, multiplier) {
    const scaleInfo = normalizeMultiplier(multiplier);
    const scale = scaleInfo.value;

    if (!ingredient || typeof ingredient !== "object") {
      return {
        id: null,
        name: "",
        status: "incomplete",
        errors: [
          {
            field: "name",
            message: "Ingredient data is missing or invalid."
          }
        ],
        cost: null,
        percentage: null,
        purchaseQuantity: null,
        purchaseUnitId: null,
        purchasePrice: null,
        usageQuantity: null,
        usageUnitId: null,
        scaledUsageQuantity: null,
        densityId: "",
        densityName: "",
        densityGramsPerCup: null,
        usesDensity: false,
        multiplier: scale
      };
    }

    if (isBlankIngredient(ingredient)) {
      return {
        id: ingredient && ingredient.id ? ingredient.id : null,
        name: "",
        status: "blank",
        errors: [],
        cost: null,
        percentage: null,
        purchaseQuantity: null,
        purchaseUnitId: ingredient ? ingredient.purchaseUnit : null,
        purchasePrice: null,
        usageQuantity: null,
        usageUnitId: ingredient ? ingredient.usageUnit : null,
        scaledUsageQuantity: null,
        densityId: ingredient ? ingredient.densityId || "" : "",
        densityName: "",
        densityGramsPerCup: null,
        usesDensity: false,
        multiplier: scale
      };
    }

    const errors = [];
    const name = normalizeText(ingredient.name);

    if (!name) {
      errors.push({
        field: "name",
        message: "Enter an ingredient name."
      });
    }

    const purchaseQuantity = parseNumber(ingredient.purchaseQuantity);
    addNumberError(errors, "purchaseQuantity", purchaseQuantity, {
      missing: "Enter a purchase quantity.",
      invalid: "Enter a valid purchase quantity.",
      negative: "Purchase quantity cannot be negative."
    });
    if (purchaseQuantity.state === "valid" && purchaseQuantity.value === 0) {
      errors.push({
        field: "purchaseQuantity",
        message: "Purchase quantity must be greater than 0."
      });
    }

    const purchasePrice = parseNumber(ingredient.purchasePrice);
    addNumberError(errors, "purchasePrice", purchasePrice, {
      missing: "Enter a purchase price.",
      invalid: "Enter a valid purchase price.",
      negative: "Purchase price cannot be negative."
    });

    const usageQuantity = parseNumber(ingredient.usageQuantity);
    addNumberError(errors, "usageQuantity", usageQuantity, {
      missing: "Enter the recipe quantity used.",
      invalid: "Enter a valid recipe quantity.",
      negative: "Recipe quantity cannot be negative."
    });

    const purchaseUnit = unitApi.getUnit(ingredient.purchaseUnit);
    const usageUnit = unitApi.getUnit(ingredient.usageUnit);
    const rawDensityId =
      ingredient.densityId === null || ingredient.densityId === undefined
        ? ""
        : String(ingredient.densityId).trim();
    const densityProfile = densityApi.getProfile(rawDensityId);

    if (!purchaseUnit) {
      errors.push({
        field: "purchaseUnit",
        message: "Choose a valid purchase unit."
      });
    }

    if (!usageUnit) {
      errors.push({
        field: "usageUnit",
        message: "Choose a valid recipe unit."
      });
    }

    if (rawDensityId !== "" && !densityProfile) {
      errors.push({
        field: "densityId",
        message: "Choose a valid ingredient density."
      });
    }

    const categoriesDiffer = Boolean(
      purchaseUnit && usageUnit && purchaseUnit.category !== usageUnit.category
    );
    const densityCanBridge = Boolean(
      categoriesDiffer &&
        purchaseUnit &&
        usageUnit &&
        ((purchaseUnit.category === "weight" &&
          usageUnit.category === "volume") ||
          (purchaseUnit.category === "volume" &&
            usageUnit.category === "weight"))
    );
    const usesDensity = Boolean(densityCanBridge && densityProfile);

    if (categoriesDiffer && !usesDensity) {
      errors.push({
        field: "usageUnit",
        message:
          `Purchase and recipe units are incompatible ` +
          `(${unitApi.CATEGORY_LABELS[purchaseUnit.category]} vs ` +
          `${unitApi.CATEGORY_LABELS[usageUnit.category]}). ` +
          (densityCanBridge
            ? "Choose an ingredient density to convert between weight and volume."
            : "Density conversion only works between weight and volume.")
      });

      if (densityCanBridge && !densityProfile && rawDensityId === "") {
        errors.push({
          field: "densityId",
          message:
            "Choose an ingredient density for this weight ↔ volume conversion."
        });
      }
    }

    let scaledUsageQuantity = null;
    let cost = null;

    // The scaled usage hint is useful as soon as a usable recipe quantity
    // exists, even while another field in the row is still incomplete.
    if (usageQuantity.state === "valid" && usageQuantity.value >= 0) {
      scaledUsageQuantity = usageQuantity.value * scale;
    }

    // Only calculate a cost once every required field is valid. This prevents
    // an unfinished row from contributing an arbitrary amount to the recipe.
    if (errors.length === 0) {
      const convertedUsage = usesDensity
        ? convertUsageWithDensity(
            scaledUsageQuantity,
            usageUnit,
            purchaseUnit,
            densityProfile
          )
        : unitApi.convert(
            scaledUsageQuantity,
            usageUnit.id,
            purchaseUnit.id
          );

      if (!convertedUsage.ok) {
        // Defensive fallback; the compatibility checks above should catch this.
        errors.push({
          field: usesDensity ? "densityId" : "usageUnit",
          message: convertedUsage.message
        });
      } else {
        cost = purchasePrice.value * (convertedUsage.value / purchaseQuantity.value);

        if (!Number.isFinite(cost)) {
          errors.push({
            field: "purchaseQuantity",
            message: "This combination of values cannot be calculated."
          });
          cost = null;
        }
      }
    }

    return {
      id: ingredient.id || null,
      name: name,
      status: errors.length === 0 ? "valid" : "incomplete",
      errors: errors,
      cost: cost,
      percentage: null,
      purchaseQuantity:
        purchaseQuantity.state === "valid" ? purchaseQuantity.value : null,
      purchaseUnitId: purchaseUnit ? purchaseUnit.id : null,
      purchasePrice:
        purchasePrice.state === "valid" ? purchasePrice.value : null,
      usageQuantity:
        usageQuantity.state === "valid" ? usageQuantity.value : null,
      usageUnitId: usageUnit ? usageUnit.id : null,
      scaledUsageQuantity: scaledUsageQuantity,
      densityId: densityProfile ? densityProfile.id : "",
      densityName: densityProfile ? densityProfile.name : "",
      densityGramsPerCup: densityProfile ? densityProfile.gramsPerCup : null,
      usesDensity: usesDensity,
      multiplier: scale
    };
  }

  /**
   * Calculate recipe totals from an array of ingredient records.
   *
   * The optional multiplier is part of the pure engine so the interface can
   * scale costs without changing the costing math. Ingredients always retain
   * their original stored quantities; scaling is applied on the fly.
   */
  function calculateRecipe(recipe, options) {
    const source = recipe && typeof recipe === "object" ? recipe : {};
    const rawIngredients = Array.isArray(source.ingredients)
      ? source.ingredients
      : [];
    const requestedOptions = options && typeof options === "object" ? options : {};
    const multiplierInfo = normalizeMultiplier(requestedOptions.multiplier);

    const ingredients = rawIngredients.map(function (ingredient) {
      return calculateIngredient(ingredient, multiplierInfo.value);
    });

    const nonBlankIngredients = ingredients.filter(function (ingredient) {
      return ingredient.status !== "blank";
    });
    const validIngredients = ingredients.filter(function (ingredient) {
      return ingredient.status === "valid";
    });
    const incompleteIngredients = ingredients.filter(function (ingredient) {
      return ingredient.status === "incomplete";
    });

    const totalCost =
      validIngredients.length > 0
        ? validIngredients.reduce(function (sum, ingredient) {
            return sum + ingredient.cost;
          }, 0)
        : null;

    // Percentages describe each ingredient's share of the displayed total.
    // They are undefined when the total is zero because every share is 0/0.
    if (totalCost !== null && totalCost > 0) {
      validIngredients.forEach(function (ingredient) {
        ingredient.percentage = (ingredient.cost / totalCost) * 100;
      });
    }

    const parsedYield = parseNumber(source.yieldQuantity);
    const yieldIsValid =
      parsedYield.state === "valid" && parsedYield.value > 0;
    const yieldQuantity = yieldIsValid ? parsedYield.value : null;
    const scaledYieldQuantity =
      yieldQuantity !== null ? yieldQuantity * multiplierInfo.value : null;
    const yieldError =
      yieldIsValid
        ? null
        : parsedYield.state === "missing"
        ? "Enter a yield greater than 0 to calculate cost per item."
        : "Yield must be a number greater than 0 to calculate cost per item.";

    const costPerItem =
      totalCost !== null && scaledYieldQuantity !== null
        ? totalCost / scaledYieldQuantity
        : null;

    return {
      ingredients: ingredients,
      totalCost: totalCost,
      costPerItem: costPerItem,
      ingredientCount: nonBlankIngredients.length,
      validIngredientCount: validIngredients.length,
      incompleteCount: incompleteIngredients.length,
      hasIngredients: nonBlankIngredients.length > 0,
      hasIncomplete: incompleteIngredients.length > 0,
      isPartial: totalCost !== null && incompleteIngredients.length > 0,
      yieldQuantity: yieldQuantity,
      scaledYieldQuantity: scaledYieldQuantity,
      yieldDescription: normalizeText(source.yieldDescription),
      yieldIsValid: yieldIsValid,
      yieldError: yieldError,
      multiplier: multiplierInfo.value,
      multiplierIsValid: multiplierInfo.isValid
    };
  }

  const api = {
    parseNumber: parseNumber,
    isBlankIngredient: isBlankIngredient,
    calculateIngredient: calculateIngredient,
    calculateRecipe: calculateRecipe
  };

  global.PlateRate = global.PlateRate || {};
  global.PlateRate.calculations = api;

  // Allows direct use by the Node test runner.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(globalThis);
