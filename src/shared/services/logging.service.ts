/**
 * Logging Service
 *
 * Provides structured logging with MCP protocol support
 * Implements logging capability from MCP specification
 */

import { ErrorSeverity } from '../errors/error-codes.js';

/**
 * Log level type matching MCP specification (RFC 5424)
 * Extended to include notice, alert, and emergency levels
 */
export type LogLevel =
  | 'debug'
  | 'info'
  | 'notice'
  | 'warning'
  | 'error'
  | 'critical'
  | 'alert'
  | 'emergency';

/**
 * Log entry structure
 */
export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: number;
  context?: Record<string, unknown>;
  error?: Error;
}

/**
 * Logger interface
 */
export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  notice(message: string, context?: Record<string, unknown>): void;
  warning(message: string, context?: Record<string, unknown>): void;
  error(message: string, error?: Error, context?: Record<string, unknown>): void;
  critical(message: string, error?: Error, context?: Record<string, unknown>): void;
  alert(message: string, error?: Error, context?: Record<string, unknown>): void;
  emergency(message: string, error?: Error, context?: Record<string, unknown>): void;
}

/**
 * MCP Notification sender interface
 */
export interface McpNotificationSender {
  sendLoggingMessage(params: {
    level: LogLevel;
    logger?: string;
    data: Record<string, unknown>;
  }): Promise<void>;
}

/**
 * Logging Service
 *
 * Centralized logging service with configurable log levels and MCP protocol support
 * Sends notifications/message notifications via MCP server when available
 */
export class LoggingService implements Logger {
  private minLevel: LogLevel;
  private logEntries: LogEntry[] = [];
  private maxEntries: number;
  private mcpServer: McpNotificationSender | null = null;
  private loggerName: string;

