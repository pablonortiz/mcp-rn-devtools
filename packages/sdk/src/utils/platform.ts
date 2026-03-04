import { Platform } from 'react-native';

/**
 * Returns the default host for connecting back to the dev machine.
 *
 * - iOS simulator / physical device via Metro: `localhost` works because
 *   Metro's proxy forwards traffic.
 * - Android emulator: `10.0.2.2` is the special alias for the host loopback
 *   interface inside the standard Android emulator.
 */
export function getDefaultHost(): string {
  if (Platform.OS === 'android') {
    return '10.0.2.2';
  }
  return 'localhost';
}
