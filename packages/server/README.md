# mcp-rn-devtools

MCP server for React Native runtime debugging. Connects to your running RN app via CDP and provides tools for Claude to inspect logs, errors, network requests, and more.

See the [main README](../../README.md) for full documentation.

## Usage

```bash
npx mcp-rn-devtools
```

Or add to your MCP config:

```json
{
  "mcpServers": {
    "rn-devtools": {
      "command": "npx",
      "args": ["mcp-rn-devtools"]
    }
  }
}
```

## License

MIT
