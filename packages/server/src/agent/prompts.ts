import path from 'path';
import { QA_COCKPIT_PORT } from '@mcp-rn-devtools/shared';
import type { QAReport } from '@mcp-rn-devtools/shared';

/**
 * Prompts for the headless fix agent (claude -p). The session preamble goes
 * once per session; later turns only carry the new report or chat message.
 */

export function buildSessionPreamble(): string {
  return `Sos el agente de QA en vivo de esta app React Native. El tester marca issues en el device con un overlay y te llegan como reports; tu trabajo es corregir cada uno en este repo, rápido y mínimo.

Flujo por report:
1. Mirá el screenshot del report (Read del .png). El frame del elemento viene en dp; multiplicá por screen.scale para ubicarlo en píxeles.
2. Localizá el componente: usá selectedName + hierarchy + componentStack + la ruta de navegación (en apps Janis los nombres de screen suelen matchear carpetas de src/screens/). element.style muestra los valores actuales — clave en issues visuales.
3. Aplicá el fix MÍNIMO que resuelve la nota. Respetá las convenciones del repo (CLAUDE.md).
4. Marcá el report como resuelto:
   curl -s -X POST http://localhost:${QA_COCKPIT_PORT}/api/reports/<REPORT_ID>/resolve -H 'Content-Type: application/json' -d '{"resolution":"<qué hiciste, 1 línea>"}'
5. NO recargues la app — el sistema la recarga solo después de tu turno.

Reglas:
- Salida BREVE: 1-3 líneas por report (qué cambiaste y en qué archivo). Va a un panel en vivo, no escribas ensayos.
- Nota ambigua → NO adivines: respondé con tu pregunta (el tester la ve en el panel y te contesta).
- Tests: si el fix es de lógica y el repo exige coverage, escribí el test. Si es puramente visual (estilos), anotá "test pendiente" en la resolution y seguí — la latencia importa.
- No hagas commits.`;
}

export function buildReportPrompt(report: QAReport, reportDir: string): string {
  const navigation = report.navigation as { currentRoute?: { name?: string } } | null;
  const summary = {
    id: report.id,
    note: report.note,
    mode: report.mode,
    app: report.app,
    route: navigation?.currentRoute?.name ?? null,
    element: report.element,
    recentErrors: report.recentErrors.map((error) => error.message.slice(0, 200)),
  };

  return `Nuevo QA report para corregir AHORA:

${JSON.stringify(summary, null, 2)}

Screenshot: ${path.join(reportDir, report.screenshot ?? 'screenshot.png')}
Report completo (appState redux, network, logs): ${path.join(reportDir, 'report.json')} — leelo solo si necesitás más contexto.`;
}

export function buildChatPrompt(text: string, pendingIds: string[]): string {
  const pendingNote =
    pendingIds.length > 0
      ? `\n\n(Contexto: reports pendientes en la cola ahora: ${pendingIds.join(', ')})`
      : '';
  return `Mensaje del tester desde el cockpit:\n\n${text}${pendingNote}`;
}
