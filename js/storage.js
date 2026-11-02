/*
 * PlateRate recipe storage
 *
 * This module handles recipe data normalization, local persistence, and JSON
 * backup validation. It contains no DOM code, so every rule can be tested
 * directly from Node. The storage adapter is injected so tests can use an
 * in-memory implementation instead of a browser.
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
      "The PlateRate units module must be loaded before storage.js."
    );
  }

  if (!densityApi) {
    throw new Error(
      "The PlateRate densities module must be loaded before storage.js."
    );
  }

  const STORAGE_KEY = "platerate.recipes.v1";
  const CORRUPT_STORAGE_KEY = "platerate.recipes.corrupt";
  const SCHEMA_VERSION = 1;
  const APP_NAME = "PlateRate";
  const DEFAULT_RECIPE_NAME = "Untitled recipe";
  const DEFAULT_YIELD_DESCRIPTION = "servings";

  // Accept ordinary decimal notation (including exponents and a leading +),
  // but reject hex, separators, and other values Number() would coerce.
  const NUMERIC_PATTERN = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;

  let idSequence = 0;

  function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function stringValue(value) {
    return value === null || value === undefined ? "" : String(value);
  }

  function createId(prefix) {
    idSequence += 1;
    return (
      `${prefix}-${idSequence.toString(36)}-` +
      `${Math.random().toString(36).slice(2, 8)}`
    );
  }

  function displayRecipeName(name) {
    const trimmed = typeof name === "string" ? name.trim() : "";
    return trimmed || DEFAULT_RECIPE_NAME;
  }

  function collectRecipeNames(recipes) {
    return (Array.isArray(recipes) ? recipes : []).map(function (recipe) {
      return displayRecipeName(recipe && recipe.name);
    });
  }

  /**
   * Return a display name that does not collide with any name in the list.
   * Names are compared case-insensitively so "Cookies" and "cookies" do not
   * create confusing duplicate entries in the recipe selector.
   */
  function uniqueRecipeName(baseName, existingNames) {
    const base = displayRecipeName(baseName);
    const used = new Set(
      (Array.isArray(existingNames) ? existingNames : []).map(function (name) {
        return displayRecipeName(name).toLowerCase();
      })
    );

    if (!used.has(base.toLowerCase())) {
      return base;
    }

    let suffix = 2;
    let candidate = `${base} (${suffix})`;

    while (used.has(candidate.toLowerCase())) {
      suffix += 1;
      candidate = `${base} (${suffix})`;
    }

    return candidate;
  }

  /**
   * Never overwrite an existing recipe during import. Imported duplicates get
   * a numeric suffix, and duplicates inside the same backup are handled too.
   */
  function resolveNameConflicts(recipes, existingNames) {
    const used = new Set(
      (Array.isArray(existingNames) ? existingNames : []).map(function (name) {
        return displayRecipeName(name).toLowerCase();
      })
    );
    const resolved = [];
    const renamed = [];

    (Array.isArray(recipes) ? recipes : []).forEach(function (recipe) {
      const base = displayRecipeName(recipe && recipe.name);
      const name = uniqueRecipeName(base, Array.from(used));

      used.add(name.toLowerCase());

      if (name !== base) {
        renamed.push({ from: base, to: name });
      }

      resolved.push(Object.assign({}, recipe, { name: name }));
    });

    return { recipes: resolved, renamed: renamed };
  }

  function createIngredient(values) {
    return Object.assign(
      {
        id: createId("ingredient"),
        name: "",
        purchaseQuantity: "",
        purchaseUnit: "g",
        purchasePrice: "",
        usageQuantity: "",
        usageUnit: "g",
        densityId: ""
      },
      values || {}
    );
  }

  function createRecipe(values) {
    return Object.assign(
      {
        id: createId("recipe"),
        name: DEFAULT_RECIPE_NAME,
        yieldQuantity: "",
        yieldDescription: DEFAULT_YIELD_DESCRIPTION,
        multiplier: 1,
        ingredients: []
      },
      values || {}
    );
  }

  function serializeIngredient(ingredient) {
    const source = isPlainObject(ingredient) ? ingredient : {};

    return {
      id: typeof source.id === "string" ? source.id : "",
      name: stringValue(source.name).trim(),
      purchaseQuantity: stringValue(source.purchaseQuantity).trim(),
      purchaseUnit: stringValue(source.purchaseUnit),
      purchasePrice: stringValue(source.purchasePrice).trim(),
      usageQuantity: stringValue(source.usageQuantity).trim(),
      usageUnit: stringValue(source.usageUnit),
      densityId: stringValue(source.densityId)
    };
  }

  function serializeRecipe(recipe) {
    const source = isPlainObject(recipe) ? recipe : {};
    const multiplier = Number(source.multiplier);

    return {
      id: typeof source.id === "string" ? source.id : "",
      name: displayRecipeName(source.name),
      yieldQuantity: stringValue(source.yieldQuantity).trim(),
      yieldDescription:
        stringValue(source.yieldDescription).trim() ||
        DEFAULT_YIELD_DESCRIPTION,
      multiplier: Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1,
      ingredients: (Array.isArray(source.ingredients)
        ? source.ingredients
        : []
      ).map(serializeIngredient)
    };
  }

  /**
   * The same shape is written to local storage and used for JSON exports.
   * Recipe IDs are included so the active recipe can be restored.
   */
  function buildSnapshot(state) {
    const source = isPlainObject(state) ? state : {};

    return {
      app: APP_NAME,
      version: SCHEMA_VERSION,
      activeRecipeId:
        typeof source.activeRecipeId === "string"
          ? source.activeRecipeId
          : null,
      recipes: (Array.isArray(source.recipes) ? source.recipes : []).map(
        serializeRecipe
      )
    };
  }

  function quantityOk(value) {
    return { ok: true, value: value };
  }

  function quantityError(message) {
    return { ok: false, error: message };
  }

  function normalizeQuantity(value, fieldName) {
    if (value === null || value === undefined) {
      return quantityOk("");
    }

    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        return quantityError(`${fieldName} must be a finite number`);
      }
      if (value < 0) {
        return quantityError(`${fieldName} cannot be negative`);
      }
      return quantityOk(String(value));
    }

    if (typeof value !== "string") {
      return quantityError(`${fieldName} must be a number`);
    }

    const text = value.trim();

    if (text === "") {
      return quantityOk("");
    }

    if (!NUMERIC_PATTERN.test(text)) {
      return quantityError(`${fieldName} must be a number`);
    }

    const parsed = Number(text);

    if (!Number.isFinite(parsed)) {
      return quantityError(`${fieldName} must be a finite number`);
    }

    if (parsed < 0) {
      return quantityError(`${fieldName} cannot be negative`);
    }

    return quantityOk(text);
  }

  function normalizeMultiplier(value) {
    if (
      value === null ||
      value === undefined ||
      (typeof value === "string" && value.trim() === "")
    ) {
      return quantityOk(1);
    }

    const normalized = normalizeQuantity(value, "batch multiplier");

    if (!normalized.ok) {
      return normalized;
    }

    const parsed = Number(normalized.value);

    if (!(parsed > 0)) {
      return quantityError("batch multiplier must be greater than 0");
    }

    return quantityOk(parsed);
  }

  function normalizeUnit(value, fieldName) {
    if (value === null || value === undefined || value === "") {
      return quantityOk("");
    }

    if (typeof value !== "string") {
      return quantityError(`${fieldName} must be a unit ID`);
    }

    const unit = unitApi.getUnit(value);

    if (!unit) {
      return quantityError(`${fieldName} "${value}" is not a supported unit`);
    }

    return quantityOk(unit.id);
  }

  function normalizeDensityId(value, fieldName) {
    if (
      value === null ||
      value === undefined ||
      (typeof value === "string" && value.trim() === "")
    ) {
      return quantityOk("");
    }

    if (typeof value !== "string") {
      return quantityError(`${fieldName} must be a density profile ID`);
    }

    const profile = densityApi.getProfile(value);

    if (!profile) {
      return quantityError(
        `${fieldName} "${value}" is not a supported ingredient density`
      );
    }

    return quantityOk(profile.id);
  }

  function normalizeYieldDescription(value) {
    if (value === null || value === undefined) {
      return quantityOk(DEFAULT_YIELD_DESCRIPTION);
    }

    if (typeof value !== "string") {
      return quantityError("yield description must be text");
    }

    return quantityOk(value.trim() || DEFAULT_YIELD_DESCRIPTION);
  }

  /**
   * Normalize one ingredient. Partial rows are allowed so an unfinished
   * recipe can be saved and restored, but malformed values are rejected.
   */
  function normalizeIngredient(raw, label, usedIds) {
    if (!isPlainObject(raw)) {
      return { ok: false, errors: [`${label} is not an object.`] };
    }

    const errors = [];
    let name = "";

    if (raw.name !== null && raw.name !== undefined) {
      if (typeof raw.name !== "string") {
        errors.push("name must be text");
      } else {
        name = raw.name.trim();
      }
    }

    const purchaseQuantity = normalizeQuantity(
      raw.purchaseQuantity,
      "purchase quantity"
    );
    const purchasePrice = normalizeQuantity(
      raw.purchasePrice,
      "purchase price"
    );
    const usageQuantity = normalizeQuantity(
      raw.usageQuantity,
      "recipe quantity"
    );
    const purchaseUnit = normalizeUnit(raw.purchaseUnit, "purchase unit");
    const usageUnit = normalizeUnit(raw.usageUnit, "recipe unit");
    const densityId = normalizeDensityId(raw.densityId, "ingredient density");

    if (!purchaseQuantity.ok) {
      errors.push(purchaseQuantity.error);
    }
    if (!purchasePrice.ok) {
      errors.push(purchasePrice.error);
    }
    if (!usageQuantity.ok) {
      errors.push(usageQuantity.error);
    }
    if (!purchaseUnit.ok) {
      errors.push(purchaseUnit.error);
    }
    if (!usageUnit.ok) {
      errors.push(usageUnit.error);
    }
    if (!densityId.ok) {
      errors.push(densityId.error);
    }

    let purchaseUnitId = purchaseUnit.ok ? purchaseUnit.value : "";
    let usageUnitId = usageUnit.ok ? usageUnit.value : "";

    if (purchaseUnit.ok && purchaseUnitId === "") {
      if (purchaseQuantity.ok && purchaseQuantity.value !== "") {
        errors.push(
          "purchase unit is required when a purchase quantity is set"
        );
      } else {
        purchaseUnitId = "g";
      }
    }

    if (usageUnit.ok && usageUnitId === "") {
      if (usageQuantity.ok && usageQuantity.value !== "") {
        errors.push("recipe unit is required when a recipe quantity is set");
      } else {
        usageUnitId = "g";
      }
    }

    if (errors.length > 0) {
      return {
        ok: false,
        errors: errors.map(function (message) {
          return `${label}: ${message}.`;
        })
      };
    }

    let id = "";

    if (
      typeof raw.id === "string" &&
      raw.id.trim() !== "" &&
      !usedIds.has(raw.id)
    ) {
      id = raw.id;
    } else {
      do {
        id = createId("ingredient");
      } while (usedIds.has(id));
    }

    usedIds.add(id);

    return {
      ok: true,
      ingredient: {
        id: id,
        name: name,
        purchaseQuantity: purchaseQuantity.value,
        purchaseUnit: purchaseUnitId,
        purchasePrice: purchasePrice.value,
        usageQuantity: usageQuantity.value,
        usageUnit: usageUnitId,
        densityId: densityId.value
      }
    };
  }

  /**
   * Normalize one recipe and gather every problem found. Unknown extra fields
   * are ignored so future data can be imported without breaking this version.
   */
  function normalizeRecipe(raw, context) {
    const label = context.label;
    const preserveIds = context.preserveIds;
    const usedRecipeIds = context.usedRecipeIds;

    if (!isPlainObject(raw)) {
      return { ok: false, errors: [`${label} is not an object.`] };
    }

    const errors = [];
    let name = "";

    if (raw.name !== null && raw.name !== undefined) {
      if (typeof raw.name !== "string") {
        errors.push(`${label}: name must be text.`);
      } else {
        name = raw.name.trim();
      }
    }

    const yieldQuantity = normalizeQuantity(
      raw.yieldQuantity,
      "yield quantity"
    );
    const yieldDescription = normalizeYieldDescription(raw.yieldDescription);
    const multiplier = normalizeMultiplier(raw.multiplier);

    if (!yieldQuantity.ok) {
      errors.push(`${label}: ${yieldQuantity.error}.`);
    }
    if (!yieldDescription.ok) {
      errors.push(`${label}: ${yieldDescription.error}.`);
    }
    if (!multiplier.ok) {
      errors.push(`${label}: ${multiplier.error}.`);
    }

    const ingredients = [];

    if (!Array.isArray(raw.ingredients)) {
      errors.push(`${label}: missing ingredients list.`);
    } else {
      const usedIngredientIds = new Set();

      raw.ingredients.forEach(function (rawIngredient, index) {
        const result = normalizeIngredient(
          rawIngredient,
          `${label}, ingredient ${index + 1}`,
          usedIngredientIds
        );

        if (result.ok) {
          ingredients.push(result.ingredient);
        } else {
          errors.push.apply(errors, result.errors);
        }
      });
    }

    if (errors.length > 0) {
      return { ok: false, errors: errors };
    }

    let id = "";

    if (
      preserveIds &&
      typeof raw.id === "string" &&
      raw.id.trim() !== "" &&
      !usedRecipeIds.has(raw.id)
    ) {
      id = raw.id;
    } else {
      do {
        id = createId("recipe");
      } while (usedRecipeIds.has(id));
    }

    usedRecipeIds.add(id);

    return {
      ok: true,
      recipe: {
        id: id,
        name: name || DEFAULT_RECIPE_NAME,
        yieldQuantity: yieldQuantity.value,
        yieldDescription: yieldDescription.value,
        multiplier: multiplier.value,
        ingredients: ingredients
      }
    };
  }

  function looksLikeRecipe(value) {
    return (
      isPlainObject(value) &&
      (Array.isArray(value.ingredients) ||
        value.name !== undefined ||
        value.yieldQuantity !== undefined ||
        value.multiplier !== undefined)
    );
  }

  function backupFailure(message) {
    return { ok: false, error: message };
  }

  /**
   * Validate a parsed backup. Batch backups use { recipes: [...] }; a single
   * recipe object is also accepted for hand-written or partial exports.
   */
  function parseBackupData(data, options) {
    const settings = options && typeof options === "object" ? options : {};
    const preserveIds = settings.preserveIds === true;

    if (!isPlainObject(data)) {
      return backupFailure("The backup must be a JSON object.");
    }

    if (data.app !== undefined) {
      if (
        typeof data.app !== "string" ||
        data.app.toLowerCase() !== APP_NAME.toLowerCase()
      ) {
        return backupFailure(
          "This file was not created by PlateRate."
        );
      }
    }

    if (data.version !== undefined && data.version !== null) {
      const version = Number(data.version);

      if (!Number.isInteger(version) || version < 1) {
        return backupFailure("The backup version is invalid.");
      }

      if (version > SCHEMA_VERSION) {
        return backupFailure(
          "This backup was created by a newer version of PlateRate."
        );
      }
    }

    let entries;

    if (Array.isArray(data.recipes)) {
      entries = data.recipes;
    } else if (looksLikeRecipe(data)) {
      entries = [data];
    } else {
      return backupFailure(
        "This file does not contain a PlateRate recipe list."
      );
    }

    if (entries.length === 0) {
      return backupFailure("The backup does not contain any recipes.");
    }

    const usedRecipeIds = new Set();
    const errors = [];
    const recipes = [];

    entries.forEach(function (entry, index) {
      const result = normalizeRecipe(entry, {
        label: `Recipe ${index + 1}`,
        preserveIds: preserveIds,
        usedRecipeIds: usedRecipeIds
      });

      if (result.ok) {
        recipes.push(result.recipe);
      } else {
        errors.push.apply(errors, result.errors);
      }
    });

    if (errors.length > 0) {
      const shown = errors.slice(0, 4);
      let message = shown.join(" ");

      if (errors.length > shown.length) {
        message += ` (${errors.length - shown.length} more problems.)`;
      }

      return { ok: false, error: message, errors: errors };
    }

    let activeRecipeId = null;

    if (
      preserveIds &&
      typeof data.activeRecipeId === "string" &&
      recipes.some(function (recipe) {
        return recipe.id === data.activeRecipeId;
      })
    ) {
      activeRecipeId = data.activeRecipeId;
    }

    return { ok: true, recipes: recipes, activeRecipeId: activeRecipeId };
  }

  function parseBackupText(text) {
    if (typeof text !== "string" || text.trim() === "") {
      return backupFailure("The file is empty.");
    }

    let data;

    try {
      data = JSON.parse(text);
    } catch (error) {
      return backupFailure(
        "The file is not valid JSON. Choose a PlateRate backup file."
      );
    }

    return parseBackupData(data);
  }

  /**
   * Load and validate saved data. A failed load returns the original raw text
   * so the interface can quarantine it instead of silently discarding it.
   */
  function loadFromStorage(storage) {
    if (!storage) {
      return {
        ok: false,
        error: "Local storage is not available in this browser."
      };
    }

    let raw;

    try {
      raw = storage.getItem(STORAGE_KEY);
    } catch (error) {
      return {
        ok: false,
        error: "Local storage is not available in this browser."
      };
    }

    if (raw === null || raw === undefined) {
      return { ok: true, data: null };
    }

    let data;

    try {
      data = JSON.parse(raw);
    } catch (error) {
      return {
        ok: false,
        error: "Saved recipes are not valid JSON and could not be restored.",
        raw: raw
      };
    }

    const parsed = parseBackupData(data, { preserveIds: true });

    if (!parsed.ok) {
      return {
        ok: false,
        error: `Saved recipes could not be restored: ${parsed.error}`,
        raw: raw
      };
    }

    let activeRecipeId = parsed.activeRecipeId;

    if (!activeRecipeId && parsed.recipes.length > 0) {
      activeRecipeId = parsed.recipes[0].id;
    }

    return {
      ok: true,
      data: { recipes: parsed.recipes, activeRecipeId: activeRecipeId }
    };
  }

  function saveToStorage(storage, state) {
    if (!storage) {
      return {
        ok: false,
        error: "Local storage is not available in this browser."
      };
    }

    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(buildSnapshot(state)));
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: "Local storage is unavailable or full."
      };
    }
  }

  function quarantineUnreadableData(storage, raw) {
    if (!storage || typeof raw !== "string") {
      return { ok: false };
    }

    try {
      storage.setItem(CORRUPT_STORAGE_KEY, raw);
      return { ok: true };
    } catch (error) {
      return { ok: false };
    }
  }

  const api = {
    STORAGE_KEY: STORAGE_KEY,
    CORRUPT_STORAGE_KEY: CORRUPT_STORAGE_KEY,
    SCHEMA_VERSION: SCHEMA_VERSION,
    DEFAULT_RECIPE_NAME: DEFAULT_RECIPE_NAME,
    DEFAULT_YIELD_DESCRIPTION: DEFAULT_YIELD_DESCRIPTION,
    displayRecipeName: displayRecipeName,
    collectRecipeNames: collectRecipeNames,
    uniqueRecipeName: uniqueRecipeName,
    resolveNameConflicts: resolveNameConflicts,
    createIngredient: createIngredient,
    createRecipe: createRecipe,
    serializeIngredient: serializeIngredient,
    serializeRecipe: serializeRecipe,
    buildSnapshot: buildSnapshot,
    parseBackupData: parseBackupData,
    parseBackupText: parseBackupText,
    loadFromStorage: loadFromStorage,
    saveToStorage: saveToStorage,
    quarantineUnreadableData: quarantineUnreadableData
  };

  global.PlateRate = global.PlateRate || {};
  global.PlateRate.storage = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(globalThis);
