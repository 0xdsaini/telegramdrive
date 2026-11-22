import { Buffer } from 'buffer';
import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { initAppDebug } from './utils/appDebug';
import App from './App';
import reportWebVitals from './reportWebVitals';

// GramJS expects Node-style Buffer in the browser bundle.
window.Buffer = window.Buffer || Buffer;

initAppDebug();

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
