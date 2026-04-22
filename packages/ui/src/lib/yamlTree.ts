/**
 * Pure helpers for the editable YAML tree. Kept separate from the React
 * component so they can be unit-tested in the node environment.
 */

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export type JsonObject = { readonly [key: string]: JsonValue };

export type PathSegment = string | number;

function cloneValue<T extends JsonValue>(value: T): T {
  // structuredClone handles arrays/objects; primitives pass through unchanged.
  return structuredClone(value) as T;
}

/**
 * Immutable set at a path of mixed string (object key) / number (array index)
 * segments. Returns a new tree; the input is not mutated.
 */
export function setPath(
  root: JsonValue,
  path: readonly PathSegment[],
  value: JsonValue,
): JsonValue {
  if (path.length === 0) return cloneValue(value);
  const head = path[0] as PathSegment;
  const rest = path.slice(1);
  if (typeof head === 'number') {
    const arr = Array.isArray(root) ? [...root] : [];
    const next = setPath(arr[head] ?? null, rest, value);
    arr[head] = next;
    return arr as unknown as JsonValue;
  }
  const obj: Record<string, JsonValue> =
    root !== null && typeof root === 'object' && !Array.isArray(root)
      ? { ...(root as JsonObject) }
      : {};
  const child = head in obj ? obj[head] : null;
  obj[head] = setPath(child ?? null, rest, value);
  return obj;
}

/** Immutable delete at a path. Returns a new tree. */
export function deletePath(root: JsonValue, path: readonly PathSegment[]): JsonValue {
  if (path.length === 0) return null;
  const head = path[0] as PathSegment;
  const rest = path.slice(1);
  if (typeof head === 'number') {
    if (!Array.isArray(root)) return root;
    const arr = [...root];
    if (rest.length === 0) {
      arr.splice(head, 1);
    } else {
      arr[head] = deletePath(arr[head] ?? null, rest) as JsonValue;
    }
    return arr as unknown as JsonValue;
  }
  if (root === null || typeof root !== 'object' || Array.isArray(root)) return root;
  const obj: Record<string, JsonValue> = { ...(root as JsonObject) };
  if (rest.length === 0) {
    delete obj[head];
  } else {
    obj[head] = deletePath(obj[head] ?? null, rest) as JsonValue;
  }
  return obj;
}

/** Read the value at a path. Returns undefined if any segment is missing. */
export function getPath(root: JsonValue, path: readonly PathSegment[]): JsonValue | undefined {
  let cursor: JsonValue | undefined = root;
  for (const seg of path) {
    if (cursor === null || cursor === undefined) return undefined;
    if (typeof seg === 'number') {
      if (!Array.isArray(cursor)) return undefined;
      cursor = cursor[seg] ?? undefined;
      continue;
    }
    if (typeof cursor !== 'object' || Array.isArray(cursor)) return undefined;
    cursor = (cursor as JsonObject)[seg];
  }
  return cursor;
}

/**
 * Parses a user-typed string in an editable cell into a JSON value. Used by
 * the inline editor so typing `42` stores a number, `true` stores a boolean,
 * and empty stores null. Anything else falls through as a plain string.
 */
export function parseLeafInput(raw: string): JsonValue {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  if (trimmed === 'null') return null;
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    const n = Number(trimmed);
    if (Number.isFinite(n)) return n;
  }
  return raw;
}

/** Render a JSON value as a one-line editable string. Null → empty. */
export function formatLeafValue(value: JsonValue): string {
  if (value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

/**
 * Splits a dotted path like `pets.name` into segments. Numeric segments (for
 * array indexing) are only produced when the segment parses cleanly as a
 * non-negative integer — lets users add array items via `items.0`.
 */
export function parseDottedPath(dotted: string): PathSegment[] {
  return dotted
    .split('.')
    .filter((s) => s.length > 0)
    .map((s) => (/^\d+$/.test(s) ? Number(s) : s));
}
