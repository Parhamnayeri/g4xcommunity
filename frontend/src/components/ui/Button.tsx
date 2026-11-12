import React from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'cta' | 'purple' | 'outline' | 'primary' | 'danger' | 'lime';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'purple',
  size = 'md',
  isLoading = false,
  leftIcon,
  rightIcon,
  className = '',
  disabled,
  ...props
}) => {
  const variantClass =
    variant === 'cta' || variant === 'lime'
      ? 'btn-cta'
      : variant === 'outline'
      ? 'btn-outline'
      : variant === 'danger'
      ? 'btn-danger'
      : 'btn-purple';
  const sizeClass = size === 'sm' ? 'btn-sm' : size === 'lg' ? 'btn-lg' : '';

  return (
    <button
      className={`btn ${variantClass} ${sizeClass} ${className}`.trim()}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? (
        <span
          style={{
            display: 'inline-block',
            width: '1em',
            height: '1em',
            border: '2px solid currentColor',
            borderTopColor: 'transparent',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
            marginRight: '0.4rem',
          }}
        />
      ) : (
        leftIcon
      )}
      {children}
      {!isLoading && rightIcon}
    </button>
  );
};
