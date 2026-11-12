import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
// Orden obligatorio: tokens OMEGA → paleta puente F0 → estilos de la app.
import './styles/omega-tokens.css';
import './styles/legacy-palette.css';
import './theme.css';
import './styles/omega-shell.css';

// One-shot migration for boceto users that used the previous side.* localStorage namespace.
try{
 const map:Record<string,string>={
  'side.theme':'nova.theme','side.ruler':'nova.ruler','side.nav':'nova.nav','side.notes':'nova.notes',
  'side.tokens.used':'nova.tokens.used','side.tokens.history':'nova.tokens.history',
  'side.tour.seen':'nova.tour.seen','side.tasks':'nova.tasks','side.tenant':'nova.tenant',
  'side.trueque.terms':'nova.factory.terms','side.trueque.local':'nova.factory.local',
 };
 for(const [oldKey,newKey] of Object.entries(map)){
  const oldVal=localStorage.getItem(oldKey);if(oldVal===null)continue;
  if(localStorage.getItem(newKey)===null)localStorage.setItem(newKey,oldVal);
  localStorage.removeItem(oldKey);
 }
}catch{}

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
