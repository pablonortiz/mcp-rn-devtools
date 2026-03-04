let counter = 0;

export function uuid(): string {
  const now = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 8);
  return `${now}-${rand}-${++counter}`;
}
