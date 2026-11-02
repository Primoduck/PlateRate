/*
 * PlateRate interface
 *
 * app.js owns the editable state and DOM. It does not contain costing or unit
 * conversion math; those live in calculations.js and units.js so they can be
 * tested independently.
 *
 * Scaling note: stored ingredient quantities are never rewritten. The active
 * recipe's multiplier is passed to the calculation engine on every render, so
 * changing scales repeatedly cannot compound.
 *
 * Persistence note: every recipe lives in one in-memory state object. Edits
 * update that object immediately and a short debounce writes the whole set to
 * local storage. Invalid values block the write so a reload can never discard
 * readable recipes because of one half-typed number.
 */
(function () {
  "use strict";

  const units = globalThis.PlateRate.units;
  const densities = globalThis.PlateRate.densities;
  const calculations = globalThis.PlateRate.calculations;
  const format = globalThis.PlateRate.format;
  const storage = globalThis.PlateRate.storage;

  const ALLOWED_INGREDIENT_FIELDS = [
    "name",
    "purchaseQuantity",
    "purchaseUnit",
    "purchasePrice",
    "usageQuantity",
    "usageUnit",
    "densityId"
  ];

  const SAVE_DELAY = 350;

  const state = {
    recipes: [],
    activeRecipeId: null
  };

  let saveTimer = null;
  let saveFailureNotified = false;
  let ingredientViewSequence = 0;

  const elements = {};

  function byId(id) {
    return document.getElementById(id);
  }

  function cacheElements() {
    elements.recipeSelect = byId("recipe-select");
    elements.newRecipe = byId("new-recipe");
    elements.importRecipes = byId("import-recipes");
    elements.exportRecipes = byId("export-recipes");
    elements.importFile = byId("import-file");

    elements.notice = byId("app-notice");
    elements.noticeText = byId("app-notice-text");
    elements.noticeDismiss = byId("notice-dismiss");

    elements.recipeName = byId("recipe-name");
    elements.yieldQuantity = byId("yield-quantity");
    elements.yieldDescription = byId("yield-description");

    elements.rows = byId("ingredient-rows");
    elements.ingredientTable = byId("ingredient-table");
    elements.ingredientEmpty = byId("ingredient-empty");
    elements.addIngredient = byId("add-ingredient");
    elements.emptyAddIngredient = byId("empty-add-ingredient");

    elements.total = byId("summary-total");
    elements.totalDetail = byId("summary-total-detail");
    elements.perItem = byId("summary-per-item");
    elements.perItemLabel = byId("summary-per-item-label");
    elements.perItemDetail = byId("summary-per-item-detail");
    elements.partialBadge = byId("summary-partial-badge");
    elements.ingredientCount = byId("summary-ingredient-count");
    elements.yieldValue = byId("summary-yield");
    elements.yieldDetail = byId("summary-yield-detail");
    elements.summaryScale = byId("summary-scale");
    elements.summaryNote = byId("summary-note");

    elements.activeMultiplier = byId("active-multiplier");
    elements.customScale = byId("custom-scale");
    elements.scaleError = byId("scale-error");
    elements.scaleButtons = Array.prototype.slice.call(
      document.querySelectorAll("[data-scale]")
    );

    elements.saveStatus = byId("save-status");
    elements.deleteRecipe = byId("delete-recipe");
    elements.deleteConfirm = byId("delete-confirm");
    elements.deleteWarning = byId("delete-warning");
    elements.confirmDelete = byId("confirm-delete");
    elements.cancelDelete = byId("cancel-delete");
  }

  function stringValue(value) {
    return value === null || value === undefined ? "" : String(value);
  }

  function pluralize(count, singular, plural) {
    return count === 1 ? singular : plural;
  }

  function activeRecipe() {
    return (
      state.recipes.find(function (recipe) {
        return recipe.id === state.activeRecipeId;
      }) || null
    );
  }

  function getStorageAdapter() {
    try {
      return window.localStorage;
    } catch (error) {
      return null;
    }
  }

  /**
   * Live regions can re-announce when their text node is replaced, even with
   * identical text. Update only when the rendered message actually changes.
   */
  function setTextIfChanged(element, text) {
    if (element.textContent !== text) {
      element.textContent = text;
    }
  }

  /* Notices and save status ------------------------------------------------- */

  function showNotice(message, tone) {
    elements.noticeText.setAttribute(
      "role",
      tone === "error" ? "alert" : "status"
    );
    setTextIfChanged(elements.noticeText, message);
    elements.notice.classList.toggle("is-error", tone === "error");
    elements.notice.hidden = false;
  }

  function hideNotice() {
    elements.notice.hidden = true;
    elements.noticeText.textContent = "";
    elements.noticeText.setAttribute("role", "status");
    elements.notice.classList.remove("is-error");
  }

  function setSaveStatus(kind, detail) {
    const text =
      kind === "saving"
        ? "Saving…"
        : kind === "error"
        ? "Not saved"
        : "Saved locally";

    setTextIfChanged(elements.saveStatus, text);
    elements.saveStatus.classList.toggle("is-saving", kind === "saving");
    elements.saveStatus.classList.toggle("is-error", kind === "error");

    if (kind === "saving") {
      elements.saveStatus.title = "Saving changes in this browser";
    } else if (kind === "error") {
      elements.saveStatus.title =
        detail || "Changes could not be saved in this browser";
    } else {
      elements.saveStatus.title = "Recipes are stored in this browser";
    }
  }

  function scheduleSave() {
    setSaveStatus("saving");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      saveNow();
    }, SAVE_DELAY);
  }

  function saveNow(options) {
    const settings = options || {};

    clearTimeout(saveTimer);
    saveTimer = null;

    const snapshot = storage.buildSnapshot(state);
    const validation = storage.parseBackupData(snapshot, {
      preserveIds: true
    });

    if (!validation.ok) {
      setSaveStatus(
        "error",
        `Changes are not saved yet: ${validation.error}`
      );
      return { ok: false, reason: "invalid", error: validation.error };
    }

    const result = storage.saveToStorage(getStorageAdapter(), state);

    if (result.ok) {
      saveFailureNotified = false;
      setSaveStatus("saved");
      return { ok: true };
    }

    setSaveStatus("error", result.error);

    if (!settings.silent && !saveFailureNotified) {
      saveFailureNotified = true;
      showNotice(
        `${result.error} Changes are kept on this screen, but they will be ` +
          "lost if you close or reload the tab.",
        "error"
      );
    }

    return { ok: false, reason: "storage", error: result.error };
  }

  /* Recipe switching -------------------------------------------------------- */

  function renderRecipeSelector() {
    const fragment = document.createDocumentFragment();

    state.recipes.forEach(function (recipe) {
      const option = document.createElement("option");
      option.value = recipe.id;
      option.textContent = storage.displayRecipeName(recipe.name);
      option.selected = recipe.id === state.activeRecipeId;
      fragment.appendChild(option);
    });

    elements.recipeSelect.replaceChildren(fragment);

    if (state.recipes.length > 0) {
      elements.recipeSelect.value = state.activeRecipeId;
    }
  }

  function syncActiveOptionLabel() {
    const recipe = activeRecipe();

    if (!recipe) {
      return;
    }

    Array.prototype.forEach.call(elements.recipeSelect.options, function (option) {
      if (option.value === recipe.id) {
        option.textContent = storage.displayRecipeName(recipe.name);
      }
    });
  }

  function updateDocumentTitle() {
    const recipe = activeRecipe();
    const name = recipe ? storage.displayRecipeName(recipe.name) : "";

    document.title = name
      ? `${name} — PlateRate`
      : "PlateRate — Recipe Cost Calculator";
  }

  function renderActiveRecipe() {
    const recipe = activeRecipe();

    if (!recipe) {
      return;
    }

    closeDeleteConfirm(false);
    elements.deleteRecipe.hidden = false;

    elements.recipeName.value = stringValue(recipe.name);
    elements.yieldQuantity.value = stringValue(recipe.yieldQuantity);
    elements.yieldDescription.value = stringValue(recipe.yieldDescription);

    clearScaleError();
    updateScaleControls();
    renderIngredientRows();
    updateDocumentTitle();
  }

  function handleRecipeSelectChange() {
    const id = elements.recipeSelect.value;
    const exists = state.recipes.some(function (recipe) {
      return recipe.id === id;
    });

    if (!exists || id === state.activeRecipeId) {
      renderRecipeSelector();
      return;
    }

    state.activeRecipeId = id;
    renderActiveRecipe();
    scheduleSave();
  }

  function handleNewRecipe() {
    const name = storage.uniqueRecipeName(
      storage.DEFAULT_RECIPE_NAME,
      storage.collectRecipeNames(state.recipes)
    );
    const recipe = storage.createRecipe({ name: name });

    state.recipes.push(recipe);
    state.activeRecipeId = recipe.id;

    renderRecipeSelector();
    renderActiveRecipe();

    const saveResult = saveNow();
    const message = `Created “${storage.displayRecipeName(name)}”.`;

    if (!saveResult.ok) {
      showNotice(
        `${message} The new recipe could not be saved: ${saveResult.error}`,
        "error"
      );
    } else {
      showNotice(message, "success");
    }

    elements.recipeName.focus();
    elements.recipeName.select();
  }

  /* Create, rename, and delete --------------------------------------------- */

  function handleRecipeNameInput(event) {
    const recipe = activeRecipe();

    if (!recipe) {
      return;
    }

    recipe.name = event.target.value;
    syncActiveOptionLabel();
    updateDocumentTitle();
    scheduleSave();
  }

  /**
   * On blur, trim the name and make it unique. Duplicate names are confusing
   * in the selector, so a second "Cookies" becomes "Cookies (2)".
   */
  function commitRecipeName() {
    const recipe = activeRecipe();

    if (!recipe) {
      return;
    }

    const otherNames = storage.collectRecipeNames(
      state.recipes.filter(function (item) {
        return item.id !== recipe.id;
      })
    );
    const unique = storage.uniqueRecipeName(recipe.name, otherNames);

    if (recipe.name !== unique) {
      recipe.name = unique;
      elements.recipeName.value = unique;
      syncActiveOptionLabel();
      updateDocumentTitle();
      scheduleSave();
    }
  }

  function handleDeleteRequest() {
    const recipe = activeRecipe();

    if (!recipe) {
      return;
    }

    elements.deleteWarning.textContent =
      `Delete “${storage.displayRecipeName(recipe.name)}”? This removes the ` +
      "recipe from this browser and cannot be undone.";
    elements.deleteRecipe.hidden = true;
    elements.deleteConfirm.hidden = false;
    elements.cancelDelete.focus();
  }

  function closeDeleteConfirm(returnFocus) {
    const wasOpen = !elements.deleteConfirm.hidden;

    elements.deleteConfirm.hidden = true;
    elements.deleteRecipe.hidden = false;

    if (wasOpen && returnFocus) {
      elements.deleteRecipe.focus();
    }
  }

  function handleConfirmDelete() {
    const recipe = activeRecipe();

    if (!recipe) {
      return;
    }

    const index = state.recipes.findIndex(function (item) {
      return item.id === recipe.id;
    });
    const deletedName = storage.displayRecipeName(recipe.name);
    let createdReplacement = false;

    if (index !== -1) {
      state.recipes.splice(index, 1);
    }

    if (state.recipes.length === 0) {
      const replacement = storage.createRecipe();
      state.recipes.push(replacement);
      state.activeRecipeId = replacement.id;
      createdReplacement = true;
    } else {
      const nextIndex = Math.min(index, state.recipes.length - 1);
      state.activeRecipeId = state.recipes[nextIndex].id;
    }

    renderRecipeSelector();
    renderActiveRecipe();

    const saveResult = saveNow();
    const message = `Deleted “${deletedName}”.`;

    if (saveResult.ok) {
      showNotice(message, "success");
    } else {
      showNotice(
        `${message} The change could not be saved: ${saveResult.error}`,
        "error"
      );
    }

    if (createdReplacement) {
      elements.recipeName.focus();
      elements.recipeName.select();
    } else {
      elements.recipeSelect.focus();
    }
  }

  /* Ingredient rows --------------------------------------------------------- */

  function appendUnitOptions(select, selectedUnitId) {
    const groups = units.getGroupedUnits();

    groups.forEach(function (group) {
      const optgroup = document.createElement("optgroup");
      optgroup.label = group.label;

      group.units.forEach(function (unit) {
        const option = document.createElement("option");
        option.value = unit.id;
        option.textContent = `${unit.label} — ${unit.name}`;
        option.selected = unit.id === selectedUnitId;
        optgroup.appendChild(option);
      });

      select.appendChild(optgroup);
    });
  }

  function appendDensityOptions(select, selectedDensityId) {
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Not needed";
    select.appendChild(placeholder);

    densities.getGroupedProfiles().forEach(function (group) {
      const optgroup = document.createElement("optgroup");
      optgroup.label = group.label;

      group.profiles.forEach(function (profile) {
        const option = document.createElement("option");
        option.value = profile.id;
        option.textContent = `${profile.name} — ${profile.gramsPerCup} g/cup`;
        option.selected = profile.id === selectedDensityId;
        optgroup.appendChild(option);
      });

      select.appendChild(optgroup);
    });
  }

  function createIngredientElements(ingredient) {
    const row = document.createElement("tr");
    row.className = "ingredient-row";
    row.dataset.ingredientId = ingredient.id;

    // DOM ids are generated here rather than derived from stored ids. This
    // keeps the static row markup safe even if a saved id ever contains
    // unexpected characters.
    ingredientViewSequence += 1;
    const viewId = `ingredient-view-${ingredientViewSequence}`;
    row.dataset.viewId = viewId;

    // Only static markup is inserted here. User-entered values are assigned
    // through input.value/textContent below, which avoids injecting HTML.
    // data-label values become the visible field captions in the mobile cards.
    row.innerHTML = `
      <td class="cell-name" data-label="Ingredient">
        <input
          type="text"
          data-field="name"
          aria-label="Ingredient name"
          placeholder="e.g. Bread flour"
          autocomplete="off"
        />
      </td>
      <td class="cell-purchase-qty cell-number" data-label="Purchase qty">
        <input
          type="number"
          data-field="purchaseQuantity"
          min="0"
          step="any"
          inputmode="decimal"
          aria-label="Purchase quantity"
          placeholder="0"
        />
      </td>
      <td class="cell-purchase-unit cell-unit" data-label="Purchase unit">
        <select data-field="purchaseUnit" aria-label="Purchase unit"></select>
      </td>
      <td class="cell-purchase-price cell-number" data-label="Purchase price">
        <input
          type="number"
          data-field="purchasePrice"
          min="0"
          step="0.01"
          inputmode="decimal"
          aria-label="Purchase price in US dollars"
          placeholder="0.00"
        />
      </td>
      <td class="cell-usage-qty cell-number group-start" data-label="Recipe qty">
        <input
          type="number"
          data-field="usageQuantity"
          min="0"
          step="any"
          inputmode="decimal"
          aria-label="Recipe usage quantity"
          placeholder="0"
          aria-describedby="${viewId}-scaled"
        />
        <span
          class="usage-scale-hint"
          id="${viewId}-scaled"
          data-role="scaled-usage"
          hidden
        ></span>
      </td>
      <td class="cell-usage-unit cell-unit" data-label="Recipe unit">
        <select data-field="usageUnit" aria-label="Recipe usage unit"></select>
      </td>
      <td class="cell-density" data-label="Weight ↔ volume">
        <select
          data-field="densityId"
          aria-label="Ingredient density for weight and volume conversion"
          aria-describedby="${viewId}-density-hint"
        ></select>
        <span
          class="density-hint"
          id="${viewId}-density-hint"
          data-role="density-hint"
        ></span>
      </td>
      <td class="cell-cost" data-label="Cost">
        <span class="cost-line">
          <span class="cost-value" data-role="cost">—</span>
          <span class="cost-share" data-role="share"></span>
        </span>
        <span class="cost-bar" data-role="share-track" hidden aria-hidden="true">
          <span class="cost-bar-fill" data-role="share-bar"></span>
        </span>
      </td>
      <td class="cell-remove">
        <button
          type="button"
          class="remove-button"
          data-action="remove"
          aria-label="Remove ingredient"
        >
          Remove
        </button>
      </td>
    `;

    row.querySelector('[data-field="name"]').value = stringValue(
      ingredient.name
    );
    row.querySelector('[data-field="purchaseQuantity"]').value = stringValue(
      ingredient.purchaseQuantity
    );
    row.querySelector('[data-field="purchasePrice"]').value = stringValue(
      ingredient.purchasePrice
    );
    row.querySelector('[data-field="usageQuantity"]').value = stringValue(
      ingredient.usageQuantity
    );

    appendUnitOptions(
      row.querySelector('[data-field="purchaseUnit"]'),
      ingredient.purchaseUnit
    );
    appendUnitOptions(
      row.querySelector('[data-field="usageUnit"]'),
      ingredient.usageUnit
    );
    appendDensityOptions(
      row.querySelector('[data-field="densityId"]'),
      ingredient.densityId
    );

    const feedbackRow = document.createElement("tr");
    feedbackRow.className = "feedback-row";
    feedbackRow.dataset.feedbackFor = ingredient.id;
    feedbackRow.dataset.viewId = viewId;
    feedbackRow.hidden = true;
    feedbackRow.innerHTML = `
      <td colspan="9">
        <p
          class="row-error"
          id="${viewId}-error"
          aria-live="polite"
        ></p>
      </td>
    `;

    return { row: row, feedbackRow: feedbackRow };
  }

  function renderIngredientRows(focusIngredientId) {
    const recipe = activeRecipe();

    if (!recipe) {
      return;
    }

    const fragment = document.createDocumentFragment();

    recipe.ingredients.forEach(function (ingredient) {
      const parts = createIngredientElements(ingredient);
      fragment.appendChild(parts.row);
      fragment.appendChild(parts.feedbackRow);
    });

    elements.rows.replaceChildren(fragment);
    updateWorkspaceVisibility();
    updateCalculations();

    if (focusIngredientId) {
      focusIngredientName(focusIngredientId);
    }
  }

  function updateWorkspaceVisibility() {
    const recipe = activeRecipe();
    const hasRows = recipe ? recipe.ingredients.length > 0 : false;

    elements.ingredientTable.hidden = !hasRows;
    elements.ingredientEmpty.hidden = hasRows;
    elements.addIngredient.hidden = !hasRows;
  }

  function focusIngredientName(ingredientId) {
    const row = Array.prototype.find.call(
      elements.rows.children,
      function (candidate) {
        return candidate.dataset.ingredientId === ingredientId;
      }
    );
    const input = row
      ? row.querySelector('[data-field="name"]')
      : null;

    if (input) {
      input.focus();
      input.scrollIntoView({ block: "nearest" });
    }
  }

  /* Calculations and summary ------------------------------------------------ */

  function updateCalculations() {
    const recipe = activeRecipe();

    if (!recipe) {
      return;
    }

    const result = calculations.calculateRecipe(recipe, {
      multiplier: recipe.multiplier
    });

    updateIngredientResults(result.ingredients, result.multiplier);
    updateSummary(result);
  }

  function updateIngredientResults(results, multiplier) {
    results.forEach(function (result) {
      if (!result.id) {
        return;
      }

      const row = Array.prototype.find.call(
        elements.rows.children,
        function (candidate) {
          return candidate.dataset.ingredientId === result.id;
        }
      );
      const feedbackRow = row ? row.nextElementSibling : null;

      if (!row || !feedbackRow) {
        return;
      }

      const viewId = row.dataset.viewId;
      const costElement = row.querySelector('[data-role="cost"]');
      const shareElement = row.querySelector('[data-role="share"]');
      const shareTrack = row.querySelector('[data-role="share-track"]');
      const shareBar = row.querySelector('[data-role="share-bar"]');
      const scaledUsage = row.querySelector('[data-role="scaled-usage"]');
      const usageInput = row.querySelector('[data-field="usageQuantity"]');
      const densitySelect = row.querySelector('[data-field="densityId"]');
      const densityHint = row.querySelector('[data-role="density-hint"]');
      const removeButton = row.querySelector('[data-action="remove"]');

      const isValid = result.status === "valid";
      const hasShare = isValid && result.percentage !== null;

      costElement.textContent = isValid ? format.formatCurrency(result.cost) : "—";

      const shareText = hasShare ? format.formatPercent(result.percentage) : "";
      shareElement.textContent = shareText;

      if (shareText) {
        shareElement.setAttribute(
          "aria-label",
          `${shareText} of total ingredient cost`
        );
        shareElement.title = `${shareText} of total ingredient cost`;
      } else {
        shareElement.removeAttribute("aria-label");
        shareElement.removeAttribute("title");
      }

      shareTrack.hidden = !hasShare;
      shareBar.style.width = hasShare ? `${result.percentage}%` : "0%";

      // Scaled usage is a hint under the original recipe quantity. The base
      // quantity input always keeps the user's original value.
      const usageUnit = result.usageUnitId
        ? units.getUnit(result.usageUnitId)
        : null;
      const showScaledUsage =
        multiplier !== 1 &&
        result.scaledUsageQuantity !== null &&
        usageUnit !== null;

      if (showScaledUsage) {
        scaledUsage.textContent =
          `→ ${format.formatQuantity(result.scaledUsageQuantity)} ` +
          usageUnit.label;
        scaledUsage.hidden = false;
      } else {
        scaledUsage.textContent = "";
        scaledUsage.hidden = true;
      }

      // Weight ↔ volume conversion is opt-in per ingredient. The selector is
      // only enabled when the chosen units actually need a density, which
      // keeps same-unit rows uncluttered.
      const purchaseUnit = result.purchaseUnitId
        ? units.getUnit(result.purchaseUnitId)
        : null;
      const densityProfile = result.densityId
        ? densities.getProfile(result.densityId)
        : null;
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
      const countMismatch = Boolean(categoriesDiffer && !densityCanBridge);
      const placeholder = densitySelect.querySelector('option[value=""]');

      densitySelect.disabled = !densityCanBridge;
      densitySelect.classList.toggle("is-inactive", !densityCanBridge);

      if (placeholder) {
        placeholder.textContent = densityCanBridge
          ? "Choose ingredient…"
          : countMismatch
          ? "Unavailable for count"
          : "Not needed";
      }

      let densityHintText = "";

      if (densityCanBridge) {
        densityHintText = densityProfile
          ? `${densityProfile.gramsPerCup} g per US cup`
          : "Choose a density";
      } else if (countMismatch) {
        densityHintText = "Count units can't convert";
      } else if (densityProfile) {
        densityHintText = "Not used: matching unit types";
      }

      densityHint.textContent = densityHintText;
      densityHint.hidden = densityHintText === "";

      row.classList.toggle("needs-attention", result.status === "incomplete");
      feedbackRow.hidden = result.errors.length === 0;

      const errorMessage = feedbackRow.querySelector(".row-error");
      setTextIfChanged(
        errorMessage,
        result.errors.length > 0
          ? `Needs attention: ${result.errors
              .map(function (error) {
                return error.message;
              })
              .join(" ")}`
          : ""
      );

      // Associate every control in the row with the row-level message. The
      // usage input also points at its scaled-quantity hint when visible.
      const errorFields = new Set(
        result.errors.map(function (error) {
          return error.field;
        })
      );

      row.querySelectorAll("input, select").forEach(function (control) {
        const field = control.dataset.field;
        const describedBy = [];

        if (control === usageInput && showScaledUsage) {
          describedBy.push(`${viewId}-scaled`);
        }

        if (control === densitySelect) {
          describedBy.push(`${viewId}-density-hint`);
        }

        if (errorFields.has(field)) {
          control.setAttribute("aria-invalid", "true");
        } else {
          control.removeAttribute("aria-invalid");
        }

        if (result.errors.length > 0) {
          describedBy.push(`${viewId}-error`);
        }

        if (describedBy.length > 0) {
          control.setAttribute("aria-describedby", describedBy.join(" "));
        } else {
          control.removeAttribute("aria-describedby");
        }
      });

      removeButton.setAttribute(
        "aria-label",
        `Remove ${result.name || "ingredient"}`
      );
    });
  }

  function describeTotal(result) {
    if (!result.hasIngredients) {
      return result.ingredients.length > 0
        ? "No complete ingredients yet"
        : "No ingredients yet";
    }

    if (result.validIngredientCount === 0) {
      return "No complete ingredients yet";
    }

    const complete = `${result.validIngredientCount} ${pluralize(
      result.validIngredientCount,
      "ingredient",
      "ingredients"
    )} costed`;

    if (result.incompleteCount === 0) {
      return complete;
    }

    return `${complete} · ${result.incompleteCount} excluded`;
  }

  function describePerItem(result) {
    if (result.costPerItem === null) {
      if (result.totalCost === null) {
        return result.hasIngredients
          ? "No complete ingredients yet"
          : "Add complete ingredients";
      }

      if (!result.yieldIsValid) {
        return "Set a yield above 0";
      }

      return "Cost per item unavailable";
    }

    const description = result.yieldDescription || "items";
    let detail =
      `Based on ${format.formatQuantity(result.scaledYieldQuantity)} ` +
      description;

    if (result.multiplier !== 1) {
      detail += ` at ${format.formatMultiplier(result.multiplier)}`;
    }

    return detail;
  }

  function updateSummary(result) {
    const scaleText = format.formatMultiplier(result.multiplier);

    elements.total.textContent =
      result.totalCost === null ? "—" : format.formatCurrency(result.totalCost);
    elements.totalDetail.textContent = describeTotal(result);

    elements.perItem.textContent =
      result.costPerItem === null
        ? "—"
        : format.formatPerItemCurrency(result.costPerItem);
    elements.perItemLabel.textContent =
      `Per ${format.singularizeYield(result.yieldDescription)}`;
    elements.perItemDetail.textContent = describePerItem(result);

    elements.partialBadge.hidden = !result.isPartial;
    elements.partialBadge.title = result.isPartial
      ? "Incomplete ingredients are excluded from the total"
      : "";
    elements.ingredientCount.textContent = `${result.ingredientCount} ${pluralize(
      result.ingredientCount,
      "ingredient",
      "ingredients"
    )}`;

    if (result.yieldQuantity !== null) {
      elements.yieldValue.textContent =
        `${format.formatQuantity(result.scaledYieldQuantity)} ` +
        `${result.yieldDescription || "items"}`;
    } else {
      elements.yieldValue.textContent = "Not set";
    }

    const showBaseYield =
      result.yieldQuantity !== null && result.multiplier !== 1;
    elements.yieldDetail.hidden = !showBaseYield;
    elements.yieldDetail.textContent = showBaseYield
      ? `Base ${format.formatQuantity(result.yieldQuantity)}`
      : "";

    elements.summaryScale.textContent = scaleText;

    const notes = [];
    let hasWarning = false;

    if (!result.hasIngredients) {
      notes.push(
        result.ingredients.length > 0
          ? "Fill in an ingredient row to calculate a total."
          : "Add ingredients to start calculating."
      );
    } else if (result.incompleteCount > 0) {
      hasWarning = true;

      if (result.validIngredientCount === 0) {
        notes.push(
          "No complete ingredients yet. Fill in the highlighted fields to calculate a total."
        );
      } else {
        const count = result.incompleteCount;
        const noun = pluralize(count, "ingredient", "ingredients");
        const verb = count === 1 ? "is" : "are";

        notes.push(
          `${count} ${noun} ${verb} incomplete or invalid and ${verb} excluded. The total is partial.`
        );
      }
    }

    if (result.hasIngredients && !result.yieldIsValid) {
      hasWarning = true;
      notes.push(result.yieldError);
    }

    setTextIfChanged(elements.summaryNote, notes.join(" "));
    elements.summaryNote.hidden = notes.length === 0;
    elements.summaryNote.classList.toggle(
      "is-warning",
      hasWarning && notes.length > 0
    );
  }

  /* Scaling ----------------------------------------------------------------- */

  function readMultiplier(rawValue) {
    const trimmed = String(rawValue).trim();

    if (trimmed === "") {
      return null;
    }

    const value = Number(trimmed);
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  function clearScaleError() {
    elements.scaleError.textContent = "";
    elements.scaleError.hidden = true;
    elements.customScale.removeAttribute("aria-invalid");
  }

  function showScaleError(message) {
    elements.scaleError.textContent = message;
    elements.scaleError.hidden = false;
    elements.customScale.setAttribute("aria-invalid", "true");
  }

  function updateScaleControls() {
    const recipe = activeRecipe();

    if (!recipe) {
      return;
    }

    const scaleText = format.formatMultiplier(recipe.multiplier);

    setTextIfChanged(elements.activeMultiplier, scaleText);
    setTextIfChanged(elements.summaryScale, scaleText);

    elements.scaleButtons.forEach(function (button) {
      const buttonScale = Number(button.dataset.scale);
      button.setAttribute(
        "aria-pressed",
        Math.abs(buttonScale - recipe.multiplier) < 1e-9 ? "true" : "false"
      );
    });

    if (document.activeElement !== elements.customScale) {
      elements.customScale.value = stringValue(recipe.multiplier);
    }
  }

  function applyMultiplier(multiplier) {
    const recipe = activeRecipe();

    if (!recipe) {
      return;
    }

    recipe.multiplier = multiplier;
    clearScaleError();
    updateScaleControls();
    updateCalculations();
    scheduleSave();
  }

  /* Recipe fields and ingredients ------------------------------------------ */

  function handleYieldQuantityInput(event) {
    const recipe = activeRecipe();

    if (!recipe) {
      return;
    }

    recipe.yieldQuantity = event.target.value;
    updateCalculations();
    scheduleSave();
  }

  function handleYieldDescriptionInput(event) {
    const recipe = activeRecipe();

    if (!recipe) {
      return;
    }

    recipe.yieldDescription = event.target.value;
    updateCalculations();
    scheduleSave();
  }

  function handleIngredientFieldChange(event) {
    const control = event.target.closest("[data-field]");

    if (!control) {
      return;
    }

    const isSelect = control.tagName === "SELECT";

    // Selects are handled by "change"; text and number inputs by "input".
    if (
      (event.type === "input" && isSelect) ||
      (event.type === "change" && !isSelect)
    ) {
      return;
    }

    const row = control.closest("[data-ingredient-id]");
    const recipe = activeRecipe();

    if (!row || !recipe) {
      return;
    }

    const ingredient = recipe.ingredients.find(function (item) {
      return item.id === row.dataset.ingredientId;
    });

    if (!ingredient) {
      return;
    }

    const field = control.dataset.field;

    if (!ALLOWED_INGREDIENT_FIELDS.includes(field)) {
      return;
    }

    ingredient[field] = control.value;
    updateCalculations();
    scheduleSave();
  }

  function handleAddIngredient() {
    const recipe = activeRecipe();

    if (!recipe) {
      return;
    }

    const ingredient = storage.createIngredient();
    recipe.ingredients.push(ingredient);
    renderIngredientRows(ingredient.id);
    scheduleSave();
  }

  function handleIngredientClick(event) {
    const removeButton = event.target.closest('[data-action="remove"]');
    const recipe = activeRecipe();

    if (!removeButton || !recipe) {
      return;
    }

    const row = removeButton.closest("[data-ingredient-id]");

    if (!row) {
      return;
    }

    const index = recipe.ingredients.findIndex(function (ingredient) {
      return ingredient.id === row.dataset.ingredientId;
    });

    if (index === -1) {
      return;
    }

    recipe.ingredients.splice(index, 1);

    const nextIngredient =
      recipe.ingredients[index] || recipe.ingredients[index - 1] || null;

    renderIngredientRows(nextIngredient ? nextIngredient.id : null);
    scheduleSave();

    if (!nextIngredient) {
      elements.emptyAddIngredient.focus();
    }
  }

  function handleScalePreset(event) {
    const value = Number(event.currentTarget.dataset.scale);

    if (Number.isFinite(value) && value > 0) {
      applyMultiplier(value);
    }
  }

  function handleCustomScaleInput() {
    const value = readMultiplier(elements.customScale.value);

    if (value === null) {
      // While the field is empty, leave the last valid multiplier in place.
      // Invalid non-empty values get a clear message immediately.
      if (elements.customScale.value.trim() !== "") {
        showScaleError("Enter a batch multiplier greater than 0.");
      } else {
        clearScaleError();
      }
      return;
    }

    clearScaleError();
    applyMultiplier(value);
  }

  function handleCustomScaleBlur() {
    const recipe = activeRecipe();

    if (!recipe) {
      return;
    }

    const value = readMultiplier(elements.customScale.value);

    if (value === null) {
      elements.customScale.value = stringValue(recipe.multiplier);
      clearScaleError();
      return;
    }

    if (value !== recipe.multiplier) {
      applyMultiplier(value);
    }

    // Normalize entries such as "02" back to the applied multiplier.
    elements.customScale.value = stringValue(recipe.multiplier);
  }

  /* Import and export ------------------------------------------------------- */

  function uniqueNameMessage(renamed) {
    if (renamed.length === 0) {
      return "";
    }

    const shown = renamed.slice(0, 3).map(function (item) {
      return `“${item.from}” to “${item.to}”`;
    });

    let message = `Renamed ${shown.join(", ")}`;

    if (renamed.length > shown.length) {
      message += ` and ${renamed.length - shown.length} more`;
    }

    return `${message} to avoid duplicate names.`;
  }

  /**
   * Imported files already get fresh IDs from storage.js. This extra pass
   * guards against the vanishingly small chance of a collision with an ID
   * that is already in the current session.
   */
  function assignUniqueImportIds(recipes) {
    const usedRecipeIds = new Set(
      state.recipes.map(function (recipe) {
        return recipe.id;
      })
    );
    const usedIngredientIds = new Set();

    state.recipes.forEach(function (recipe) {
      recipe.ingredients.forEach(function (ingredient) {
        usedIngredientIds.add(ingredient.id);
      });
    });

    recipes.forEach(function (recipe) {
      if (usedRecipeIds.has(recipe.id)) {
        recipe.id = storage.createRecipe().id;
      }

      usedRecipeIds.add(recipe.id);

      recipe.ingredients.forEach(function (ingredient) {
        if (usedIngredientIds.has(ingredient.id)) {
          ingredient.id = storage.createIngredient().id;
        }

        usedIngredientIds.add(ingredient.id);
      });
    });
  }

  function readFileText(file) {
    return new Promise(function (resolve, reject) {
      if (typeof file.text === "function") {
        file.text().then(resolve, reject);
        return;
      }

      const reader = new FileReader();
      reader.onload = function () {
        resolve(String(reader.result));
      };
      reader.onerror = function () {
        reject(reader.error || new Error("Could not read the file."));
      };
      reader.readAsText(file);
    });
  }

  function handleImportFileChange() {
    const file =
      elements.importFile.files && elements.importFile.files.length > 0
        ? elements.importFile.files[0]
        : null;

    if (!file) {
      return;
    }

    readFileText(file)
      .then(function (text) {
        const parsed = storage.parseBackupText(text);

        if (!parsed.ok) {
          showNotice(`Import failed. ${parsed.error}`, "error");
          return;
        }

        const resolved = storage.resolveNameConflicts(
          parsed.recipes,
          storage.collectRecipeNames(state.recipes)
        );

        assignUniqueImportIds(resolved.recipes);

        state.recipes = state.recipes.concat(resolved.recipes);
        state.activeRecipeId = resolved.recipes[0].id;

        renderRecipeSelector();
        renderActiveRecipe();

        const saveResult = saveNow();
        const count = resolved.recipes.length;
        const imported = `imported ${count} ${pluralize(
          count,
          "recipe",
          "recipes"
        )}`;
        const renameMessage = uniqueNameMessage(resolved.renamed);

        if (saveResult.ok) {
          showNotice(
            `Successfully ${imported}.${
              renameMessage ? ` ${renameMessage}` : ""
            }`,
            "success"
          );
        } else {
          showNotice(
            `Imported ${count} ${pluralize(
              count,
              "recipe",
              "recipes"
            )}, but the change could not be saved: ${saveResult.error}`,
            "error"
          );
        }
      })
      .catch(function () {
        showNotice(
          "Import failed. The selected file could not be read.",
          "error"
        );
      })
      .then(function () {
        elements.importFile.value = "";
        elements.importRecipes.focus();
      });
  }

  function exportDateStamp() {
    const now = new Date();
    const pad = function (value) {
      return String(value).padStart(2, "0");
    };

    return (
      `${now.getFullYear()}-` +
      `${pad(now.getMonth() + 1)}-` +
      `${pad(now.getDate())}`
    );
  }

  function handleExport() {
    const snapshot = storage.buildSnapshot(state);
    const validation = storage.parseBackupData(snapshot, {
      preserveIds: true
    });

    if (!validation.ok) {
      showNotice(
        `Export failed. Fix invalid values first: ${validation.error}`,
        "error"
      );
      return;
    }

    const json = JSON.stringify(snapshot, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `platerate-recipes-${exportDateStamp()}.json`;
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);

    const count = snapshot.recipes.length;

    showNotice(
      `Exported ${count} ${pluralize(count, "recipe", "recipes")}.`,
      "success"
    );
  }

  function handleDocumentKeydown(event) {
    if (event.key === "Escape" && !elements.deleteConfirm.hidden) {
      event.preventDefault();
      closeDeleteConfirm(true);
    }
  }

  /* Wiring ------------------------------------------------------------------ */

  function bindEvents() {
    elements.recipeSelect.addEventListener(
      "change",
      handleRecipeSelectChange
    );
    elements.newRecipe.addEventListener("click", handleNewRecipe);
    elements.importRecipes.addEventListener("click", function () {
      elements.importFile.value = "";
      elements.importFile.click();
    });
    elements.importFile.addEventListener("change", handleImportFileChange);
    elements.exportRecipes.addEventListener("click", handleExport);

    elements.noticeDismiss.addEventListener("click", hideNotice);

    elements.recipeName.addEventListener("input", handleRecipeNameInput);
    elements.recipeName.addEventListener("change", commitRecipeName);
    elements.yieldQuantity.addEventListener("input", handleYieldQuantityInput);
    elements.yieldDescription.addEventListener(
      "input",
      handleYieldDescriptionInput
    );

    elements.rows.addEventListener("input", handleIngredientFieldChange);
    elements.rows.addEventListener("change", handleIngredientFieldChange);
    elements.rows.addEventListener("click", handleIngredientClick);
    elements.addIngredient.addEventListener("click", handleAddIngredient);
    elements.emptyAddIngredient.addEventListener("click", handleAddIngredient);

    elements.scaleButtons.forEach(function (button) {
      button.addEventListener("click", handleScalePreset);
    });
    elements.customScale.addEventListener("input", handleCustomScaleInput);
    elements.customScale.addEventListener("blur", handleCustomScaleBlur);

    elements.deleteRecipe.addEventListener("click", handleDeleteRequest);
    elements.confirmDelete.addEventListener("click", handleConfirmDelete);
    elements.cancelDelete.addEventListener("click", function () {
      closeDeleteConfirm(true);
    });
    document.addEventListener("keydown", handleDocumentKeydown);

    // Flush a pending debounce when the page is hidden or closed so the last
    // keystroke is not lost between edits.
    function flushPendingSave() {
      if (saveTimer !== null) {
        saveNow({ silent: true });
      }
    }

    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") {
        flushPendingSave();
      }
    });
    window.addEventListener("pagehide", flushPendingSave);
  }

  function initialize() {
    cacheElements();

    const adapter = getStorageAdapter();
    const loaded = storage.loadFromStorage(adapter);
    let loadNotice = "";
    let renameNotice = "";

    if (loaded.ok && loaded.data && loaded.data.recipes.length > 0) {
      // Older saves (or a hand-edited file) might contain blank or duplicate
      // names. Normalize once at startup so the selector and blur-time rename
      // logic always start from unique, displayable names.
      const normalized = storage.resolveNameConflicts(loaded.data.recipes, []);
      const savedActiveId = loaded.data.activeRecipeId;
      const activeExists = normalized.recipes.some(function (recipe) {
        return recipe.id === savedActiveId;
      });

      state.recipes = normalized.recipes;
      state.activeRecipeId = activeExists
        ? savedActiveId
        : state.recipes[0].id;

      if (normalized.renamed.length > 0) {
        renameNotice = `Saved recipes had duplicate names. ${uniqueNameMessage(
          normalized.renamed
        )}`;
      }
    } else {
      let quarantined = false;

      if (!loaded.ok && loaded.raw) {
        quarantined = storage.quarantineUnreadableData(adapter, loaded.raw).ok;
      }

      const recipe = storage.createRecipe();
      state.recipes = [recipe];
      state.activeRecipeId = recipe.id;

      if (!loaded.ok) {
        if (loaded.raw) {
          loadNotice = quarantined
            ? `${loaded.error} The unreadable data was preserved for ` +
              "recovery, and a new recipe was started."
            : `${loaded.error} The unreadable data could not be copied to ` +
              "a recovery key, and a new recipe was started.";
        } else {
          loadNotice =
            `${loaded.error} A new recipe was started; changes may not be saved.`;
        }
      }
    }

    bindEvents();
    renderRecipeSelector();
    renderActiveRecipe();
    setSaveStatus("saved");

    // Persist the initial record (and the restored active recipe).
    saveNow({ silent: true });

    if (loadNotice) {
      showNotice(loadNotice, "error");
    } else if (renameNotice) {
      showNotice(renameNotice, "success");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize);
  } else {
    initialize();
  }
})();
