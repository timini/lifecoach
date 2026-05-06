'use client';

import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../atoms/button';
import { Input } from '../atoms/input';
import { cn } from '../lib/utils';
import {
  type JsonValue,
  type PathSegment,
  deletePath,
  formatLeafValue,
  parseDottedPath,
  parseLeafInput,
  setPath,
} from '../lib/yamlTree';

export interface YamlTreeProps {
  value: JsonValue;
  onChange: (next: JsonValue) => void;
  /** Optional read-only mode — disables all edit controls. */
  readOnly?: boolean;
  /**
   * `{ "family.children[0].name": "2026-05-06T18:32:00Z" }`-shaped lookup,
   * keyed by canonical dotted-path. When provided, the leaf row renders a
   * muted relative time next to the value so the user can see when each
   * fact was last set. Path is canonicalised with `pathKey` below — keep
   * the agent / API side using the same dotted-path convention.
   */
  modifiedAtByPath?: Readonly<Record<string, string>>;
  className?: string;
}

export function YamlTree({
  value,
  onChange,
  readOnly = false,
  modifiedAtByPath,
  className,
}: YamlTreeProps) {
  const initial = value ?? {};
  return (
    <div className={cn('flex flex-col gap-1 text-sm', className)}>
      <NodeRenderer
        path={[]}
        node={initial}
        onChange={(next) => onChange(next)}
        readOnly={readOnly}
        modifiedAtByPath={modifiedAtByPath ?? {}}
      />
    </div>
  );
}

interface NodeProps {
  path: PathSegment[];
  node: JsonValue;
  onChange: (next: JsonValue) => void;
  readOnly: boolean;
  modifiedAtByPath: Readonly<Record<string, string>>;
}

function NodeRenderer({ path, node, onChange, readOnly, modifiedAtByPath }: NodeProps) {
  if (node === null || node === undefined) {
    return (
      <LeafRow
        path={path}
        value={null}
        onChange={onChange}
        readOnly={readOnly}
        modifiedAt={modifiedAtByPath[pathKey(path)]}
      />
    );
  }
  if (Array.isArray(node)) {
    return (
      <ArrayNode
        path={path}
        items={node}
        onChange={onChange}
        readOnly={readOnly}
        modifiedAtByPath={modifiedAtByPath}
      />
    );
  }
  if (typeof node === 'object') {
    return (
      <ObjectNode
        path={path}
        obj={node as Record<string, JsonValue>}
        onChange={onChange}
        readOnly={readOnly}
        modifiedAtByPath={modifiedAtByPath}
      />
    );
  }
  return (
    <LeafRow
      path={path}
      value={node}
      onChange={onChange}
      readOnly={readOnly}
      modifiedAt={modifiedAtByPath[pathKey(path)]}
    />
  );
}

/**
 * Canonical dotted-path key. Mirrors the agent's `update_user_profile`
 * convention: object keys joined with `.`, array indices as `[i]`.
 *   ['family', 'children', 0, 'name']  →  'family.children[0].name'
 */
export function pathKey(path: readonly PathSegment[]): string {
  let out = '';
  for (const seg of path) {
    if (typeof seg === 'number') out += `[${seg}]`;
    else out += out.length === 0 ? seg : `.${seg}`;
  }
  return out;
}

function ObjectNode({
  path,
  obj,
  onChange,
  readOnly,
  modifiedAtByPath,
}: {
  path: PathSegment[];
  obj: Record<string, JsonValue>;
  onChange: (next: JsonValue) => void;
  readOnly: boolean;
  modifiedAtByPath: Readonly<Record<string, string>>;
}) {
  const entries = Object.entries(obj);
  return (
    <div className="flex flex-col gap-1">
      {entries.map(([key, child]) => (
        <KeyedRow
          key={key}
          path={[...path, key]}
          label={key}
          child={child}
          onChange={(next) => onChange({ ...obj, [key]: next })}
          onDelete={() => {
            const { [key]: _drop, ...rest } = obj;
            onChange(rest);
          }}
          readOnly={readOnly}
          modifiedAtByPath={modifiedAtByPath}
        />
      ))}
      {!readOnly ? (
        <AddFieldRow
          onAdd={(rawPath) => {
            const segs = parseDottedPath(rawPath);
            if (segs.length === 0) return;
            const next = setPath(obj, segs, null) as Record<string, JsonValue>;
            onChange(next);
          }}
        />
      ) : null}
    </div>
  );
}

