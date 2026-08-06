import { formatWeight, gToOz, kgToLb, lbToKg, ozToG, round1 } from '../units';

describe('unit conversions (canonical units are g and kg, PLAN §4)', () => {
  it('round-trips kg↔lb and g↔oz', () => {
    expect(lbToKg(kgToLb(80))).toBeCloseTo(80, 10);
    expect(gToOz(ozToG(3))).toBeCloseTo(3, 10);
  });

  it('uses exact definition factors', () => {
    expect(lbToKg(1)).toBeCloseTo(0.45359237, 8);
    expect(ozToG(1)).toBeCloseTo(28.349523125, 8);
  });

  it('formatWeight converts for display only', () => {
    expect(formatWeight(80, 'kg')).toBe('80.0 kg');
    expect(formatWeight(80, 'lb')).toBe('176.4 lb');
  });

  it('round1 rounds to one decimal', () => {
    expect(round1(1.25)).toBe(1.3);
    expect(round1(1.24)).toBe(1.2);
  });
});
