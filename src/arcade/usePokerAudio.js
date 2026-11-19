import { useCallback, useEffect, useRef, useState } from 'react';
import { pokerSoundOptions, pokerWarmupUrls } from './pokerSounds';

const preferenceKey = 'linliao.arcade.sound';
// Throttle repeated physics contacts; distinct card and action events each get a cue.
const gaps = { bounce: 40, land: 40, collision: 40, stack: 40, deal: 0, 'card-land': 0, 'board-land': 0, flip: 0, fold: 0,
  check: 0, bet: 0, collect: 0, 'collect-end': 0, 'payout-self': 14, 'payout-other': 14 };

function loadBuffer(state, url) {
  if (state.buffers.has(url)) return Promise.resolve(state.buffers.get(url));
  if (state.loading.has(url)) return state.loading.get(url);
  const loading = fetch(url, { signal: state.abort.signal }).then(response => {
    if (!response.ok) throw new Error('Sound unavailable');
    return response.arrayBuffer();
  }).then(bytes => state.context.decodeAudioData(bytes)).then(buffer => {
    state.buffers.set(url, buffer); state.loading.delete(url);
    while (state.buffers.size > 96) state.buffers.delete(state.buffers.keys().next().value);
    return buffer;
  }).catch(() => { state.loading.delete(url); return null; });
  state.loading.set(url, loading); return loading;
}

export default function usePokerAudio(visible, tableId) {
  const [enabled, setEnabled] = useState(() => { try { return localStorage.getItem(preferenceKey) !== 'off'; } catch { return true; } });
  const runtime = useRef(null);
  const current = useRef({ visible, enabled }); current.current = { visible, enabled };
  const stop = useCallback(() => {
    const state = runtime.current;
    if (!state) return;
    state.generation++;
    for (const voice of [...state.voices]) { try { voice.source.stop(); } catch {} voice.release(); }
    state.last.clear();
  }, []);
  const unlock = useCallback(() => {
    if (!current.current.enabled || !current.current.visible || document.hidden) return;
    try {
      if (!runtime.current) {
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (!Audio) { setEnabled(false); return; }
        const context = new Audio({ latencyHint: 'interactive' }), output = context.createGain(), limiter = context.createDynamicsCompressor();
        output.gain.value = .85; limiter.threshold.value = -8; limiter.knee.value = 0; limiter.ratio.value = 12;
        limiter.attack.value = .002; limiter.release.value = .07;
        output.connect(limiter); limiter.connect(context.destination);
        runtime.current = { context, output, buffers: new Map(), loading: new Map(), abort: new AbortController(), voices: new Set(), last: new Map(), generation: 0 };
        for (const url of pokerWarmupUrls) loadBuffer(runtime.current, url);
      }
      const context = runtime.current.context;
      if (context.state !== 'running') context.resume().catch(() => {});
    } catch { setEnabled(false); }
  }, []);
  const toggle = useCallback(() => {
    const value = !current.current.enabled;
    current.current.enabled = value; setEnabled(value);
    try { localStorage.setItem(preferenceKey, value ? 'on' : 'off'); } catch {}
    if (value) unlock(); else stop();
  }, [stop, unlock]);
  const play = useCallback((kind, options = {}) => {
    const state = runtime.current;
    if (!current.current.enabled || !current.current.visible || document.hidden || state?.context.state !== 'running') return;
    const { context, output, buffers, voices, last } = state, at = performance.now();
    if (last.has(kind) && at - last.get(kind) < (gaps[kind] ?? 45)) return;
    const choices = pokerSoundOptions(kind, options), ready = choices.filter(url => buffers.has(url));
    const candidates = ready.length ? ready : choices, url = candidates[Math.floor(Math.random() * candidates.length)];
    if (!url) return;
    for (const alternative of choices) loadBuffer(state, alternative);
    last.set(kind, at);
    const generation = state.generation;
    const emit = buffer => {
      if (!buffer || runtime.current !== state || generation !== state.generation || performance.now() - at > 150 || !current.current.enabled || !current.current.visible || document.hidden || context.state !== 'running') return;
      try {
        buffers.delete(url); buffers.set(url, buffer);
        while (voices.size >= 24) { const voice = voices.values().next().value; voice.source.stop(); voice.release(); }
        const source = context.createBufferSource(), gain = context.createGain(), position = context.createStereoPanner?.();
        source.buffer = buffer;
        gain.gain.value = options.other && kind !== 'payout-other' ? .72 : 1;
        source.connect(gain);
        if (position) { position.pan.value = Math.max(-1, Math.min(1, Number.isFinite(options.pan) ? options.pan : 0)); gain.connect(position); position.connect(output); }
        else gain.connect(output);
        const voice = { source, release() { if (!voices.delete(voice)) return; source.onended = null; source.disconnect(); gain.disconnect(); position?.disconnect(); } };
        source.onended = voice.release; voices.add(voice);
        try { source.start(); } catch { voice.release(); }
      } catch { /* A changed audio device must not interrupt the hand or its animation. */ }
    };
    if (buffers.has(url)) emit(buffers.get(url)); else loadBuffer(state, url).then(emit);
  }, []);
  useEffect(() => {
    const changed = () => { if (document.hidden) { stop(); runtime.current?.context.suspend().catch(() => {}); } else unlock(); };
    document.addEventListener('visibilitychange', changed);
    return () => { document.removeEventListener('visibilitychange', changed); stop(); runtime.current?.abort.abort(); runtime.current?.context.close().catch(() => {}); runtime.current = null; };
  }, [stop, unlock]);
  useEffect(() => {
    stop();
    if (!visible || !enabled) runtime.current?.context.suspend().catch(() => {});
    else unlock();
  }, [visible, enabled, tableId, stop, unlock]);
  return { enabled, toggle, unlock, play, stop };
}
