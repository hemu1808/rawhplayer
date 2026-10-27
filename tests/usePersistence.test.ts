import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePersistence } from '../hooks/usePersistence';

describe('usePersistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('should return default value when localStorage is empty', () => {
    const { result } = renderHook(() => usePersistence('test_key', 'default'));
    expect(result.current[0]).toBe('default');
  });

  it('should persist value to localStorage', () => {
    const { result } = renderHook(() => usePersistence('test_key', 'default'));
    act(() => {
      result.current[1]('new_value');
    });
    expect(result.current[0]).toBe('new_value');
    expect(localStorage.getItem('test_key')).toBe(JSON.stringify('new_value'));
  });

  it('should restore value from localStorage', () => {
    localStorage.setItem('test_key', JSON.stringify('saved_value'));
    const { result } = renderHook(() => usePersistence('test_key', 'default'));
    expect(result.current[0]).toBe('saved_value');
  });

  it('should handle object values', () => {
    const defaultObj = { volume: 1.0, muted: false };
    const { result } = renderHook(() => usePersistence('test_obj', defaultObj));
    expect(result.current[0]).toEqual(defaultObj);
    
    act(() => {
      result.current[1]({ volume: 0.5, muted: true });
    });
    expect(result.current[0]).toEqual({ volume: 0.5, muted: true });
  });

  it('should handle corrupted localStorage gracefully', () => {
    localStorage.setItem('test_key', 'not-valid-json{{{');
    const { result } = renderHook(() => usePersistence('test_key', 'fallback'));
    expect(result.current[0]).toBe('fallback');
  });
});
