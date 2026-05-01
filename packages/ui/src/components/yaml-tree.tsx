'use client';

import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
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
import { Button } from './button';
import { Input } from './input';

export interface YamlTreeProps {
  value: JsonValue;
  onChange: (next: JsonValue) => void;
  /** Optional read-only mode — disables all edit controls. */
  readOnly?: boolean;
  className?: string;
}

export function YamlTree({ value, onChange, readOnly = false, className }: YamlTreeProps) {
  const initial = value ?? {};
  return (
    <div className={cn('flex flex-col gap-1 text-sm', className)}>
      <NodeRenderer
        path={[]}
        node={initial}
        onChange={(next) => onChange(next)}
        readOnly={readOnly}
      />
    </div>
  );
}

interface NodeProps {
  path: PathSegment[];
  node: JsonValue;
  onChange: (next: JsonValue) => void;
  readOnly: boolean;
}

function NodeRenderer({ path, node, onChange, readOnly }: NodeProps) {
  if (node === null || node === undefined) {
    return <LeafRow path={path} value={null} onChange={onChange} readOnly={readOnly} />;
  }
  if (Array.isArray(node)) {
    return <ArrayNode path={path} items={node} onChange={onChange} readOnly={readOnly} />;
  }
  if (typeof node === 'object') {
    return (
      <ObjectNode
        path={path}
        obj={node as Record<string, JsonValue>}
        onChange={onChange}
        readOnly={readOnly}
      />
    );
  }
  return <LeafRow path={path} value={node} onChange={onChange} readOnly={readOnly} />;
}

function ObjectNode({
  path,
  obj,
  onChange,
  readOnly,
}: {
  path: PathSegment[];
  obj: Record<string, JsonValue>;
  onChange: (next: JsonValue) => void;
  readOnly: boolean;
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
}: {
  path: PathSegment[];
  items: readonly JsonValue[];
  onChange: (next: JsonValue) => void;
  readOnly: boolean;
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
}: {
  path: PathSegment[];
  label: string;
  child: JsonValue;
  onChange: (next: JsonValue) => void;
  onDelete: () => void;
  readOnly: boolean;
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
          <LeafRow path={path} value={child} onChange={onChange} readOnly={readOnly} />
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
    <div className="rounded-[var(--radius-container)] bg-muted/10 p-2">
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
        <div className="mt-2 pl-3">
          <NodeRenderer path={path} node={child} onChange={onChange} readOnly={readOnly} />
        </div>
      ) : null}
    </div>
  );
}

function LeafRow({
  value,
  onChange,
  readOnly,
}: {
  path: PathSegment[];
  value: JsonValue;
  onChange: (next: JsonValue) => void;
  readOnly: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(formatLeafValue(value));
  if (readOnly || !editing) {
    return (
      <button
        type="button"
        onClick={() => {
          if (readOnly) return;
          setDraft(formatLeafValue(value));
          setEditing(true);
        }}
        className={cn(
          'w-full truncate rounded-sm border border-transparent px-2 py-1 text-left text-sm',
          value === null ? 'text-muted-foreground' : 'text-foreground',
          !readOnly && 'hover:border-border hover:bg-muted/40',
        )}
      >
        {value === null ? 'Empty' : formatLeafValue(value)}
      </button>
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
