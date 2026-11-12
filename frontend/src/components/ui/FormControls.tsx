import React, { forwardRef } from 'react';

export interface BaseFieldProps {
  label?: string;
  error?: string | null;
  helpText?: string;
  helperText?: string;
  required?: boolean;
  wrapperClassName?: string;
}

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement>,
    BaseFieldProps {}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, helpText, helperText, required, wrapperClassName = '', className = '', id, ...props }, ref) => {
    const inputId = id || (label ? `input-${label.toLowerCase().replace(/\s+/g, '-')}` : undefined);
    const effectiveHelpText = helpText || helperText;

    return (
      <div className={`form-group ${wrapperClassName}`.trim()}>
        {label && (
          <label htmlFor={inputId} className={`form-label ${required ? 'required' : ''}`}>
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={`form-input ${error ? 'has-error' : ''} ${className}`.trim()}
          required={required}
          {...props}
        />
        {error && <span className="form-error">{error}</span>}
        {!error && effectiveHelpText && <span className="form-help">{effectiveHelpText}</span>}
      </div>
    );
  }
);
Input.displayName = 'Input';

export interface SelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement>,
    BaseFieldProps {
  options?: Array<{ value: string | number; label: string; disabled?: boolean }>;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, helpText, required, options, children, wrapperClassName = '', className = '', id, ...props }, ref) => {
    const selectId = id || (label ? `select-${label.toLowerCase().replace(/\s+/g, '-')}` : undefined);

    return (
      <div className={`form-group ${wrapperClassName}`.trim()}>
        {label && (
          <label htmlFor={selectId} className={`form-label ${required ? 'required' : ''}`}>
            {label}
          </label>
        )}
        <select
          ref={ref}
          id={selectId}
          className={`form-select ${error ? 'has-error' : ''} ${className}`.trim()}
          required={required}
          {...props}
        >
          {options
            ? options.map((opt) => (
                <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                  {opt.label}
                </option>
              ))
            : children}
        </select>
        {error && <span className="form-error">{error}</span>}
        {!error && helpText && <span className="form-help">{helpText}</span>}
      </div>
    );
  }
);
Select.displayName = 'Select';

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement>,
    BaseFieldProps {}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, helpText, required, wrapperClassName = '', className = '', id, ...props }, ref) => {
    const textareaId = id || (label ? `textarea-${label.toLowerCase().replace(/\s+/g, '-')}` : undefined);

    return (
      <div className={`form-group ${wrapperClassName}`.trim()}>
        {label && (
          <label htmlFor={textareaId} className={`form-label ${required ? 'required' : ''}`}>
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={textareaId}
          className={`form-textarea ${error ? 'has-error' : ''} ${className}`.trim()}
          required={required}
          {...props}
        />
        {error && <span className="form-error">{error}</span>}
        {!error && helpText && <span className="form-help">{helpText}</span>}
      </div>
    );
  }
);
Textarea.displayName = 'Textarea';

export interface CheckboxProps
  extends React.InputHTMLAttributes<HTMLInputElement>,
    BaseFieldProps {}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ label, error, helpText, wrapperClassName = '', className = '', id, ...props }, ref) => {
    const checkboxId = id || (label ? `chk-${label.toLowerCase().replace(/\s+/g, '-')}` : undefined);

    return (
      <div className={`form-group ${wrapperClassName}`.trim()}>
        <label htmlFor={checkboxId} className="form-checkbox-label">
          <input
            ref={ref}
            type="checkbox"
            id={checkboxId}
            className={`form-checkbox ${className}`.trim()}
            {...props}
          />
          {label && <span>{label}</span>}
        </label>
        {error && <span className="form-error">{error}</span>}
        {!error && helpText && <span className="form-help">{helpText}</span>}
      </div>
    );
  }
);
Checkbox.displayName = 'Checkbox';
