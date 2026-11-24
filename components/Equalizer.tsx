import { useEffect, useRef, type KeyboardEvent } from 'react';
import { Plus, RotateCcw, Trash2, X } from 'lucide-react';
import { EQ_GAIN_MAX, EQ_GAIN_MIN } from '../config';
import { EQ_PRESETS, type EqualizerBand } from '../types';
import { EQ_LIMITS, FILTER_TYPES, MAX_PARAMETRIC_BANDS, eqBand, inRange, type AdvancedEqualizer } from '../services/equalizerSettings';
import type { EqualizerSettings, FilterKind, ParametricBand } from '../services/generated/native';
import { EqualizerGraph } from './EqualizerGraph';

interface EqualizerProps {
  enabled: boolean;
  onToggle: () => void;
  onClose: () => void;
  bands: EqualizerBand[];
  onBandChange: (index: number, gain: number) => void;
  onReset: () => void;
  currentPresetId: string;
  onPresetChange: (presetId: string) => void;
  settings: EqualizerSettings;
  onAdvancedChange: (patch: Partial<AdvancedEqualizer>) => void;
  sampleRate: number;
  syncError: string;
}

function NumberField({
  label,
  value,
  range,
  onCommit,
  disabled = false,
}: {
  label: string;
  value: number;
  range: { min: number; max: number; step: number };
  onCommit: (value: number) => void;
  disabled?: boolean;
}) {
  function finish(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.currentTarget.blur();
    }
  }
  return (
    <input
      key={value}
      type="number"
      aria-label={label}
      defaultValue={value}
      min={range.min}
      max={range.max}
      step={range.step}
      disabled={disabled}
      onKeyDown={finish}
      onBlur={(event) => {
        const next = event.currentTarget.valueAsNumber;
        if (inRange(next, range)) {
          if (next !== value) onCommit(next);
        } else {
          event.currentTarget.value = String(value);
        }
      }}
    />
  );
}

