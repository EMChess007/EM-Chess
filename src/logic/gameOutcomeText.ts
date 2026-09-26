// Superset of every end-of-game reason this app already distinguishes: getGameOutcome (local/bot,
// see gameResult.ts) produces the first five; OnlineGameScreen's server-driven GameOverPayload
// adds 'abandonment'. Purely a display formatter — no new end-detection logic, just labels what
// engine.getStatus()/clock/resign/server state already told the caller.
export type EndReason = 'checkmate' | 'stalemate' | 'draw' | 'timeout' | 'resignation' | 'abandonment' | 'agreement';

export function describeEndReason(reason: EndReason): string {
  switch (reason) {
    case 'checkmate':
      return 'by Checkmate';
    case 'timeout':
      return 'by Timeout';
    case 'resignation':
      return 'by Resignation';
    case 'stalemate':
      return 'by Stalemate';
    case 'abandonment':
      return 'by Abandonment';
    case 'agreement':
      return 'by Agreement';
    case 'draw':
      // Chess.js's isDraw() (repetition / insufficient material / 50-move rule) doesn't expose
      // which of those it was, so this is as specific as it gets without new detection logic.
      return 'Draw';
  }
}
