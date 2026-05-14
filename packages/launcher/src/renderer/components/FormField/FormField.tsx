import type { ChangeEvent, ReactNode } from 'react';

import type { FieldSchema } from '@shared/models';

import './FormField.css';

interface FormFieldProps {
  schema: FieldSchema;
  value: string;
  onChange(value: string): void;
  help?: ReactNode;
}

export function FormField({ schema, value, onChange, help }: FormFieldProps): JSX.Element {
  const id = `field-${schema.name}`;
  const handleChange = (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>): void => {
    onChange(e.target.value);
  };

  return (
    <div className="form-field">
      <label className="form-field__label" htmlFor={id}>
        {schema.label || schema.name}
        {schema.required && <span className="form-field__required">*</span>}
      </label>

      {schema.type === 'textarea' ? (
        <textarea
          id={id}
          className="form-field__input"
          value={value}
          rows={4}
          placeholder={schema.placeholder}
          onChange={handleChange}
        />
      ) : schema.type === 'select' ? (
        <select id={id} className="form-field__input" value={value} onChange={handleChange}>
          <option value="">{schema.placeholder ?? '— Select —'}</option>
          {schema.options?.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      ) : schema.type === 'boolean' ? (
        <label className="form-field__checkbox">
          <input
            id={id}
            type="checkbox"
            checked={value === 'true' || value === '1'}
            onChange={(e) => onChange(e.target.checked ? 'true' : 'false')}
          />
          <span>{schema.description}</span>
        </label>
      ) : (
        <input
          id={id}
          className="form-field__input"
          type={schema.type === 'password' ? 'password' : schema.type === 'number' ? 'number' : 'text'}
          value={value}
          placeholder={schema.placeholder}
          onChange={handleChange}
        />
      )}

      {schema.description && schema.type !== 'boolean' && (
        <div className="form-field__hint">{schema.description}</div>
      )}
      {help && <div className="form-field__hint">{help}</div>}
    </div>
  );
}