function ParametricBands({
  filters,
  sampleRate,
  update,
}: {
  filters: ParametricBand[];
  sampleRate: number;
  update: (bands: ParametricBand[]) => void;
}) {
  function change(index: number, patch: Partial<ParametricBand>) {
    update(filters.map((band, i) => (i === index ? { ...band, ...patch } : band)));
  }
  return (
    <div className="eq-parametric">
      <div className="eq-filter-heading">
        <h3>Filters</h3>
        <button
          type="button"
          className="button"
          disabled={filters.length >= MAX_PARAMETRIC_BANDS}
          onClick={() => update([...filters, eqBand(1000)])}
        >
          <Plus size={14} /> Add filter
        </button>
      </div>
      {filters.length > 0 && (
        <div className="eq-filter-list">
          <div className="eq-filter-row eq-filter-labels" aria-hidden="true">
            <span>On</span>
            <span>Type</span>
            <span>Hz</span>
            <span>dB</span>
            <span>Q</span>
            <span />
          </div>
          {filters.map((filter, index) => {
            const label = `Filter ${index + 1}`;
            const kind = FILTER_TYPES[filter.kind];
            const outside = filter.enabled && filter.frequency >= sampleRate * 0.49;
            return (
              <div className="eq-filter-row" key={index} data-disabled={!filter.enabled || outside}>
                <button
                  type="button"
                  role="switch"
                  className="eq-toggle"
                  aria-label={`Enable ${label.toLowerCase()}`}
                  aria-checked={filter.enabled}
                  onClick={() => change(index, { enabled: !filter.enabled })}
                >
                  <span className="eq-switch" aria-hidden="true" />
                </button>
                <select
                  aria-label={`${label} type`}
                  value={filter.kind}
                  onChange={(event) => change(index, { kind: event.currentTarget.value as FilterKind })}
                >
                  {Object.entries(FILTER_TYPES).map(([id, option]) => (
                    <option key={id} value={id}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <NumberField
                  label={`${label} frequency`}
                  value={filter.frequency}
                  range={EQ_LIMITS.frequency}
                  onCommit={(frequency) => change(index, { frequency })}
                />
                <NumberField
                  label={`${label} gain`}
                  value={filter.gain}
                  range={EQ_LIMITS.gain}
                  disabled={!kind.gain}
                  onCommit={(gain) => change(index, { gain })}
                />
                <NumberField
                  label={`${label} Q`}
                  value={filter.q}
                  range={EQ_LIMITS.q}
                  disabled={!kind.q}
                  onCommit={(q) => change(index, { q })}
                />
                <button
                  className="icon-button"
                  type="button"
                  aria-label={`Remove ${label.toLowerCase()}`}
                  onClick={() => update(filters.filter((_, i) => i !== index))}
                >
                  <Trash2 size={14} />
                </button>
                {outside && <span className="eq-nyquist">Above the output device’s frequency range</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Equalizer({
  enabled,
  onToggle,
  onClose,
  bands,
  onBandChange,
  onReset,
  currentPresetId,
  onPresetChange,
  settings,
  onAdvancedChange,
  sampleRate,
  syncError,
}: EqualizerProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const panel = dialog.current;
    const previous = document.activeElement;
    panel?.showModal();
    return () => {
      panel?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      className="equalizer-dialog"
      aria-labelledby="eq-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="equalizer-content">
        <header className="equalizer-header">
          <h2 id="eq-title">Equalizer</h2>
          <button className="icon-button" type="button" aria-label="Close equalizer" onClick={onClose} title="Close equalizer">
            <X size={19} />
          </button>
        </header>
        <div className="equalizer-settings">
          <div className="eq-modes" aria-label="Equalizer mode" role="group">
            <button
              type="button"
              className="button"
              aria-pressed={settings.mode === 'graphic'}
              onClick={() => onAdvancedChange({ mode: 'graphic' })}
            >
              Graphic
            </button>
            <button
              type="button"
              className="button"
              aria-pressed={settings.mode === 'parametric'}
              onClick={() => onAdvancedChange({ mode: 'parametric' })}
            >
              Parametric
            </button>
          </div>
          <button className="eq-toggle" type="button" role="switch" aria-checked={enabled} onClick={onToggle} aria-label="Enable equalizer">
            <span className="eq-switch" aria-hidden="true" />
            {enabled ? 'EQ on' : 'EQ bypassed'}
          </button>
          <button className="button" type="button" aria-label="Reset equalizer to flat" onClick={onReset}>
            <RotateCcw size={15} /> Reset
          </button>
        </div>
        {syncError && (
          <p className="eq-sync-error" role="alert">
            {syncError}
          </p>
        )}
        <EqualizerGraph settings={settings} sampleRate={sampleRate} enabled={enabled} />
        <div className="eq-gain-controls">
          <label className="eq-preset">
            Preamp{' '}
            <NumberField
              label="EQ preamp"
              value={settings.preampDb}
              range={EQ_LIMITS.preamp}
              onCommit={(preampDb) => onAdvancedChange({ preampDb })}
            />{' '}
            dB
          </label>
          <button
            className="eq-toggle"
            type="button"
            role="switch"
            aria-label="Automatic headroom"
            aria-checked={settings.autoHeadroom}
            title="Reduces preamp gain based on the calculated filter response"
            onClick={() => onAdvancedChange({ autoHeadroom: !settings.autoHeadroom })}
          >
            <span className="eq-switch" aria-hidden="true" /> Auto headroom
          </button>
          {settings.mode === 'graphic' && (
            <label className="eq-preset">
              Preset
              <select value={currentPresetId} onChange={(event) => onPresetChange(event.currentTarget.value)}>
                {EQ_PRESETS.map(({ id, label }) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {settings.mode === 'parametric' ? (
          <ParametricBands filters={settings.filters} sampleRate={sampleRate} update={(filters) => onAdvancedChange({ filters })} />
        ) : (
          <div className="eq-bands">
            {bands.map(({ frequency, gain }, index) => (
              <label className="eq-band" key={frequency}>
                <span className="eq-gain">
                  {gain > 0 ? '+' : ''}
                  {gain.toFixed(1)}
                </span>
                <input
                  type="range"
                  min={EQ_GAIN_MIN}
                  max={EQ_GAIN_MAX}
                  step={0.5}
                  value={gain}
                  aria-label={`${frequency} Hz`}
                  aria-valuetext={`${gain} dB`}
                  onChange={(event) => onBandChange(index, event.currentTarget.valueAsNumber)}
                />
                <span>{frequency < 1000 ? `${frequency} Hz` : `${frequency / 1000} kHz`}</span>
              </label>
            ))}
          </div>
        )}
      </div>
    </dialog>
  );
}
