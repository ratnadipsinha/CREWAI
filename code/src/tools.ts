// Tool catalog + per-tool credential schemas. When a tool is added to an agent,
// the builder reads its schema and prompts for exactly these credentials on the fly
// (see CredentialModal). Secrets are stored as env vars, never in the canvas state
// or the generated Python.

export type AuthType = "oauth" | "basic" | "apikey" | "none" | "mcp";

export interface CredentialField {
  name: string; // env var name
  label: string;
  secret: boolean; // render as password input
  optional?: boolean; // not required to save / attach
}

export interface ToolDef {
  key: string;
  label: string;
  description: string;
  auth: AuthType;
  fields: CredentialField[];
  // Python that instantiates the tool inside the generated crew.
  pyImport: string;
  pyVar: string; // variable name used in agents' tools=[...]
  pyInit: string; // expression assigned to pyVar
}

export const TOOLS: Record<string, ToolDef> = {
  gmail: {
    key: "gmail",
    label: "Gmail",
    description: "Read inbox via OAuth refresh token (works with a personal Gmail).",
    auth: "oauth",
    fields: [
      { name: "GMAIL_CLIENT_ID", label: "Client ID", secret: false },
      { name: "GMAIL_CLIENT_SECRET", label: "Client Secret", secret: true },
      { name: "GMAIL_REFRESH_TOKEN", label: "Refresh token (OAuth Playground)", secret: true },
    ],
    pyImport: "from crewai_tools import MCPServerAdapter  # Gmail via MCP",
    pyVar: "gmail_tool",
    pyInit:
      'MCPServerAdapter({"url": "https://gmail-mcp.example.com/sse"})  # auth via env',
  },
  outlook: {
    key: "outlook",
    label: "Outlook",
    description: "Read email + attachments and send mail via Microsoft 365.",
    auth: "oauth",
    fields: [
      { name: "OUTLOOK_CLIENT_ID", label: "Client ID", secret: false },
      { name: "OUTLOOK_TENANT_ID", label: "Tenant ID", secret: false },
      { name: "OUTLOOK_CLIENT_SECRET", label: "Client Secret", secret: true },
      { name: "OUTLOOK_USER", label: "Mailbox to read (e.g. ops@contoso.com)", secret: false },
    ],
    pyImport: "from crewai_tools import MCPServerAdapter  # Outlook via MCP",
    pyVar: "outlook_tool",
    pyInit:
      'MCPServerAdapter({"url": "https://outlook-mcp.example.com/sse"})  # auth via env',
  },
  jira: {
    key: "jira",
    label: "Jira",
    description: "Create / transition / comment on issues.",
    auth: "basic",
    fields: [
      { name: "JIRA_URL", label: "Jira URL", secret: false },
      { name: "JIRA_USER", label: "User / email", secret: false },
      { name: "JIRA_TOKEN", label: "API token", secret: true },
    ],
    pyImport: "from crewai.tools import tool\nfrom jira import JIRA",
    pyVar: "jira_tool",
    pyInit: "make_jira_tool()",
  },
  hubspot: {
    key: "hubspot",
    label: "HubSpot",
    description: "Write records to HubSpot CRM.",
    auth: "apikey",
    fields: [{ name: "HUBSPOT_API_KEY", label: "API key", secret: true }],
    pyImport: "from crewai.tools import tool\nimport requests",
    pyVar: "hubspot_tool",
    pyInit: "make_hubspot_tool()",
  },
  netsuite: {
    key: "netsuite",
    label: "NetSuite",
    description: "Record invoices + status in NetSuite.",
    auth: "apikey",
    fields: [
      { name: "NETSUITE_ACCOUNT_ID", label: "Account ID", secret: false },
      { name: "NETSUITE_CONSUMER_KEY", label: "Consumer key", secret: true },
      { name: "NETSUITE_TOKEN", label: "Token", secret: true },
    ],
    pyImport: "from crewai.tools import tool\nimport requests",
    pyVar: "netsuite_tool",
    pyInit: "make_netsuite_tool()",
  },
  ocr: {
    key: "ocr",
    label: "OCR / Extractor",
    description: "Turn a document into text + structured fields.",
    auth: "none",
    fields: [],
    pyImport: "from crewai_tools import FileReadTool  # OCR/extract",
    pyVar: "ocr_tool",
    pyInit: "FileReadTool()",
  },
  mcp: {
    key: "mcp",
    label: "MCP Server (any)",
    description: "Connect ANY service that has an MCP server — paste its URL, no code needed.",
    auth: "mcp",
    fields: [
      { name: "MCP_SERVER_URL", label: "MCP server URL", secret: false },
      { name: "MCP_AUTH_TOKEN", label: "Auth token (optional)", secret: true, optional: true },
    ],
    pyImport: "from crewai_tools import MCPServerAdapter",
    pyVar: "mcp_tools",
    pyInit: 'MCPServerAdapter({"url": os.environ["MCP_SERVER_URL"]}).tools',
  },
};

export const TOOL_KEYS = Object.keys(TOOLS);
