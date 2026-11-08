import React from 'react';

export const LoadingState: React.FC<{ message?: string }> = ({ message = 'Loading G4X Community...' }) => {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '4rem 2rem',
        minHeight: '260px',
        color: 'var(--text-muted)',
      }}
    >
      <div
        style={{
          width: '42px',
          height: '42px',
          border: '3px solid var(--border-subtle)',
          borderTopColor: 'var(--accent-lime)',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
          marginBottom: '1rem',
          boxShadow: '0 0 15px var(--accent-lime-glow)',
        }}
      />
      <p style={{ fontSize: '0.95rem', fontWeight: 500 }}>{message}</p>
    </div>
  );
};
