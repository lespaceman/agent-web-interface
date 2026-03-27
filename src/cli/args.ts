/**
 * CLI Argument Parsing
 *
 * Parses command-line arguments for server configuration.
 * Browser configuration is now per-session (via configure_browser tool),
 * so only transport-level settings remain here.
 */

/** Transport mode for the MCP server */
export type TransportMode = 'stdio' | 'http';

/**
 * Server configuration from CLI arguments.
 *
 * Contains only server-level settings. Browser preferences are
 * per-session and configured via the configure_browser tool.
 */
export interface ServerArgs {
  /** Transport mode: stdio (default) or http */
  transport: TransportMode;

  /** Port for HTTP transport (default: 3000) */
  port: number;
}

/** Known CLI argument base names for validation */
const KNOWN_ARG_NAMES = new Set(['transport', 'port']);

/**
 * Check if an argument is a known CLI flag (handles --arg and --arg=value forms).
 */
function isKnownArg(arg: string): boolean {
  if (!arg.startsWith('--')) return true; // Not a flag, skip validation
  const withoutDashes = arg.slice(2);
  const baseName = withoutDashes.split('=')[0];
  return KNOWN_ARG_NAMES.has(baseName);
}

/**
 * Parse command-line arguments into ServerArgs.
 *
 * @param argv - Command line arguments (process.argv.slice(2))
 * @returns Parsed server configuration
 */
export function parseArgs(argv: string[]): ServerArgs {
  const args: ServerArgs = {
    transport: 'stdio',
    port: 3000,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--transport' && argv[i + 1]) {
      const value = argv[++i];
      if (value === 'stdio' || value === 'http') {
        args.transport = value;
      } else {
        console.warn(`Warning: Unknown transport "${value}" - defaulting to stdio`);
      }
    } else if (arg === '--port' && argv[i + 1]) {
      const parsed = parseInt(argv[++i], 10);
      if (isNaN(parsed) || parsed < 1 || parsed > 65535) {
        console.warn(`Warning: Invalid port "${argv[i]}" - defaulting to 3000`);
      } else {
        args.port = parsed;
      }
    } else if (!isKnownArg(arg)) {
      // Warn about unknown arguments to catch typos
      console.warn(`Warning: Unknown argument "${arg}" - ignored`);
    }
  }

  // Environment variable overrides for transport settings
  if (process.env.TRANSPORT === 'http') {
    args.transport = 'http';
  }
  if (process.env.HTTP_PORT) {
    const parsed = parseInt(process.env.HTTP_PORT, 10);
    if (isNaN(parsed) || parsed < 1 || parsed > 65535) {
      console.warn(`Warning: Invalid HTTP_PORT "${process.env.HTTP_PORT}" - defaulting to 3000`);
    } else {
      args.port = parsed;
    }
  }

  return args;
}
