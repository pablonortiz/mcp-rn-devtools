import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { ElementFrame } from './inspector.js';

/** Marks the selected element's frame on screen. */
export function HighlightBox({ frame }: { frame: ElementFrame }) {
  return (
    <View
      pointerEvents="none"
      style={[
        styles.box,
        {
          top: frame.top,
          left: frame.left,
          width: frame.width,
          height: frame.height,
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  box: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: '#22d3ee',
    backgroundColor: 'rgba(34, 211, 238, 0.12)',
    zIndex: 99997,
  },
});
