import { getAnthropicClient, MODEL } from '../lib/anthropic.js';
import { importGraduatingCSV } from './importGraduatingCSV.js';
import { GraduatingSenior } from '../db/entities/graduatingSenior.js';

// Section 13: csv_specialist agent instructions.
const SYSTEM_PROMPT = `You are the CSV data specialist for Thriv3, a college soccer recruitment platform.

Your job: when a user gives you a URL to a CSV of graduating senior roster data, call the
import_graduating_csv tool with that URL. The CSV has one row per player and this schema:
college_name, season, confirmed_division, data_confidence, total_graduating_seniors,
player_name, player_position, player_minutes_played, official_roster_url, notes.
Multiple rows per school are grouped into a single record automatically by the tool.

After importing, report the results clearly: how many schools were imported, how many total
players, and a short sample. If the user asks about a specific school's existing data, use the
lookup_graduating_senior tool to check what's already in the database before answering.

Be concise and factual. Never claim data was imported if the tool call failed.`;

const TOOLS = [
  {
    name: 'import_graduating_csv',
    description: 'Fetch a CSV of graduating senior roster data from a URL, parse it, and bulk-import the records.',
    input_schema: {
      type: 'object',
      properties: { csv_url: { type: 'string', description: 'URL to the CSV file' } },
      required: ['csv_url'],
    },
  },
  {
    name: 'lookup_graduating_senior',
    description: "Look up an existing GraduatingSenior record for a school by name, to check what's already imported.",
    input_schema: {
      type: 'object',
      properties: { college_name: { type: 'string' } },
      required: ['college_name'],
    },
  },
];

async function executeTool(name, input) {
  if (name === 'import_graduating_csv') {
    return importGraduatingCSV({ csv_url: input.csv_url });
  }
  if (name === 'lookup_graduating_senior') {
    const rows = GraduatingSenior.filter({ college_name: input.college_name });
    return rows.length > 0 ? rows[0] : { found: false };
  }
  return { error: `Unknown tool: ${name}` };
}

/**
 * Drives the csv_specialist agent for one chat turn: the frontend sends the
 * full message history (client-held "conversation"), we run Claude's manual
 * tool loop against it, and return the final assistant message plus a log of
 * any tool calls made (for the CSVAgent page's tool-call cards).
 */
export async function csvAgentChat({ messages }) {
  const client = getAnthropicClient();
  const history = [...messages];
  const toolCalls = [];

  let response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    tools: TOOLS,
    messages: history,
  });

  while (response.stop_reason === 'tool_use') {
    history.push({ role: 'assistant', content: response.content });
    const toolResults = [];
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;
      let result;
      let isError = false;
      try {
        result = await executeTool(block.name, block.input);
      } catch (err) {
        result = { error: err.message };
        isError = true;
      }
      toolCalls.push({ name: block.name, input: block.input, result, status: isError ? 'error' : 'success' });
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result), is_error: isError });
    }
    history.push({ role: 'user', content: toolResults });

    response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages: history,
    });
  }

  const textBlock = response.content.find((b) => b.type === 'text');
  return { message: textBlock?.text || '', toolCalls };
}
