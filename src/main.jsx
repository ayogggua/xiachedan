import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { applyTheme, storedTheme } from './useTheme';

applyTheme(storedTheme());

createRoot(document.getElementById('root')).render(<App />);