function ArrayNode({
  path,
  items,
  onChange,
  readOnly,
  modifiedAtByPath,
}: {
  path: PathSegment[];
  items: readonly JsonValue[];
  onChange: (next: JsonValue) => void;
  readOnly: boolean;
  modifiedAtByPath: Readonly<Record<string, string>>;
}) {
  return (
    <div className="flex flex-col gap-1">
      {items.map((item, i) => {
        const itemPath = [...path, i] as PathSegment[];
        return (
          <div key={`${path.join('.')}-${i}`} className="flex items-start gap-2">
            <span className="mt-1 w-6 shrink-0 text-right text-[10px] text-muted-foreground">
              {i}.
            </span>
            <div className="flex-1">
              <NodeRenderer
                path={itemPath}
                node={item}
                onChange={(next) => {
                  const copy = [...items];
                  copy[i] = next;
                  onChange(copy);
                }}
                readOnly={readOnly}
                modifiedAtByPath={modifiedAtByPath}
              />
            </div>
            {!readOnly ? (
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Remove item ${i}`}
                onClick={() => {
                  const copy = deletePath(items as JsonValue, [i]);
                  onChange(copy);
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            ) : null}
          </div>
        );
      })}
      {!readOnly ? (
        <Button
          variant="subtle"
          size="sm"
          className="self-start"
          onClick={() => onChange([...items, null])}
        >
          <Plus className="h-3.5 w-3.5" /> Add item
        </Button>
      ) : null}
    </div>
  );
}

function KeyedRow({
  path,
  label,
  child,
  onChange,
  onDelete,
  readOnly,
  modifiedAtByPath,
}: {
  path: PathSegment[];
  label: string;
  child: JsonValue;
  onChange: (next: JsonValue) => void;
  onDelete: () => void;
  readOnly: boolean;
  modifiedAtByPath: Readonly<Record<string, string>>;
}) {
  const isContainer =
    child !== null &&
    typeof child === 'object' &&
    (Array.isArray(child) || Object.keys(child).length >= 0);
  const isObjectContainer = child !== null && typeof child === 'object' && !Array.isArray(child);
  const [open, setOpen] = useState(path.length < 1 ? true : isObjectContainer);
  if (!isContainer) {
    return (
      <div className="flex items-center gap-2 rounded-sm px-1 py-0.5 hover:bg-muted/40">
        <span className="w-40 shrink-0 truncate text-xs text-muted-foreground">{label}</span>
        <div className="flex-1">
          <LeafRow
            path={path}
            value={child}
            onChange={onChange}
            readOnly={readOnly}
            modifiedAt={modifiedAtByPath[pathKey(path)]}
          />
        </div>
        {!readOnly ? (
          <Button variant="ghost" size="sm" aria-label={`Remove ${label}`} onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        ) : null}
      </div>
    );
  }
  return (
    <div className="mt-3 first:mt-0">
      <div className="flex w-full items-center gap-1">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex flex-1 items-center gap-1 text-left text-xs font-semibold text-foreground"
        >
          {open ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
          {label}
          {Array.isArray(child) ? (
            <span className="ml-1 text-[10px] font-normal text-muted-foreground">
              [{(child as readonly JsonValue[]).length}]
            </span>
          ) : null}
        </button>
        {!readOnly ? (
          <Button variant="ghost" size="sm" aria-label={`Remove ${label}`} onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        ) : null}
      </div>
      {open ? (
        <div className="mt-2 border-l border-border/60 pl-3">
          <NodeRenderer
            path={path}
            node={child}
            onChange={onChange}
            readOnly={readOnly}
            modifiedAtByPath={modifiedAtByPath}
          />
        </div>
      ) : null}
    </div>
  );
}

function LeafRow({
  value,
  onChange,
  readOnly,
  modifiedAt,
}: {
  path: PathSegment[];
  value: JsonValue;
  onChange: (next: JsonValue) => void;
  readOnly: boolean;
  /** ISO 8601 timestamp from the audit log; renders as a muted relative
   * time next to the value (e.g. "yesterday", "Mar 5"). Undefined when
   * we have no history entry for this leaf — common for hand-edited
   * fields the agent never wrote. */
  modifiedAt?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(formatLeafValue(value));
  const stamp = modifiedAt ? formatModifiedAt(modifiedAt) : null;
  if (readOnly || !editing) {
    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            if (readOnly) return;
            setDraft(formatLeafValue(value));
            setEditing(true);
          }}
          className={cn(
            'flex-1 truncate rounded-sm border border-transparent px-2 py-1 text-left text-sm',
            value === null ? 'text-muted-foreground italic' : 'text-foreground',
            !readOnly && 'hover:border-border hover:bg-muted/40',
          )}
        >
          {value === null ? 'Empty' : formatLeafValue(value)}
        </button>
        {stamp ? (
          <time
            dateTime={modifiedAt}
            title={modifiedAt}
            className="shrink-0 text-[10px] text-muted-foreground"
          >
            {stamp}
          </time>
        ) : null}
      </div>
    );
  }
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onChange(parseLeafInput(draft));
        setEditing(false);
      }}
    >
      <Input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          onChange(parseLeafInput(draft));
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setDraft(formatLeafValue(value));
            setEditing(false);
          }
        }}
        className="flex-1"
      />
    </form>
  );
}

function AddFieldRow({ onAdd }: { onAdd: (path: string) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  if (!open) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="self-start text-muted-foreground"
        onClick={() => setOpen(true)}
      >
        <Plus className="h-3.5 w-3.5" /> Add field
      </Button>
    );
  }
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (draft.trim().length === 0) {
          setOpen(false);
          return;
        }
        onAdd(draft.trim());
        setDraft('');
        setOpen(false);
      }}
    >
      <Input
        autoFocus
        placeholder="key or dotted.path"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        className="flex-1"
      />
      <Button type="submit" size="sm">
        Add
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => {
          setDraft('');
          setOpen(false);
        }}
      >
        Cancel
      </Button>
    </form>
  );
}

/**
 * Format an ISO 8601 timestamp as a compact relative-ish label suitable
 * for the leaf-row footer. Within the last 7 days we render a humanised
 * relative form ("just now", "5m ago", "yesterday"); older dates fall
 * back to a short locale date. Exported for unit tests.
 */
export function formatModifiedAt(iso: string, now: Date = new Date()): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  const deltaMs = now.getTime() - t.getTime();
  if (deltaMs < 0) return t.toLocaleDateString();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (deltaMs < minute) return 'just now';
  if (deltaMs < hour) return `${Math.floor(deltaMs / minute)}m ago`;
  if (deltaMs < day) return `${Math.floor(deltaMs / hour)}h ago`;
  if (deltaMs < 2 * day) return 'yesterday';
  if (deltaMs < 7 * day) return `${Math.floor(deltaMs / day)}d ago`;
  return t.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Reduce an audit log to `{path → mostRecentISO}`. Pure: takes the raw
 * history array and walks it once, keeping the latest `at` per path.
 * Exported because the settings page composes the lookup before passing
 * to YamlTree (and unit tests want to assert it directly).
 */
export function lastModifiedByPath(
  entries: ReadonlyArray<{ path: string; at: string }>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of entries) {
    const prev = out[entry.path];
    if (!prev || entry.at > prev) out[entry.path] = entry.at;
  }
  return out;
}
