// Application Entry Point

import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './presentation/App';
import { captureFirstTouch } from './infrastructure/analytics/track';

// Capture UTM / referrer once, before anything renders, so the very first
// landing's attribution is stored even if the user navigates immediately.
captureFirstTouch();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Could not find root element to mount to');
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

