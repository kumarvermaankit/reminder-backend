import { estimateCalories } from './calorie-estimator';

describe('estimateCalories', () => {
  it('estimates individual food items', () => {
    expect(estimateCalories('rice')).toBeGreaterThan(150);
    expect(estimateCalories('chicken')).toBeGreaterThan(200);
    expect(estimateCalories('salad')).toBeGreaterThan(10);
    expect(estimateCalories('chai')).toBe(50);
  });

  it('estimates a full meal description', () => {
    const result = estimateCalories('rice dal sabzi');
    expect(result).toBeGreaterThan(400);
  });

  it('handles quantity-based descriptions', () => {
    const result = estimateCalories('150gm rice, 100gm paneer');
    expect(result).toBeGreaterThan(400);
  });

  it('returns 250 for unknown food', () => {
    expect(estimateCalories('unknown food xyz')).toBe(250);
  });

  it('handles empty string', () => {
    expect(estimateCalories('')).toBe(250);
  });

  it('estimates Indian breakfast', () => {
    const cal = estimateCalories('2 idli, 1 vada, sambar');
    expect(cal).toBeGreaterThan(200);
  });

  it('estimates chicken biryani as non-zero', () => {
    expect(estimateCalories('chicken biryani')).toBeGreaterThan(200);
  });

  it('estimates multiple items with quantities', () => {
    const cal = estimateCalories('200gm rice, 2 roti, 150gm chicken curry');
    expect(cal).toBeGreaterThan(500);
  });

  it('handles beverages', () => {
    expect(estimateCalories('tea')).toBe(50);
    expect(estimateCalories('coffee')).toBe(50);
    expect(estimateCalories('juice')).toBe(150);
  });
});
