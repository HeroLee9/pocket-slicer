import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import {ensureSlicingIsolation,resetSlicingIsolationAttempt} from './lib/isolation';
import './styles.css';
const root=createRoot(document.getElementById('root')!);
function renderApp(){root.render(<React.StrictMode><App/></React.StrictMode>);}
if(globalThis.crossOriginIsolated){renderApp();}
else{
  root.render(<main className="startup"><h1>Pocket Slicer</h1><p role="status">Preparing local slicing…</p><p className="hint">This first step takes a moment.</p></main>);
  ensureSlicingIsolation().then(status=>{if(status==='ready')renderApp();}).catch(error=>{
    root.render(<main className="startup"><h1>Pocket Slicer</h1><p role="alert">{error instanceof Error?error.message:'Local slicing could not start. Open this app in Safari and try again.'}</p><button className="primary" onClick={()=>{resetSlicingIsolationAttempt();location.reload();}}>Try again</button></main>);
  });
}
