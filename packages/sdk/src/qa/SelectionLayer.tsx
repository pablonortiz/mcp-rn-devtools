import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

interface SelectionLayerProps {
  onSelectPoint: (pageX: number, pageY: number) => void;
  onFixPending: () => void;
  onCancel: () => void;
}

/**
 * Full-screen tap catcher for QA selection mode. Reports the touched point;
 * the overlay unmounts this layer before hit-testing so it never inspects itself.
 */
export function SelectionLayer({ onSelectPoint, onFixPending, onCancel }: SelectionLayerProps) {
  return (
    <View
      style={styles.layer}
      onStartShouldSetResponder={() => true}
      onResponderRelease={(event) => {
        onSelectPoint(event.nativeEvent.pageX, event.nativeEvent.pageY);
      }}
    >
      <View style={styles.bannerColumn} pointerEvents="box-none">
        <View style={styles.banner}>
          <Text style={styles.bannerText}>Tocá el elemento a reportar</Text>
          <TouchableOpacity onPress={onCancel} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.cancel}>✕</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={styles.fixPending} onPress={onFixPending}>
          <Text style={styles.fixPendingText}>🤖 Corregir todos los pendientes</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(34, 211, 238, 0.05)',
    zIndex: 99999,
  },
  bannerColumn: {
    position: 'absolute',
    top: 48,
    alignSelf: 'center',
    alignItems: 'center',
    gap: 8,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(17, 24, 39, 0.9)',
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 16,
    gap: 12,
  },
  fixPending: {
    backgroundColor: 'rgba(180, 83, 9, 0.92)',
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  fixPendingText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  bannerText: {
    color: '#fff',
    fontSize: 13,
  },
  cancel: {
    color: '#f87171',
    fontSize: 15,
    fontWeight: '700',
  },
});
