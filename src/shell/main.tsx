import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './index.css';
import { unlockAudioOnGesture } from '../engine/audio';
import { devlog } from '../dev/devlog';

// Surface fire-and-forget failures (e.g. an un-awaited lights.flush()) in the dev log
window.addEventListener('unhandledrejection', (e) => devlog('error', { unhandled: String(e.reason) }));
window.addEventListener('error', (e) => devlog('error', { uncaught: String(e.error ?? e.message) }));

// Audio starts on the first click / key press on the page (browser autoplay policy)
unlockAudioOnGesture();

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(<App />);
