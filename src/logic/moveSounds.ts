import { Platform } from 'react-native';
import type { Move } from '../types/chess';
import { isSoundEnabled } from './soundSettings';

// All three files are synthesized from scratch (sine tones + shaped noise) rather than samples
// from any commercial chess app, so there is no licensing concern.
const moveSource = require('../../assets/sounds/move.wav');
const captureSource = require('../../assets/sounds/capture.wav');
const castleSource = require('../../assets/sounds/castle.wav');

// Castling is unambiguous and cheap to detect from SAN alone — chess.js always emits exactly
// 'O-O' (kingside) or 'O-O-O' (queenside) for it, never anything else that could collide.
function isCastle(san: string): boolean {
  return san === 'O-O' || san === 'O-O-O';
}

type SoundKind = 'move' | 'capture' | 'castle';

function kindForMove(move?: Pick<Move, 'san' | 'captured'> | null): SoundKind {
  if (move && isCastle(move.san)) return 'castle';
  if (move?.captured) return 'capture';
  return 'move';
}

interface SoundBackend {
  play(kind: SoundKind): void;
}

// --- Web backend: Web Audio API with the three files decoded to in-memory AudioBuffers once, up
// front. Measured necessary: going through expo-audio's own AudioPlayer (even with its
// `downloadFirst` preload option, which does fetch the file into a blob ahead of time) still had a
// consistent ~190-220ms gap between calling play() and the 'playing' event actually firing, on
// EVERY play, not just the first — Chromium defers a plain <audio> element's buffering to
// readyState 4 ("enough data to play") until the moment it's actually asked to play, regardless of
// whether its src is a blob already resident in memory. A raw HTMLAudioElement with an explicit
// .load() + awaited 'canplaythrough' avoided that, but expo-audio doesn't expose its internal
// element for us to do that. Web Audio sidesteps the whole <audio>-element pipeline: once a sound
// is decoded into an AudioBuffer, starting an AudioBufferSourceNode is sample-accurate and
// effectively instant (measured <2ms), which is the standard approach for game SFX for exactly
// this reason.
function createWebBackend(): SoundBackend {
  type AudioContextCtor = new () => AudioContext;
  const AudioContextClass: AudioContextCtor =
    (window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor })
      .AudioContext ??
    (window as unknown as { webkitAudioContext: AudioContextCtor }).webkitAudioContext;
  const ctx = new AudioContextClass();
  const buffers: Partial<Record<SoundKind, AudioBuffer>> = {};

  const decode = (kind: SoundKind, source: unknown) => {
    // Metro resolves a `require('*.wav')` to a plain fetchable URL string under web bundling.
    const uri = typeof source === 'string' ? source : String(source);
    fetch(uri)
      .then((res) => res.arrayBuffer())
      .then((data) => ctx.decodeAudioData(data))
      .then((buffer) => {
        buffers[kind] = buffer;
      })
      .catch(() => {
        // Non-critical: a failed decode just means that sound silently never plays.
      });
  };
  decode('move', moveSource);
  decode('capture', captureSource);
  decode('castle', castleSource);

  return {
    play(kind) {
      const buffer = buffers[kind];
      if (!buffer) return; // Not decoded yet (e.g. a move within the first instant of app load).
      // Browsers suspend a freshly-created AudioContext until a user gesture — by the time a move
      // can happen the player has already tapped/clicked plenty, but resume() is a harmless no-op
      // once it's already running.
      if (ctx.state === 'suspended') ctx.resume();
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      node.connect(ctx.destination);
      node.start(0);
    },
  };
}

// --- Native backend: expo-audio's own player, exactly as documented. No evidence of the web
// backend's buffering quirk on iOS/Android (their native audio engines don't share the HTML5
// <audio> element's lazy-loading behavior), so there's no reason to deviate from the library here.
function createNativeBackend(): SoundBackend {
  // Lazy require so the web bundle never pulls in native-only code paths.
  const { createAudioPlayer } = require('expo-audio') as typeof import('expo-audio');
  const players: Record<SoundKind, ReturnType<typeof createAudioPlayer>> = {
    move: createAudioPlayer(moveSource, { downloadFirst: true }),
    capture: createAudioPlayer(captureSource, { downloadFirst: true }),
    castle: createAudioPlayer(castleSource, { downloadFirst: true }),
  };
  return {
    play(kind) {
      const player = players[kind];
      player.seekTo(0);
      player.play();
    },
  };
}

const backend: SoundBackend = Platform.OS === 'web' ? createWebBackend() : createNativeBackend();

/** Plays the move/capture/castle sound effect for a just-played move, respecting the user's sound
 * on/off setting. Safe to call from any screen (local, bot, online) for either side's move — the
 * sound itself doesn't care who made the move, only what kind of move it was. `move` may be
 * omitted/null (e.g. a replay that failed to parse) in which case the plain move sound plays. */
export function playMoveSound(move?: Pick<Move, 'san' | 'captured'> | null): void {
  if (!isSoundEnabled()) return;
  try {
    backend.play(kindForMove(move));
  } catch {
    // Non-critical: a failed sound should never interrupt gameplay.
  }
}
