const FOOD_CALORIES: [RegExp, number, string?][] = [
  [/boiled rice|steamed rice|cooked rice/, 200, 'per 100g'],
  [/rice|biryani|pulao/, 200, 'per 100g'],
  [/roti|chapati|phulka|naan|paratha/, 120, 'per piece'],
  [/dal|daal|lentil|rajma|chole|chana|kabuli/, 200, 'per portion'],
  [/paneer/, 250, 'per 100g'],
  [/chicken (breast|tikka|curry|salad|biryani)/, 300, 'per portion'],
  [/egg|omelette/, 150, 'per 2 eggs'],
  [/fish|prawn|shrimp|salmon|tuna/, 250, 'per 150g'],
  [/mutton|lamb|beef|pork/, 350, 'per 150g'],
  [/sandwich|burger/, 400, 'per piece'],
  [/pizza/, 600, 'per slice'],
  [/pasta|maggi|noodles|macroni/, 350, 'per plate'],
  [/milk|doodh/, 120, 'per glass'],
  [/curd|yogurt|dahi|raita/, 80, 'per small bowl'],
  [/samosa/, 200, 'per piece'],
  [/dosa/, 250, 'per piece'],
  [/idli/, 80, 'per piece'],
  [/vada|pakora|bhajiya/, 150, 'per piece'],
  [/sabzi|vegetable|bhaji|subzi/, 100, 'per portion'],
  [/aloo|potato/, 150, 'per 100g'],
  [/salad|kheera|cucumber|tomato|onion/, 30, 'per serving'],
  [/fruit|apple|banana|orange|mango/, 100, 'per piece'],
  [/tea|chai|coffee/, 50, 'per cup'],
  [/juice|smoothie|shake/, 150, 'per glass'],
  [/cake|cookie|biscuit|pastry|donut/, 300, 'per piece'],
  [/ice.?cream|kulfi/, 250, 'per scoop'],
  [/chocolate|candy|chips/, 200, 'per pack'],
  [/soup/, 120, 'per bowl'],
];

export function estimateCalories(description: string): number {
  const lower = description.toLowerCase();
  let total = 0;

  const matchedFoods = new Set<string>();

  const quantityPattern = /(\d+)\s*(g|gm|gram|ml)\s+(.+)/g;
  let qMatch: RegExpExecArray | null;
  while ((qMatch = quantityPattern.exec(lower)) !== null) {
    const grams = parseInt(qMatch[1], 10);
    const food = qMatch[3].trim();
    for (const [regex, calPerUnit, note] of FOOD_CALORIES) {
      if (regex.test(food)) {
        const ratio = grams < 50 ? 0.5 : grams / 100;
        const cal = Math.round(calPerUnit * ratio);
        total += cal;
        matchedFoods.add(food);
      }
    }
  }

  for (const [regex, cal] of FOOD_CALORIES) {
    const match = lower.match(regex);
    if (match) {
      const fullMatch = match[0];
      if (matchedFoods.has(fullMatch)) continue;
      const numPrefix = lower.slice(0, match.index).match(/(\d+)\s*$/);
      const quantity = numPrefix ? parseInt(numPrefix[1], 10) : 1;
      total += cal * Math.min(quantity, 10);
      matchedFoods.add(fullMatch);
    }
  }

  if (total === 0) total = 250;
  return Math.round(total);
}
