import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

interface AnnotationPanelProps {
  levelName: string;
  levelIndex: number;
  levelCount: number;
  note: string;
  connected: boolean;
  onChangeNote: (note: string) => void;
  onChangeLevel: (direction: -1 | 1) => void;
  onSave: () => void;
  onFixNow: () => void;
  onCancel: () => void;
}

/** Bottom panel: hierarchy navigation, note input, and report actions. */
export function AnnotationPanel({
  levelName,
  levelIndex,
  levelCount,
  note,
  connected,
  onChangeNote,
  onChangeLevel,
  onSave,
  onFixNow,
  onCancel,
}: AnnotationPanelProps) {
  const canSubmit = connected && note.trim().length > 0;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.wrapper}
      pointerEvents="box-none"
    >
      <View style={styles.panel}>
        <View style={styles.hierarchyRow}>
          <TouchableOpacity
            onPress={() => onChangeLevel(-1)}
            disabled={levelIndex <= 0}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={[styles.arrow, levelIndex <= 0 && styles.disabled]}>◀</Text>
          </TouchableOpacity>
          <Text style={styles.levelName} numberOfLines={1}>
            {levelName}
            <Text style={styles.levelCount}>
              {'  '}
              {levelIndex + 1}/{levelCount}
            </Text>
          </Text>
          <TouchableOpacity
            onPress={() => onChangeLevel(1)}
            disabled={levelIndex >= levelCount - 1}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={[styles.arrow, levelIndex >= levelCount - 1 && styles.disabled]}>▶</Text>
          </TouchableOpacity>
        </View>

        <TextInput
          style={styles.input}
          value={note}
          onChangeText={onChangeNote}
          placeholder="¿Qué está mal acá?"
          placeholderTextColor="#6b7280"
          multiline
          autoFocus
        />

        {!connected && (
          <Text style={styles.offline}>Companion desconectado — no se puede enviar</Text>
        )}

        <View style={styles.actions}>
          <TouchableOpacity onPress={onCancel} style={styles.button}>
            <Text style={styles.buttonTextMuted}>Cancelar</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onSave}
            disabled={!canSubmit}
            style={[styles.button, styles.buttonSave, !canSubmit && styles.buttonDisabled]}
          >
            <Text style={styles.buttonText}>Guardar</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onFixNow}
            disabled={!canSubmit}
            style={[styles.button, styles.buttonFix, !canSubmit && styles.buttonDisabled]}
          >
            <Text style={styles.buttonText}>Corregir ya</Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    zIndex: 99999,
  },
  panel: {
    backgroundColor: 'rgba(17, 24, 39, 0.96)',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    gap: 10,
  },
  hierarchyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  arrow: {
    color: '#22d3ee',
    fontSize: 16,
    paddingHorizontal: 8,
  },
  disabled: {
    color: '#374151',
  },
  levelName: {
    flex: 1,
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
  levelCount: {
    color: '#6b7280',
    fontSize: 12,
    fontWeight: '400',
  },
  input: {
    backgroundColor: '#1f2937',
    borderRadius: 8,
    color: '#fff',
    fontSize: 14,
    minHeight: 64,
    maxHeight: 120,
    padding: 10,
    textAlignVertical: 'top',
  },
  offline: {
    color: '#f87171',
    fontSize: 12,
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
  button: {
    flex: 1,
    alignItems: 'center',
    borderRadius: 8,
    paddingVertical: 10,
    backgroundColor: '#1f2937',
  },
  buttonSave: {
    backgroundColor: '#0e7490',
  },
  buttonFix: {
    backgroundColor: '#b45309',
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  buttonTextMuted: {
    color: '#9ca3af',
    fontSize: 14,
  },
});
