#!/usr/bin/env node
/**
 * PreToolUse hook for Bash (command #67c): refuses a shell command that WRITES a file in place (AGENTS.md "Never edit or write files through shell one-liners"; CLAUDE.md "File edits ONLY
 * with Edit / Write"). Command #67b ran `sed -i` although it is forbidden: the rule was only written down, `.claude/settings.json` had no hook at all, so nothing checked it.
 * Exit 2 + a message on stderr blocks the call (Claude Code hook protocol); anything else lets it run. Read-only uses (`sed -n`, `grep`, `cat`) pass.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const RULES = [
  { re: /(^|[\s;&|(])sed\s+(-[a-zA-Z]*\s+)*-[a-zA-Z]*i/, why: 'sed -i (in-place edit)' },
  { re: /(^|[\s;&|(])sed\s+.*--in-place/, why: 'sed --in-place' },
  { re: /(^|[\s;&|(])perl\s+(-[a-zA-Z]*\s+)*-[a-zA-Z]*i/, why: 'perl -i (in-place edit)' },
  { re: /(^|[\s;&|(])(node|python3?)\s+(-[a-zA-Z]+\s+)*-(e|c)\s[\s\S]*(writeFile|appendFile|open\([^)]*['"][wa]['"])/, why: 'node -e / python -c that writes a file' },
  { re: /\bcat\s+>{1,2}\s*\S+\s*<</, why: 'a heredoc written to a file (cat > file <<EOF)' },
  { re: /\bcat\s+<<-?\s*['"]?\w+['"]?\s*>{1,2}\s*\S/, why: 'a heredoc written to a file (cat <<EOF > file)' },
  { re: /<<-?\s*['"]?\w+['"]?\s*\|\s*tee\s/, why: 'a heredoc piped to tee' },
];

/** The reason a command is refused, or null when it may run. */
export function shellWriteReason(command) {
  const cmd = String(command ?? '');
  for (const r of RULES) if (r.re.test(cmd)) return r.why;
  return null;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  let input = {};
  try {
    input = JSON.parse(readFileSync(0, 'utf8') || '{}');
  } catch {
    process.exit(0); // not a hook call we understand: never block on a parse error
  }
  const why = shellWriteReason(input?.tool_input?.command);
  if (why) {
    process.stderr.write(`Blocked: ${why}. File edits go through the Edit / Write tools only (AGENTS.md "Never edit or write files through shell one-liners"). A bulk transform: Write a script file, then run it.\n`);
    process.exit(2);
  }
  process.exit(0);
}
