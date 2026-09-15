/**
 * Type declarations for the harness packages the host half imports.
 *
 * They are runtime-provided (the loader resolves bare specifiers from the
 * profile's node_modules chain, and the build keeps them external), so the only
 * thing missing in a standalone checkout is the type surface. Declaring the
 * exact members used here keeps the build honest without vendoring the SDK.
 */

declare module '@deepseek-ai/dsh-tools' {
  /** A registry-ready tool definition. */
  export interface ToolDefinition {
    readonly name: string
    readonly description: string
    readonly parameters: Record<string, unknown>
    readonly output: {
      readonly schema: unknown
      render(args: any, value: any): Array<{ type: 'text'; text: string }>
    }
    execute(args: any, exec?: any): Promise<unknown>
  }

  /** Define one typed tool; the returned value is registry-ready. */
  export function defineTool(options: any): ToolDefinition
}
