/**
 * CLI Argument Parsing
 *
 * Parses command-line arguments for server configuration.
 * All browser initialization is controlled via these arguments.
 */

/**
 * Server configuration from CLI arguments
 */
export interface ServerArgs {
  /** Run browser in headless mode (default: false) */
  headless: boolean;

  /** Use isolated temp profile instead of persistent (default: false) */
  isolated: boolean;

  /** HTTP endpoint URL for connecting to existing browser */
  browserUrl?: string;

  /** WebSocket endpoint URL for connecting to existing browser */
  wsEndpoint?: string;

  /** Auto-connect to Chrome 144+ via DevToolsActivePort */
  autoConnect: boolean;

  /** Chrome user data directory */
  userDataDir?: string;

  /** Chrome channel to use */
  channel?: 'chrome' | 'chrome-canary' | 'chrome-beta' | 'chrome-dev';

  /** Path to Chrome executable */
  executablePath?: string;
}

/**
 * Parse command-line arguments into ServerArgs.
 *
 * @param argv - Command line arguments (process.argv.slice(2))
 * @returns Parsed server configuration
 */
export function parseArgs(argv: string[]): ServerArgs {
  const args: ServerArgs = {
    headless: false,
    isolated: false,
    autoConnect: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--headless=false' || arg === '--headless=0') {
      args.headless = false;
    } else if (arg === '--headless=true' || arg === '--headless=1' || arg === '--headless') {
      args.headless = true;
    } else if (arg === '--isolated') {
      args.isolated = true;
    } else if (arg === '--autoConnect') {
      args.autoConnect = true;
    } else if (arg === '--browserUrl' && argv[i + 1]) {
      args.browserUrl = argv[++i];
    } else if (arg === '--wsEndpoint' && argv[i + 1]) {
      args.wsEndpoint = argv[++i];
    } else if (arg === '--userDataDir' && argv[i + 1]) {
      args.userDataDir = argv[++i];
    } else if (arg === '--channel' && argv[i + 1]) {
      args.channel = argv[++i] as ServerArgs['channel'];
    } else if (arg === '--executablePath' && argv[i + 1]) {
      args.executablePath = argv[++i];
    }
  }

  return args;
}
