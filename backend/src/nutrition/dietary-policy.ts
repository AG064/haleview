const rankingStyles = new Set(["mediterranean", "flexitarian"]);

export function restrictiveDietaryTags(values: readonly string[]): string[] {
  return values.filter((value) => !rankingStyles.has(value));
}

export function dietaryStylePreferences(values: readonly string[]): string[] {
  return values.filter((value) => rankingStyles.has(value));
}
