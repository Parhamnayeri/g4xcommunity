import React from 'react';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
  highlight?: 'lime' | 'purple' | 'none';
}

export const Card: React.FC<CardProps> = ({
  children,
  interactive = false,
  highlight = 'none',
  className = '',
  style,
  ...props
}) => {
  const interactiveClass = interactive ? 'card-interactive' : '';
  const highlightStyle =
    highlight === 'lime'
      ? { borderColor: 'rgba(204, 255, 0, 0.4)', boxShadow: '0 0 15px rgba(204, 255, 0, 0.15)' }
      : highlight === 'purple'
      ? { borderColor: 'rgba(124, 58, 237, 0.5)', boxShadow: '0 0 15px rgba(124, 58, 237, 0.2)' }
      : {};

  return (
    <div
      className={`card-surface ${interactiveClass} ${className}`.trim()}
      style={{ ...highlightStyle, ...style }}
      {...props}
    >
      {children}
    </div>
  );
};
