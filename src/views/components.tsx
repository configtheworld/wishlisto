import type { Child, FC } from 'hono/jsx';
import type { Locale } from '../lib/i18n.js';
import { translate } from '../lib/i18n.js';
import { Icon } from './icons.js';

export const Avatar: FC<{
  seed: string;
  size?: number;
  class?: string;
  decorative?: boolean;
  alt?: string;
}> = ({ seed, size = 64, class: className, decorative = false, alt }) => {
  const src = `/avatar?seed=${encodeURIComponent(seed)}&size=${size}`;
  return (
    <img
      src={src}
      width={size}
      height={size}
      alt={decorative ? '' : (alt ?? '')}
      aria-hidden={decorative ? 'true' : undefined}
      class={className ? `avatar ${className}` : 'avatar'}
      loading="lazy"
      decoding="async"
    />
  );
};

export const Hearts: FC<{ value: number; label: string }> = ({ value, label }) => (
  <span class="hearts" role="img" aria-label={label}>
    <span aria-hidden="true">
      {[1, 2, 3].map((n) => (
        <span class={n <= value ? 'heart is-full' : 'heart is-empty'}>{n <= value ? '♥' : '♡'}</span>
      ))}
    </span>
  </span>
);

export const FormErrors: FC<{ errors: string[]; locale: Locale }> = ({ errors, locale }) => {
  if (errors.length === 0) return null;
  return (
    <div class="notice notice-error" role="alert">
      <Icon name="lock" size={18} />
      <ul class="error-list">
        {errors.map((key) => (
          <li>{translate(locale, key)}</li>
        ))}
      </ul>
    </div>
  );
};

export const PageHeader: FC<{ title: string; subtitle?: string; backHref?: string; backLabel?: string; children?: Child }> = ({
  title,
  subtitle,
  backHref,
  backLabel,
  children,
}) => (
  <div class="page-header">
    {backHref ? (
      <a class="back-link" href={backHref}>
        <Icon name="arrow-left" size={16} /> {backLabel}
      </a>
    ) : null}
    <div class="page-header-row">
      <div>
        <h1>{title}</h1>
        {subtitle ? <p class="subtitle">{subtitle}</p> : null}
      </div>
      {children ? <div class="page-actions">{children}</div> : null}
    </div>
  </div>
);

export const EmptyState: FC<{ title: string; text: string; children?: Child }> = ({ title, text, children }) => (
  <section class="empty-state card">
    <div class="empty-art" aria-hidden="true">
      <svg viewBox="0 0 160 120" width="160" height="120" fill="none" role="presentation">
        <path d="M30 92c-12-9-18-23-14-36 4-13 17-22 31-21 7-16 25-25 42-21 17 4 28 19 27 36 11 3 18 13 17 24-1 12-11 21-23 21H42c-5 0-9-1-12-3Z" fill="var(--avatar-blob)" />
        <path d="M80 65c-6-7-17-6-22 1-5 8 1 16 22 28 21-12 27-20 22-28-5-7-16-8-22-1Z" fill="var(--accent-strong)" />
        <path d="m34 30 2.4 6.6L43 39l-6.6 2.4L34 48l-2.4-6.6L25 39l6.6-2.4Z" fill="var(--star)" />
        <path d="m127 22 1.8 5 5 1.8-5 1.8-1.8 5-1.8-5-5-1.8 5-1.8Z" fill="var(--star)" />
      </svg>
    </div>
    <h2>{title}</h2>
    <p>{text}</p>
    {children ? <div class="empty-actions">{children}</div> : null}
  </section>
);

