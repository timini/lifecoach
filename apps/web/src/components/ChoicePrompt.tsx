'use client';

import { useState } from 'react';

export interface ChoicePromptProps {
  question: string;
  options: string[];
  single: boolean;
  disabled: boolean;
  onSubmit: (answer: string) => void;
}

export function ChoicePrompt({ question, options, single, disabled, onSubmit }: ChoicePromptProps) {
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  function toggle(opt: string) {
    if (disabled) return;
    setChosen((prev) => {
      if (single) return new Set([opt]);
      const next = new Set(prev);
      if (next.has(opt)) next.delete(opt);
      else next.add(opt);
      return next;
    });
  }

  function submit() {
    if (chosen.size === 0 || disabled) return;
    const answer = Array.from(chosen).join(', ');
    onSubmit(answer);
  }

  return (
    <div
      style={{
        background: '#1e293b',
        border: '1px solid #334',
        borderRadius: 12,
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        maxWidth: '90%',
        alignSelf: 'flex-start',
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 600 }}>{question}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {options.map((opt) => {
          const selected = chosen.has(opt);
          return (
            <label
              key={opt}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                cursor: disabled ? 'default' : 'pointer',
                opacity: disabled ? 0.5 : 1,
                fontSize: 14,
              }}
            >
              <input
                type={single ? 'radio' : 'checkbox'}
                checked={selected}
                onChange={() => toggle(opt)}
                disabled={disabled}
                name={`choice-${question}`}
              />
              {opt}
            </label>
          );
        })}
      </div>
      <button
        type="button"
        onClick={submit}
        disabled={disabled || chosen.size === 0}
        style={{
          alignSelf: 'flex-start',
          padding: '6px 12px',
          borderRadius: 6,
          border: 'none',
          background: '#2563eb',
          color: 'white',
          fontSize: 13,
          fontWeight: 600,
          cursor: disabled || chosen.size === 0 ? 'default' : 'pointer',
          opacity: disabled || chosen.size === 0 ? 0.5 : 1,
        }}
      >
        {single ? 'Select' : 'Submit'}
      </button>
    </div>
  );
}
