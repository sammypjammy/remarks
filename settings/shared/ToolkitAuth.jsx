import { useEffect, useRef } from 'react';
import { mountToolkitAuth } from './toolkit-auth.js';
import './toolkit-auth.css';

export default function ToolkitAuth() {
  const host = useRef(null);
  useEffect(() => { mountToolkitAuth(host.current); }, []);
  return <div ref={host} aria-label="Toolkit account" />;
}
