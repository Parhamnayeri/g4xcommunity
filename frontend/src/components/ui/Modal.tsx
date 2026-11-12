import React, { useEffect, useRef } from 'react';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: string | number;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  footer,
  maxWidth,
  size = 'md',
  className = '',
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const defaultSizeWidth =
    size === 'sm' ? '420px' : size === 'lg' ? '760px' : size === 'xl' ? '960px' : '540px';
  const effectiveMaxWidth = maxWidth || defaultSizeWidth;

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    const previousOverflow = document.body ? document.body.style.overflow : '';
    if (document.body) {
      document.body.style.overflow = 'hidden';
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      if (document.body) {
        document.body.style.overflow = previousOverflow;
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('keydown', handleKeyDown);
      }
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      role="dialog"
      aria-modal="true"
    >
      <div
        ref={dialogRef}
        className={`modal-dialog ${className}`.trim()}
        style={{ maxWidth: effectiveMaxWidth }}
      >
        <div className="sheet-header">
          <div>
            <h3 className="sheet-title">{title}</h3>
            {subtitle && <div className="sheet-subtitle">{subtitle}</div>}
          </div>
          <button
            type="button"
            className="sheet-close-btn"
            onClick={onClose}
            aria-label="Close modal"
          >
            Close
          </button>
        </div>

        <div className="sheet-body">{children}</div>

        {footer && <div className="sheet-footer">{footer}</div>}
      </div>
    </div>
  );
};
