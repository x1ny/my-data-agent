import type { FlattenOptions } from "./types";

export function flattenObject(
  obj: Record<string, unknown>,
  options: FlattenOptions = {},
): Record<string, unknown> {
  const {
    separator = "_",
    maxDepth = 10,
    arrayHandling = "stringify",
  } = options;

  const result: Record<string, unknown> = {};
  const conflictKeys = new Set<string>();

  function walk(current: unknown, prefix: string, depth: number): void {
    if (depth > maxDepth) {
      result[prefix] = null;
      return;
    }

    if (current === null || current === undefined) {
      result[prefix] = null;
      return;
    }

    if (typeof current === "string" || typeof current === "number" || typeof current === "boolean") {
      result[prefix] = current;
      return;
    }

    if (Array.isArray(current)) {
      if (arrayHandling === "stringify") {
        result[prefix] = JSON.stringify(current);
      }
      return;
    }

    if (typeof current === "object") {
      const keys = Object.keys(current as Record<string, unknown>);
      if (keys.length === 0) {
        result[prefix] = null;
        return;
      }

      for (const key of keys) {
        const value = (current as Record<string, unknown>)[key];
        const fullKey = resolveKey(prefix, key, separator, result, conflictKeys);
        walk(value, fullKey, depth + 1);
      }
      return;
    }

    result[prefix] = String(current);
  }

  for (const key of Object.keys(obj)) {
    walk(obj[key], key, 1);
  }

  return result;
}

function resolveKey(
  prefix: string,
  key: string,
  separator: string,
  result: Record<string, unknown>,
  conflictKeys: Set<string>,
): string {
  const candidate = prefix ? `${prefix}${separator}${key}` : key;

  if (candidate in result || conflictKeys.has(candidate)) {
    conflictKeys.add(candidate);
    const nestedKey = `${candidate}_nested`;
    conflictKeys.add(nestedKey);
    return nestedKey;
  }

  return candidate;
}