function inputId(name: string): string {
  return `field-${name.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

export const TextField: FC<{
  name: string;
  label: string;
  value?: string;
  type?: string;
  placeholder?: string;
  hint?: string;
  required?: boolean;
  autocomplete?: string;
  maxlength?: number;
  inputmode?: 'text' | 'decimal' | 'numeric' | 'url' | 'search';
  min?: number;
  max?: number;
  step?: string;
  id?: string;
  disabled?: boolean;
  spellcheck?: boolean;
  pattern?: string;
}> = ({
  name,
  label,
  value = '',
  type = 'text',
  placeholder,
  hint,
  required,
  autocomplete,
  maxlength,
  inputmode,
  min,
  max,
  step,
  id,
  disabled,
  spellcheck,
  pattern,
}) => {
  const fieldId = id ?? inputId(name);
  const hintId = hint ? `${fieldId}-hint` : undefined;
  return (
    <div class="field">
      <label for={fieldId}>
        {label}
        {required ? (
          <span class="required-mark" aria-hidden="true">
            {' '}
            *
          </span>
        ) : null}
      </label>
      <input
        id={fieldId}
        name={name}
        type={type}
        value={value}
        placeholder={placeholder}
        required={required}
        autocomplete={autocomplete}
        maxlength={maxlength}
        inputmode={inputmode}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        spellcheck={spellcheck}
        pattern={pattern}
        aria-describedby={hintId}
      />
      {hint ? (
        <p class="hint" id={hintId}>
          {hint}
        </p>
      ) : null}
    </div>
  );
};

export const TextareaField: FC<{
  name: string;
  label: string;
  value?: string;
  hint?: string;
  placeholder?: string;
  rows?: number;
  maxlength?: number;
  required?: boolean;
}> = ({ name, label, value = '', hint, placeholder, rows = 4, maxlength, required }) => {
  const fieldId = inputId(name);
  const hintId = hint ? `${fieldId}-hint` : undefined;
  return (
    <div class="field">
      <label for={fieldId}>
        {label}
        {required ? (
          <span class="required-mark" aria-hidden="true">
            {' '}
            *
          </span>
        ) : null}
      </label>
      <textarea
        id={fieldId}
        name={name}
        rows={rows}
        placeholder={placeholder}
        maxlength={maxlength}
        required={required}
        aria-describedby={hintId}
      >
        {value}
      </textarea>
      {hint ? (
        <p class="hint" id={hintId}>
          {hint}
        </p>
      ) : null}
    </div>
  );
};

export const SelectField: FC<{
  name: string;
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  hint?: string;
  required?: boolean;
}> = ({ name, label, value, options, hint, required }) => {
  const fieldId = inputId(name);
  const hintId = hint ? `${fieldId}-hint` : undefined;
  return (
    <div class="field">
      <label for={fieldId}>
        {label}
        {required ? (
          <span class="required-mark" aria-hidden="true">
            {' '}
            *
          </span>
        ) : null}
      </label>
      <select id={fieldId} name={name} required={required} aria-describedby={hintId} class="select">
        {options.map((option) => (
          <option value={option.value} selected={option.value === value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint ? (
        <p class="hint" id={hintId}>
          {hint}
        </p>
      ) : null}
    </div>
  );
};

export const CheckboxField: FC<{ name: string; label: string; checked?: boolean; hint?: string }> = ({
  name,
  label,
  checked,
  hint,
}) => {
  const fieldId = inputId(name);
  const hintId = hint ? `${fieldId}-hint` : undefined;
  return (
    <div class="checkbox-field">
      <input id={fieldId} type="checkbox" name={name} value="1" checked={checked} aria-describedby={hintId} />
      <label for={fieldId}>{label}</label>
      {hint ? (
        <p class="hint" id={hintId}>
          {hint}
        </p>
      ) : null}
    </div>
  );
};

export const Alert: FC<{ title: string; text: string; tone?: 'error' | 'info' }> = ({ title, text, tone = 'error' }) => (
  <div class={tone === 'error' ? 'notice notice-error' : 'notice notice-info'} role={tone === 'error' ? 'alert' : undefined}>
    <Icon name={tone === 'error' ? 'lock' : 'sparkles'} size={20} />
    <div>
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  </div>
);
