import path from 'path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { QAReport } from '@mcp-rn-devtools/shared';
import type { ConnectionManager } from '../managers/connection-manager.js';

export function registerQAReportTools(server: McpServer, cm: ConnectionManager): void {
  const qa = cm.qaReportManager;

  server.tool(
    'qa_list_reports',
    'List QA reports captured from the on-device overlay (element + note + runtime context). Start here when asked to fix reported QA issues.',
    {
      status: z.enum(['pending', 'resolved', 'all']).optional().default('pending')
        .describe('Which reports to list'),
    },
    { readOnlyHint: true },
    async ({ status }) => {
      const reports = await qa.list(status === 'all' ? undefined : status);
      if (reports.length === 0) {
        return text(`No ${status === 'all' ? '' : status + ' '}QA reports in ${qa.baseDir}.`);
      }

      const lines = reports.map((report) => {
        const route = routeName(report);
        return [
          `${report.id} [${report.status}${report.mode === 'fix-now' ? ', fix-now' : ''}]`,
          `  ${report.note}`,
          `  element: ${report.element.selectedName}${route ? `  screen: ${route}` : ''}`,
        ].join('\n');
      });
      return text(
        `${reports.length} report(s) in ${qa.baseDir}:\n\n${lines.join('\n\n')}\n\nUse qa_get_report with an id for full context.`,
      );
    },
  );

  server.tool(
    'qa_get_report',
    'Get one QA report with its full captured context: note, selected element (hierarchy, props, style, frame), navigation, app state, recent actions/network/logs/errors, and the screenshot path (Read it to see the screen).',
    {
      id: z.string().describe('Report id from qa_list_reports'),
    },
    { readOnlyHint: true },
    async ({ id }) => {
      const report = await qa.get(id);
      if (!report) return text(`QA report "${id}" not found. Use qa_list_reports first.`);
      return text(formatReport(report, qa.reportDir(report)));
    },
  );

  server.tool(
    'qa_wait_for_report',
    'Block until the next QA report arrives from the on-device overlay (live-fix mode: call it, the user marks an issue on the device, and it returns the full report). Re-invoke after each report to keep listening.',
    {
      timeout_ms: z.number().min(1000).max(60000).optional().default(55000)
        .describe('How long to wait before giving up'),
    },
    { readOnlyHint: true },
    async ({ timeout_ms }) => {
      const report = await qa.waitForNext(timeout_ms);
      if (!report) {
        return text(`No QA report arrived within ${timeout_ms}ms. Call again to keep waiting.`);
      }
      return text(
        `New QA report${report.mode === 'fix-now' ? ' (the user asked to FIX IT NOW)' : ''}:\n\n` +
          formatReport(report, qa.reportDir(report)),
      );
    },
  );

  server.tool(
    'qa_resolve_report',
    'Mark a QA report as resolved after acting on it. Moves it from pending/ to resolved/ and records what was done.',
    {
      id: z.string().describe('Report id'),
      resolution: z.string().optional().describe('One line describing the fix that was applied'),
    },
    async ({ id, resolution }) => {
      const report = await qa.resolve(id, resolution);
      if (!report) return text(`QA report "${id}" not found.`);
      return text(`QA report ${id} resolved.${resolution ? ` (${resolution})` : ''}`);
    },
  );
}

function formatReport(report: QAReport, dir: string): string {
  const screenshotLine = report.screenshot
    ? `Screenshot: ${path.join(dir, report.screenshot)} (Read this file to see the annotated screen; element frame in dp: ${JSON.stringify(report.element.frame)}, screen scale: ${report.screen.scale})`
    : 'Screenshot: not captured';
  return `${JSON.stringify(report, null, 2)}\n\nReport dir: ${dir}\n${screenshotLine}`;
}

function routeName(report: QAReport): string | null {
  const navigation = report.navigation as { currentRoute?: { name?: string } } | null;
  return navigation?.currentRoute?.name ?? null;
}

function text(message: string) {
  return { content: [{ type: 'text' as const, text: message }] };
}
