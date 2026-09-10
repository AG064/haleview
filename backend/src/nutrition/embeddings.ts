const embeddingSize = 48;

function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function tokens(value: string): string[] {
  return value
    .toLocaleLowerCase("en-US")
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/gu, " ")
    .split(/\s+/u)
    .filter((token) => token.length > 1 && /[a-z]/u.test(token));
}

export function embedText(value: string): number[] {
  const vector = new Array<number>(embeddingSize).fill(0);
  const words = tokens(value);
  for (const token of words) {
    const first = hash(token) % embeddingSize;
    const second = hash(`${token}:sign`) % embeddingSize;
    vector[first] += 1;
    vector[second] += hash(`${token}:weight`) % 2 === 0 ? 0.5 : -0.5;
  }
  for (let index = 0; index < words.length - 1; index += 1) {
    const pair = `${words[index]} ${words[index + 1]}`;
    vector[hash(pair) % embeddingSize] += 0.75;
  }
  const length = Math.sqrt(vector.reduce((total, value) => total + value * value, 0));
  if (length === 0) {
    return vector;
  }
  return vector.map((value) => value / length);
}

export function cosineSimilarity(first: number[], second: number[]): number {
  if (first.length !== second.length || first.length === 0) {
    return 0;
  }
  let dot = 0;
  let firstLength = 0;
  let secondLength = 0;
  for (let index = 0; index < first.length; index += 1) {
    dot += first[index] * second[index];
    firstLength += first[index] * first[index];
    secondLength += second[index] * second[index];
  }
  if (firstLength === 0 || secondLength === 0) {
    return 0;
  }
  return dot / Math.sqrt(firstLength * secondLength);
}
