'use client';

import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { readSecretSetting } from '@/app/dashboard/settings/actions';
import { COUNTRY_OPTIONS, type SettingDefinition } from '@/lib/settings/registry';

const SECRET_KEEP_VALUE = '__KEEP_SECRET__';

export function SettingField({ definition, value }: { definition: SettingDefinition; value: unknown }) {
  const [revealed, setRevealed] = useState(false);
  const [textValue, setTextValue] = useState(definition.isSecret ? SECRET_KEEP_VALUE : stringValue(value));
  const [loadingSecret, setLoadingSecret] = useState(false);
  const inputType = definition.masked && !revealed ? 'password' : definition.input === 'url' ? 'url' : definition.input === 'number' ? 'number' : 'text';

  if (definition.input === 'boolean') {
    return (
      <FieldShell definition={definition}>
        <select name={definition.key} defaultValue={String(Boolean(value))} className="input">
          <option value="true">Enabled / true</option>
          <option value="false">Disabled / false</option>
        </select>
      </FieldShell>
    );
  }

  if (definition.input === 'json') {
    return (
      <FieldShell definition={definition}>
        <textarea name={definition.key} defaultValue={jsonString(value)} rows={6} className="input font-mono text-xs" />
      </FieldShell>
    );
  }

  if (definition.input === 'countries') {
    const selected = new Set(Array.isArray(value) ? value.map(String) : []);
    return (
      <FieldShell definition={definition}>
        <div className="grid gap-2 rounded-2xl border border-slate-200 p-3 sm:grid-cols-2">
          {COUNTRY_OPTIONS.map((option) => (
            <label key={option.value} className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
              <input type="checkbox" name={definition.key} value={option.value} defaultChecked={selected.has(option.value)} />
              {option.label} ({option.value})
            </label>
          ))}
        </div>
      </FieldShell>
    );
  }

  if (definition.options?.length) {
    return (
      <FieldShell definition={definition}>
        <select name={definition.key} defaultValue={String(value ?? '')} className="input">
          {definition.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </FieldShell>
    );
  }

  return (
    <FieldShell definition={definition}>
      <div className="flex gap-2">
        <input
          name={definition.key}
          type={inputType}
          value={textValue}
          onChange={(event) => setTextValue(event.target.value)}
          className="input min-w-0 flex-1"
          autoComplete="off"
        />
        {definition.masked ? (
          <button
            type="button"
            onClick={() => revealOrHideSecret({ definition, revealed, setRevealed, setTextValue, setLoadingSecret })}
            className="inline-flex items-center justify-center rounded-2xl border border-slate-200 px-3 text-slate-600 hover:bg-slate-50 disabled:opacity-60"
            aria-label={revealed ? 'Hide value' : 'Show value'}
            disabled={loadingSecret}
          >
            {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        ) : null}
      </div>
      {definition.isSecret && textValue === SECRET_KEEP_VALUE ? <span className="block text-xs font-normal text-slate-500">Saved secret is not sent to the browser. Click the eye to reveal it for editing, or leave unchanged.</span> : null}
    </FieldShell>
  );
}

async function revealOrHideSecret(input: {
  definition: SettingDefinition;
  revealed: boolean;
  setRevealed: (value: boolean) => void;
  setTextValue: (value: string) => void;
  setLoadingSecret: (value: boolean) => void;
}) {
  if (input.revealed) {
    input.setRevealed(false);
    return;
  }
  input.setLoadingSecret(true);
  try {
    if (input.definition.isSecret) {
      input.setTextValue(await readSecretSetting(input.definition.key));
    }
    input.setRevealed(true);
  } finally {
    input.setLoadingSecret(false);
  }
}

function FieldShell({ definition, children }: { definition: SettingDefinition; children: React.ReactNode }) {
  return (
    <label className="block space-y-2 text-sm font-semibold text-slate-700">
      <span className="flex flex-wrap items-center gap-2">
        {definition.label}
        {definition.envKey ? <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">{definition.envKey}</code> : null}
        {definition.isSecret ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-700">secret</span> : null}
      </span>
      {children}
      {definition.description ? <span className="block text-xs font-normal leading-5 text-slate-500">{definition.description}</span> : null}
    </label>
  );
}

function stringValue(value: unknown) {
  return value == null ? '' : typeof value === 'string' ? value : String(value);
}

function jsonString(value: unknown) {
  try {
    return JSON.stringify(value ?? null, null, 2);
  } catch {
    return String(value ?? '');
  }
}
