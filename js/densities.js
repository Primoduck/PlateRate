/*
 * PlateRate ingredient densities
 *
 * Weight ↔ volume conversion needs an ingredient-specific density: one cup of
 * flour does not weigh the same as one cup of honey. PlateRate never guesses
 * this from an ingredient name. The user chooses a matching profile per
 * ingredient when the purchase and recipe units measure different things.
 *
 * Values are rounded, commonly cited US cooking averages expressed as grams
 * per US cup. They are based on standard references such as USDA FoodData
 * Central and the King Arthur Baking ingredient weight chart. Real weights
 * vary with brand, grind, packing method, humidity, and temperature, so these
 * are practical estimates rather than laboratory constants.
 */
(function (global) {
  "use strict";

  const REFERENCE_UNIT = "cup";
  const REFERENCE_UNIT_LABEL = "US cup";

  const GROUP_ORDER = [
    "Flours & grains",
    "Sugars & sweeteners",
    "Fats & oils",
    "Dairy",
    "Baking & pantry",
    "Produce & fruit",
    "Nuts & seeds",
    "Liquids & sauces"
  ];

  // gramsPerCup: approximate grams in one US customary cup (236.588 ml).
  const PROFILES = Object.freeze({
    // Flours & grains
    "all-purpose-flour": {
      id: "all-purpose-flour",
      name: "All-purpose flour",
      group: "Flours & grains",
      gramsPerCup: 125
    },
    "bread-flour": {
      id: "bread-flour",
      name: "Bread flour",
      group: "Flours & grains",
      gramsPerCup: 127
    },
    "cake-flour": {
      id: "cake-flour",
      name: "Cake flour",
      group: "Flours & grains",
      gramsPerCup: 114
    },
    "whole-wheat-flour": {
      id: "whole-wheat-flour",
      name: "Whole-wheat flour",
      group: "Flours & grains",
      gramsPerCup: 120
    },
    "almond-flour": {
      id: "almond-flour",
      name: "Almond flour",
      group: "Flours & grains",
      gramsPerCup: 96
    },
    cornmeal: {
      id: "cornmeal",
      name: "Cornmeal",
      group: "Flours & grains",
      gramsPerCup: 138
    },
    "rolled-oats": {
      id: "rolled-oats",
      name: "Rolled oats",
      group: "Flours & grains",
      gramsPerCup: 90
    },
    "white-rice-uncooked": {
      id: "white-rice-uncooked",
      name: "White rice, uncooked",
      group: "Flours & grains",
      gramsPerCup: 185
    },

    // Sugars & sweeteners
    "granulated-sugar": {
      id: "granulated-sugar",
      name: "Granulated sugar",
      group: "Sugars & sweeteners",
      gramsPerCup: 200
    },
    "brown-sugar-packed": {
      id: "brown-sugar-packed",
      name: "Brown sugar, packed",
      group: "Sugars & sweeteners",
      gramsPerCup: 220
    },
    "powdered-sugar": {
      id: "powdered-sugar",
      name: "Powdered sugar",
      group: "Sugars & sweeteners",
      gramsPerCup: 120
    },
    honey: {
      id: "honey",
      name: "Honey",
      group: "Sugars & sweeteners",
      gramsPerCup: 340
    },

    // Fats & oils
    butter: {
      id: "butter",
      name: "Butter",
      group: "Fats & oils",
      gramsPerCup: 227
    },
    "vegetable-oil": {
      id: "vegetable-oil",
      name: "Vegetable oil",
      group: "Fats & oils",
      gramsPerCup: 224
    },
    "olive-oil": {
      id: "olive-oil",
      name: "Olive oil",
      group: "Fats & oils",
      gramsPerCup: 216
    },
    "coconut-oil": {
      id: "coconut-oil",
      name: "Coconut oil",
      group: "Fats & oils",
      gramsPerCup: 218
    },
    shortening: {
      id: "shortening",
      name: "Shortening",
      group: "Fats & oils",
      gramsPerCup: 192
    },

    // Dairy
    milk: {
      id: "milk",
      name: "Milk",
      group: "Dairy",
      gramsPerCup: 244
    },
    "heavy-cream": {
      id: "heavy-cream",
      name: "Heavy cream",
      group: "Dairy",
      gramsPerCup: 240
    },
    buttermilk: {
      id: "buttermilk",
      name: "Buttermilk",
      group: "Dairy",
      gramsPerCup: 245
    },
    "sour-cream": {
      id: "sour-cream",
      name: "Sour cream",
      group: "Dairy",
      gramsPerCup: 240
    },
    yogurt: {
      id: "yogurt",
      name: "Yogurt",
      group: "Dairy",
      gramsPerCup: 245
    },
    "cream-cheese": {
      id: "cream-cheese",
      name: "Cream cheese",
      group: "Dairy",
      gramsPerCup: 232
    },
    "cheddar-shredded": {
      id: "cheddar-shredded",
      name: "Cheddar, shredded",
      group: "Dairy",
      gramsPerCup: 113
    },
    "parmesan-grated": {
      id: "parmesan-grated",
      name: "Parmesan, grated",
      group: "Dairy",
      gramsPerCup: 100
    },

    // Baking & pantry
    "cocoa-powder": {
      id: "cocoa-powder",
      name: "Cocoa powder",
      group: "Baking & pantry",
      gramsPerCup: 85
    },
    cornstarch: {
      id: "cornstarch",
      name: "Cornstarch",
      group: "Baking & pantry",
      gramsPerCup: 120
    },
    "baking-powder": {
      id: "baking-powder",
      name: "Baking powder",
      group: "Baking & pantry",
      gramsPerCup: 192
    },
    "baking-soda": {
      id: "baking-soda",
      name: "Baking soda",
      group: "Baking & pantry",
      gramsPerCup: 220
    },
    "table-salt": {
      id: "table-salt",
      name: "Table salt",
      group: "Baking & pantry",
      gramsPerCup: 292
    },
    "kosher-salt": {
      id: "kosher-salt",
      name: "Kosher salt",
      group: "Baking & pantry",
      gramsPerCup: 140
    },
    "chocolate-chips": {
      id: "chocolate-chips",
      name: "Chocolate chips",
      group: "Baking & pantry",
      gramsPerCup: 170
    },
    "peanut-butter": {
      id: "peanut-butter",
      name: "Peanut butter",
      group: "Baking & pantry",
      gramsPerCup: 256
    },

    // Produce & fruit
    blueberries: {
      id: "blueberries",
      name: "Blueberries",
      group: "Produce & fruit",
      gramsPerCup: 148
    },
    "strawberries-sliced": {
      id: "strawberries-sliced",
      name: "Strawberries, sliced",
      group: "Produce & fruit",
      gramsPerCup: 166
    },
    raisins: {
      id: "raisins",
      name: "Raisins",
      group: "Produce & fruit",
      gramsPerCup: 145
    },
    "onion-diced": {
      id: "onion-diced",
      name: "Onion, diced",
      group: "Produce & fruit",
      gramsPerCup: 160
    },
    "carrots-diced": {
      id: "carrots-diced",
      name: "Carrots, diced",
      group: "Produce & fruit",
      gramsPerCup: 128
    },
    "bell-pepper-diced": {
      id: "bell-pepper-diced",
      name: "Bell pepper, diced",
      group: "Produce & fruit",
      gramsPerCup: 149
    },

    // Nuts & seeds
    "walnuts-chopped": {
      id: "walnuts-chopped",
      name: "Walnuts, chopped",
      group: "Nuts & seeds",
      gramsPerCup: 117
    },
    "pecans-chopped": {
      id: "pecans-chopped",
      name: "Pecans, chopped",
      group: "Nuts & seeds",
      gramsPerCup: 109
    },
    "almonds-sliced": {
      id: "almonds-sliced",
      name: "Almonds, sliced",
      group: "Nuts & seeds",
      gramsPerCup: 92
    },
    "sesame-seeds": {
      id: "sesame-seeds",
      name: "Sesame seeds",
      group: "Nuts & seeds",
      gramsPerCup: 144
    },

    // Liquids & sauces
    water: {
      id: "water",
      name: "Water",
      group: "Liquids & sauces",
      gramsPerCup: 237
    },
    "maple-syrup": {
      id: "maple-syrup",
      name: "Maple syrup",
      group: "Liquids & sauces",
      gramsPerCup: 320
    },
    "soy-sauce": {
      id: "soy-sauce",
      name: "Soy sauce",
      group: "Liquids & sauces",
      gramsPerCup: 255
    },
    vinegar: {
      id: "vinegar",
      name: "Vinegar",
      group: "Liquids & sauces",
      gramsPerCup: 239
    },
    ketchup: {
      id: "ketchup",
      name: "Ketchup",
      group: "Liquids & sauces",
      gramsPerCup: 240
    },
    mayonnaise: {
      id: "mayonnaise",
      name: "Mayonnaise",
      group: "Liquids & sauces",
      gramsPerCup: 220
    },
    "tomato-puree": {
      id: "tomato-puree",
      name: "Tomato purée",
      group: "Liquids & sauces",
      gramsPerCup: 245
    }
  });

  function getProfile(profileId) {
    return Object.prototype.hasOwnProperty.call(PROFILES, profileId)
      ? PROFILES[profileId]
      : null;
  }

  function getProfiles() {
    return Object.values(PROFILES);
  }

  /**
   * Profiles grouped for optgroup rendering in a stable, familiar order.
   */
  function getGroupedProfiles() {
    return GROUP_ORDER.map(function (group) {
      return {
        id: group,
        label: group,
        profiles: getProfiles().filter(function (profile) {
          return profile.group === group;
        })
      };
    }).filter(function (group) {
      return group.profiles.length > 0;
    });
  }

  function formatProfileLabel(profile) {
    return `${profile.name} — ${profile.gramsPerCup} g/${REFERENCE_UNIT_LABEL}`;
  }

  const api = {
    REFERENCE_UNIT: REFERENCE_UNIT,
    REFERENCE_UNIT_LABEL: REFERENCE_UNIT_LABEL,
    GROUP_ORDER: GROUP_ORDER,
    PROFILES: PROFILES,
    getProfile: getProfile,
    getProfiles: getProfiles,
    getGroupedProfiles: getGroupedProfiles,
    formatProfileLabel: formatProfileLabel
  };

  global.PlateRate = global.PlateRate || {};
  global.PlateRate.densities = api;

  // Allows the pure module to be loaded directly by the Node test runner.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(globalThis);
