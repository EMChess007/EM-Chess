import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { shellWriteReason } from '../../../.claude/hooks/block-shell-writes.mjs';

/** Command #67c: #67b used `sed -i` although AGENTS.md forbids it; no hook existed. The PreToolUse hook now refuses in-place shell writes and lets read-only commands through. */
const HOOK = join(__dirname, '../../../.claude/hooks/block-shell-writes.mjs');
const run = (command: string) => {
  try {
    execFileSync(process.execPath, [HOOK], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }), stdio: ['pipe', 'pipe', 'pipe'] });
    return 0;
  } catch (e) {
    return (e as { status: number }).status;
  }
};

describe('block-shell-writes hook', () => {
  it('refuses in-place writes', () => {
    for (const c of [
      "sed -i 's/a/b/' scripts/android/lib/goHome.mjs",
      "cd x && sed -i.bak -e 's/a/b/' f",
      "sed -E -i 's/a/b/' f",
      "sed --in-place 's/a/b/' f",
      "perl -pi -e 's/a/b/' f",
      "node -e \"require('fs').writeFileSync('f', 'x')\"",
      "python3 -c \"open('f', 'w').write('x')\"",
      'cat > src/x.ts <<EOF\nconst a = `${b}`;\nEOF',
      "cat <<'EOF' > src/x.ts\nx\nEOF",
      'cat <<EOF | tee f\nx\nEOF',
    ]) expect(shellWriteReason(c), c).not.toBeNull();
  });
  it('lets read-only commands and commit messages through', () => {
    for (const c of [
      'sed -n 1,40p scripts/android/e2e.mjs',
      "grep -n 'toHome' log | sed -n '1,5p'",
      'grep -i sed file',
      "git commit -m \"$(cat <<'EOF'\ntoHome -> Home\nEOF\n)\"",
      'node scripts/pre-push.mjs',
      'npx vitest run src/logic/__tests__/androidGoHome',
    ]) expect(shellWriteReason(c), c).toBeNull();
  });
  it('as a hook process: exit 2 blocks, exit 0 runs; a broken input never blocks', () => {
    expect(run("sed -i 's/a/b/' f")).toBe(2);
    expect(run('sed -n 1p f')).toBe(0);
    let status = 0;
    try {
      execFileSync(process.execPath, [HOOK], { input: 'not json', stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      status = (e as { status: number }).status;
    }
    expect(status).toBe(0);
  });
  it('is registered as a PreToolUse hook on Bash in .claude/settings.json', () => {
    const settings = JSON.parse(readFileSync(join(__dirname, '../../../.claude/settings.json'), 'utf8'));
    const bash = settings.hooks.PreToolUse.find((h: { matcher: string }) => h.matcher === 'Bash');
    expect(bash.hooks[0].command).toContain('.claude/hooks/block-shell-writes.mjs');
  });
});
