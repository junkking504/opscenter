import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import SquishSwitch from '../../components/ui/squish-switch/SquishSwitch';
import '../../styles/ops-theme.css';

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function Fixture() {
  const [checked, setChecked] = useState(false);
  const [result, setResult] = useState('Not run');
  async function run() {
    setResult('Running');
    const button = document.querySelector<HTMLButtonElement>('[role=switch]')!;
    const current = () => button.getAttribute('aria-checked') === 'true';
    const assert = (value: boolean, message: string) => { if (!value) throw new Error(message); };
    const pointer = (type: string, x: number, y: number) => button.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y }));
    const click = () => button.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    try {
      setChecked(false); await pause(700);
      const r = button.querySelector('.squish-switch__track')!.getBoundingClientRect();
      const left = r.left + 16, right = r.left + 48, y = r.top + 16;
      pointer('pointerdown', left, y); pointer('pointerup', left, y);
      await pause(350);
      assert(!current(), 'Touch release must wait for the native click');
      click(); await pause(700);
      assert(current(), 'Delayed touch click must toggle exactly once');
      pointer('pointerdown', right, y); pointer('pointermove', left, y); pointer('pointerup', left, y);
      await pause(350);
      assert(!current(), 'Drag release must commit the destination');
      click(); await pause(50);
      assert(!current(), 'Delayed click after drag must not toggle again');
      pointer('pointerdown', left, y); pointer('pointermove', right, y); pointer('pointercancel', right, y);
      await pause(350); click(); await pause(50);
      assert(!current(), 'Canceled touch drag must preserve the theme');
      pointer('pointerdown', left, y); pointer('pointerup', left, y);
      await pause(350); click(); await pause(50);
      assert(current(), 'Next touch tap must work after cancellation');
      setResult('PASS: delayed touch tap, drag release, delayed drag click, scroll cancellation, and next tap');
    } catch (error) { setResult(`FAIL: ${String(error)}`); }
  }
  return <main><h1>Switch input regression</h1><p>Synthetic DOM touch event sequences with delayed compatibility clicks; not physical handset acceptance.</p><div className="ops-theme-control"><SquishSwitch width={64} height={32} checked={checked} onChange={setChecked} ariaLabel="Test dark mode" /></div><button onClick={run} disabled={result === 'Running'}>Run touch regression</button><p role="status">{result}</p></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
