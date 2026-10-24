import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '../../src/App';
import ErrorBoundary from '../../src/components/ErrorBoundary';
import { switchAccount, releaseProfile, auditEvents } from './browser-fixture.mjs';
import '../../src/index.css';

const blocked = new URLSearchParams(location.search).get('block-theme');
if (blocked) {
  const original = Storage.prototype[blocked];
  if (!['getItem', 'setItem'].includes(blocked)) throw Error('Invalid fault');
  Storage.prototype[blocked] = function (key, ...args) {
    if (key === 'vocab-app-theme') throw new DOMException('Synthetic blocked theme storage', 'SecurityError');
    return original.call(this, key, ...args);
  };
}
function Fixture() {
  const [trace, setTrace] = React.useState('');
  return <><aside aria-label="Synthetic audit controls">
    <strong>SYNTHETIC LOCAL APP — no network or real data</strong>
    <button onClick={() => switchAccount('audit-a')}>Fixture A</button>
    <button onClick={() => switchAccount('audit-b')}>Fixture B</button>
    <button onClick={releaseProfile}>Release profile response</button>
    <button onClick={() => setTrace(auditEvents())}>Read fixture trace</button>
    <output>{trace}</output>
  </aside><ErrorBoundary><App /></ErrorBoundary></>;
}
createRoot(document.getElementById('root')).render(<React.StrictMode><Fixture /></React.StrictMode>);
