export const KG_PER_LB = 0.45359237;
export const G_PER_OZ = 28.349523125;

export const kgToLb = (kg: number) => kg / KG_PER_LB;
export const lbToKg = (lb: number) => lb * KG_PER_LB;
export const ozToG = (oz: number) => oz * G_PER_OZ;
export const gToOz = (g: number) => g / G_PER_OZ;

export function formatWeight(kg: number, unit: 'lb' | 'kg', decimals = 1): string {
  const v = unit === 'lb' ? kgToLb(kg) : kg;
  return `${v.toFixed(decimals)} ${unit}`;
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
