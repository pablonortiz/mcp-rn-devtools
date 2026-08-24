import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';

export type ToastKind = 'listening' | 'queued' | 'warn';

export interface ToastData {
  kind: ToastKind;
  text: string;
}

const AUTO_HIDE_MS = 4000;

const KIND_COLORS: Record<ToastKind, string> = {
  listening: '#065f46',
  queued: '#78350f',
  warn: '#7f1d1d',
};

/** Post-send feedback: whether an agent took the report or it just queued up. */
export function FeedbackToast({ toast, onHide }: { toast: ToastData; onHide: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onHide, AUTO_HIDE_MS);
    return () => clearTimeout(timer);
  }, [toast, onHide]);

  return (
    <View pointerEvents="none" style={[styles.toast, { backgroundColor: KIND_COLORS[toast.kind] }]}>
      <Text style={styles.text}>{toast.text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    bottom: 40,
    alignSelf: 'center',
    maxWidth: '88%',
    borderRadius: 20,
    paddingVertical: 10,
    paddingHorizontal: 18,
    zIndex: 99999,
    elevation: 10,
  },
  text: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
});