  // Log level hierarchy matching RFC 5424 severity levels
  private static readonly LOG_LEVELS: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    notice: 2,
    warning: 3,
    error: 4,
    critical: 5,
    alert: 6,
    emergency: 7,
  };

  constructor(minLevel: LogLevel = 'info', maxEntries = 1000, loggerName = 'browser-automation') {
    this.minLevel = minLevel;
    this.maxEntries = maxEntries;
    this.loggerName = loggerName;
  }

  /**
   * Set the MCP server for sending log notifications
   */
  setMcpServer(server: McpNotificationSender): void {
    this.mcpServer = server;
  }

  /**
   * Set minimum log level
   */
  setMinLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  /**
   * Log a debug message
   */
  debug(message: string, context?: Record<string, unknown>): void {
    this.log('debug', message, context);
  }

  /**
   * Log an info message
   */
  info(message: string, context?: Record<string, unknown>): void {
    this.log('info', message, context);
  }

  /**
   * Log a notice message (normal but significant)
   */
  notice(message: string, context?: Record<string, unknown>): void {
    this.log('notice', message, context);
  }

  /**
   * Log a warning message
   */
  warning(message: string, context?: Record<string, unknown>): void {
    this.log('warning', message, context);
  }

  /**
   * Log an error message
   */
  error(message: string, error?: Error, context?: Record<string, unknown>): void {
    this.log('error', message, context, error);
  }

  /**
   * Log a critical message
   */
  critical(message: string, error?: Error, context?: Record<string, unknown>): void {
    this.log('critical', message, context, error);
  }

  /**
   * Log an alert message (action must be taken immediately)
   */
  alert(message: string, error?: Error, context?: Record<string, unknown>): void {
    this.log('alert', message, context, error);
  }

  /**
   * Log an emergency message (system is unusable)
   */
  emergency(message: string, error?: Error, context?: Record<string, unknown>): void {
    this.log('emergency', message, context, error);
  }

  /**
   * Internal logging method
   */
  private log(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
    error?: Error
  ): void {
    // Check if this log level should be logged
    if (!this.shouldLog(level)) {
      return;
    }

    const entry: LogEntry = {
      level,
      message,
      timestamp: Date.now(),
      context,
      error,
    };

    // Store log entry
    this.logEntries.push(entry);

    // Trim old entries if needed
    if (this.logEntries.length > this.maxEntries) {
      this.logEntries.shift();
    }

    // Send via MCP notification if server is available
    if (this.mcpServer) {
      void this.sendMcpNotification(entry);
    } else {
      // Fallback to console.error if MCP server not available
      this.outputToConsole(entry);
    }
  }

  /**
   * Send log entry as MCP notification
   */
  private async sendMcpNotification(entry: LogEntry): Promise<void> {
    if (!this.mcpServer) return;

    try {
      // Build data object for MCP notification
      const data: Record<string, unknown> = {
        message: entry.message,
        timestamp: new Date(entry.timestamp).toISOString(),
      };

      // Add context if present
      if (entry.context && Object.keys(entry.context).length > 0) {
        data.context = entry.context;
      }

      // Add error details if present
      if (entry.error) {
        data.error = {
          message: entry.error.message,
          name: entry.error.name,
          stack: entry.error.stack,
        };
      }

      // Send notifications/message notification
      await this.mcpServer.sendLoggingMessage({
        level: entry.level,
        logger: this.loggerName,
        data,
      });
    } catch (error) {
      // If MCP notification fails, fall back to console
      // Don't use this.log to avoid infinite recursion
      console.error('[LoggingService] Failed to send MCP notification:', error);
      this.outputToConsole(entry);
    }
  }

  /**
   * Check if a log level should be logged based on minimum level
   */
  private shouldLog(level: LogLevel): boolean {
    return LoggingService.LOG_LEVELS[level] >= LoggingService.LOG_LEVELS[this.minLevel];
  }

  /**
   * Output log entry to console (stderr)
   */
  private outputToConsole(entry: LogEntry): void {
    const timestamp = new Date(entry.timestamp).toISOString();
    const levelStr = entry.level.toUpperCase().padEnd(8);

    let output = `[${timestamp}] ${levelStr} ${entry.message}`;

    if (entry.context && Object.keys(entry.context).length > 0) {
      output += `\n  Context: ${JSON.stringify(entry.context)}`;
    }

    if (entry.error) {
      output += `\n  Error: ${entry.error.message}`;
      if (entry.error.stack) {
        output += `\n  Stack: ${entry.error.stack}`;
      }
    }

    // Use console.error to write to stderr (stdout is reserved for MCP protocol)
    console.error(output);
  }

  /**
   * Get recent log entries
   */
  getRecentLogs(count = 100, minLevel?: LogLevel): LogEntry[] {
    let logs = this.logEntries;

    // Filter by minimum level if specified
    if (minLevel) {
      const minLevelValue = LoggingService.LOG_LEVELS[minLevel];
      logs = logs.filter((entry) => LoggingService.LOG_LEVELS[entry.level] >= minLevelValue);
    }

    // Return most recent N entries
    return logs.slice(-count);
  }

  /**
   * Clear all log entries
   */
  clearLogs(): void {
    this.logEntries = [];
  }

  /**
   * Convert ErrorSeverity to LogLevel
   */
  static severityToLogLevel(severity: ErrorSeverity): LogLevel {
    switch (severity) {
      case ErrorSeverity.DEBUG:
        return 'debug';
      case ErrorSeverity.INFO:
        return 'info';
      case ErrorSeverity.WARNING:
        return 'warning';
      case ErrorSeverity.ERROR:
        return 'error';
      case ErrorSeverity.CRITICAL:
        return 'critical';
      default:
        return 'info';
    }
  }

  /**
   * Get the logger name
   */
  getLoggerName(): string {
    return this.loggerName;
  }

  /**
   * Get current minimum log level
   */
  getMinLevel(): LogLevel {
    return this.minLevel;
  }
}

/**
 * Global logger instance (singleton pattern)
 */
let globalLogger: LoggingService | null = null;

/**
 * Get or create global logger instance
 */
export function getLogger(): LoggingService {
  globalLogger ??= new LoggingService((process.env.LOG_LEVEL as LogLevel) || 'info');
  return globalLogger;
}

/**
 * Set global logger instance
 */
export function setLogger(logger: LoggingService): void {
  globalLogger = logger;
}
