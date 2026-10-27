import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { PlayerProvider, usePlayer } from '../context/PlayerContext';

// Wrapper for hooks that need context
const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(PlayerProvider, null, children);

describe('PlayerContext', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('should provide default audio state', () => {
    const { result } = renderHook(() => usePlayer(), { wrapper });
    expect(result.current.state.isPlaying).toBe(false);
    expect(result.current.state.volume).toBe(1.0);
    expect(result.current.state.isPuristMode).toBe(true);
    expect(result.current.state.processingPrecision).toBe('32-bit float');
  });

  it('should dispatch SET_VOLUME action', () => {
    const { result } = renderHook(() => usePlayer(), { wrapper });
    act(() => {
      result.current.dispatch({ type: 'SET_VOLUME', payload: 0.5 });
    });
    expect(result.current.state.volume).toBe(0.5);
  });

  it('should dispatch TOGGLE_MUTE action', () => {
    const { result } = renderHook(() => usePlayer(), { wrapper });
    expect(result.current.state.isMuted).toBe(false);
    act(() => {
      result.current.dispatch({ type: 'TOGGLE_MUTE' });
    });
    expect(result.current.state.isMuted).toBe(true);
    act(() => {
      result.current.dispatch({ type: 'TOGGLE_MUTE' });
    });
    expect(result.current.state.isMuted).toBe(false);
  });

  it('should dispatch SET_PURIST_MODE action', () => {
    const { result } = renderHook(() => usePlayer(), { wrapper });
    act(() => {
      result.current.dispatch({ type: 'SET_PURIST_MODE', payload: false });
    });
    expect(result.current.state.isPuristMode).toBe(false);
  });

  it('should dispatch SET_PLAYBACK_RATE action', () => {
    const { result } = renderHook(() => usePlayer(), { wrapper });
    act(() => {
      result.current.dispatch({ type: 'SET_PLAYBACK_RATE', payload: 1.5 });
    });
    expect(result.current.state.playbackRate).toBe(1.5);
  });

  it('should dispatch UPDATE_PLAYBACK action', () => {
    const { result } = renderHook(() => usePlayer(), { wrapper });
    act(() => {
      result.current.dispatch({
        type: 'UPDATE_PLAYBACK',
        payload: { currentTime: 30, duration: 240, isPlaying: true },
      });
    });
    expect(result.current.state.currentTime).toBe(30);
    expect(result.current.state.duration).toBe(240);
    expect(result.current.state.isPlaying).toBe(true);
  });

  it('should dispatch SET_BUFFER_SIZE action', () => {
    const { result } = renderHook(() => usePlayer(), { wrapper });
    act(() => {
      result.current.dispatch({ type: 'SET_BUFFER_SIZE', payload: 512 });
    });
    expect(result.current.state.bufferSize).toBe(512);
  });

  it('should dispatch SET_PRECISION action', () => {
    const { result } = renderHook(() => usePlayer(), { wrapper });
    act(() => {
      result.current.dispatch({ type: 'SET_PRECISION', payload: '16-bit' });
    });
    expect(result.current.state.processingPrecision).toBe('16-bit');
  });
});
