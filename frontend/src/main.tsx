import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/tokens.css';
import './styles/global.css';
import './styles/components.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Failed to locate root DOM element with id "root".');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
