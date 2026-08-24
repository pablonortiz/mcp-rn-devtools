import React, { useRef } from 'react';
import { Animated, Dimensions, PanResponder, StyleSheet, Text } from 'react-native';

interface QAFabProps {
  onPress: () => void;
  badgeCount: number;
  connected: boolean;
}

const FAB_SIZE = 48;
const TAP_SLOP = 8;

/** Draggable floating button that opens QA selection mode. */
export function QAFab({ onPress, badgeCount, connected }: QAFabProps) {
  const window = Dimensions.get('window');
  const position = useRef(
    new Animated.ValueXY({ x: window.width - FAB_SIZE - 12, y: window.height * 0.6 }),
  ).current;
  const offset = useRef({ x: 0, y: 0 });

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        position.stopAnimation((value) => {
          offset.current = value;
        });
      },
      onPanResponderMove: (_evt, gesture) => {
        position.setValue({
          x: offset.current.x + gesture.dx,
          y: offset.current.y + gesture.dy,
        });
      },
      onPanResponderRelease: (_evt, gesture) => {
        if (Math.abs(gesture.dx) < TAP_SLOP && Math.abs(gesture.dy) < TAP_SLOP) {
          onPress();
        }
      },
    }),
  ).current;

  return (
    <Animated.View
      style={[styles.fab, { transform: position.getTranslateTransform() }]}
      {...panResponder.panHandlers}
    >
      <Text style={styles.label}>QA</Text>
      {badgeCount > 0 && <Text style={styles.badge}>{badgeCount}</Text>}
      <Text style={[styles.dot, { color: connected ? '#4ade80' : '#f87171' }]}>●</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    backgroundColor: 'rgba(17, 24, 39, 0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    zIndex: 99998,
  },
  label: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#f59e0b',
    color: '#111',
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: 3,
    overflow: 'hidden',
  },
  dot: {
    position: 'absolute',
    bottom: 2,
    fontSize: 8,
  },
});
