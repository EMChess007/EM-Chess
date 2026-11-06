// Mutation set for the Bughouse W2 BOT (src/logic/bughouse/bot.ts; the server copy is generated from it, so it is not mutated separately). The harness runs the QUICK bot suite first
// (bughouseBot.test.ts, a few seconds); a mutant that survives it is run again against the SLOW suite (bughouseBotBudget.test.ts: thousands of decisions, whole matches, the latency budget):
//   npm run mutate -- scripts/mutation/configs/bughouse-w2-bot.config.cjs
//   MUT_PASS=slow MUT_ONLY=<file with survivor names, one per line> npm run mutate -- scripts/mutation/configs/bughouse-w2-bot.config.cjs
//
// WHAT IS MUTATED. Everything that decides legality, selection, caps and safety: the strength dial, the candidate filters, the look-ahead batches, the mate and mating-drop checks, the
// reply evaluation. WHAT IS NOT: the small tie-breaking nudges of the heuristic (the 0.04 centre bonus, the 0.02 / 0.1 jitters, the 0.3 castling bonus, the 0.05 / 0.3 pawn-drop reluctance)
// - they only order moves the scores already rank within a fraction of a pawn, so changing them changes the bot's taste, not anything a test could state as a rule. They are listed in
// TESTING.md section 36 as "tuning, not logic".
//
// EQUIVALENT MUTANTS (they survive by design; each is a guard no reachable position can trigger, and the proof is a test in bughouseBotNumbers.test.ts, describe "the guards that no
// reachable position can trigger", or follows from the code's structure as noted):
//   random: an empty pool is resolved            - randomAction runs only when the seat has a move or a drop, and with no plain move it drops (pinned: "a seat with moves but no drops...")
//   pass 1: a notation that does not parse ...  - chess.js lists no notation the pattern misses (proved over real positions)
//   pass 1: the king is penalised too            - a legal king move never lands on an attacked square (proved over real positions)
//   drops: no king means a distance of 0 / reply: no king is no danger - openBoard refuses a position without both kings (pinned)
//   pass 2: no candidates means no move          - with no candidates the loop body never runs and `scored` stays empty: the very next line returns the same firstLegalAction
//   pass 2: a notation that does not resolve ... / resolve: a thrown error escapes - every notation chess.js lists resolves, and chess.move never throws for one (proved over real positions)
//   pass 2: any result is a mate / reply: any result is a mate - a move or drop ends the match only by checkmate (proved over real positions)
//   pass 2: the pocket is read before the move   - no move or drop changes the OPPONENT's pocket (proved over real positions)
// NOT EQUIVALENT after all (W3a audit): "choose: a seat with nothing to do chooses" returns null on every path, but it draws one number from the random stream first, and the stream
// is shared by every later decision of a seeded match - killed by "a seat that cannot act draws NOTHING from the random stream" in bughouseBotNumbers.test.ts.
const fs = require('fs');
const T = 'src/logic/__tests__/';
const FAST = T + 'bughouseBot.test.ts ' + T + 'bughouseBotNumbers.test.ts'; // (a bare "bughouseBot" would also match bughouseBotBudget.test.ts)
const SLOW = T + 'bughouseBotBudget.test.ts';
const F = 'src/logic/bughouse/bot.ts';
const m = (name, find, replace) => [name, F, find, replace];

const mutants = [
  // --- the dial -----------------------------------------------------------------------------------------------------------------------------
  m('dial: the floor is 30 %', 'const bestChance = 0.2 + 0.7 *', 'const bestChance = 0.3 + 0.7 *'),
  m('dial: the floor is 10 %', 'const bestChance = 0.2 + 0.7 *', 'const bestChance = 0.1 + 0.7 *'),
  m('dial: the slope is 0.6', 'const bestChance = 0.2 + 0.7 *', 'const bestChance = 0.2 + 0.6 *'),
  m('dial: the slope is 0.8', 'const bestChance = 0.2 + 0.7 *', 'const bestChance = 0.2 + 0.8 *'),
  m('dial: the scale is 2000', '(elo - 400) / 2600', '(elo - 400) / 2000'),
  m('dial: the scale starts at 500', '(elo - 400) / 2600', '(elo - 500) / 2600'),
  m('dial: no ceiling', 'Math.min(1, Math.max(0, (elo - 400) / 2600))', 'Math.max(0, (elo - 400) / 2600)'),
  m('dial: no floor', 'Math.min(1, Math.max(0, (elo - 400) / 2600))', 'Math.min(1, (elo - 400) / 2600)'),
  m('dial: the scored choice is used when the draw EQUALS the chance', 'if (rng() >= bestChance) return randomAction', 'if (rng() > bestChance) return randomAction'),
  m('dial: the random branch never happens', 'if (rng() >= bestChance) return randomAction(chess, board, sans, drops, rng);', ''),
  m('dial: the scored branch never happens', 'if (rng() >= bestChance) return randomAction', 'if (true) return randomAction'),

  // --- the random branch --------------------------------------------------------------------------------------------------------------------
  m('random: under-promotions are allowed', "!/=[RBN]/.test(san)", 'true'),
  m('random: only rook promotions are filtered', "!/=[RBN]/.test(san)", "!/=R/.test(san)"),
  m('random: drops are never chosen', 'if (drops.length > 0 && (plain.length === 0 || rng() < 0.3)) {', 'if (false) {'),
  m('random: drops are always chosen', 'if (drops.length > 0 && (plain.length === 0 || rng() < 0.3)) {', 'if (drops.length > 0) {'),
  m('random: drops are chosen only when there is no move', 'if (drops.length > 0 && (plain.length === 0 || rng() < 0.3)) {', 'if (drops.length > 0 && plain.length === 0) {'),
  m('random: a drop is always the first', 'const drop = drops[Math.floor(rng() * drops.length)];\n    return { kind: \'drop\', board, piece: drop.piece, square: drop.square };', "const drop = drops[0];\n    return { kind: 'drop', board, piece: drop.piece, square: drop.square };"),
  m('random: a move is always the first', 'pool[Math.floor(rng() * pool.length)]', 'pool[0]'),
  m('random: the pool ignores the filter', 'const pool = plain.length > 0 ? plain : sans;', 'const pool = sans;'),
  m('random: an empty pool is resolved', 'return pool.length === 0 ? null : resolveSan', 'return resolveSan'),

  // --- pass 1: moves -------------------------------------------------------------------------------------------------------------------------
  m('pass 1: castling is skipped', "if (san.startsWith('O-O')) {", 'if (false) {'),
  m('pass 1: a notation that does not parse is scored anyway', '    if (!parsed) continue;\n    const piece', '    const piece'),
  m('pass 1: the piece letter is lost', "const piece = parsed[1] ? parsed[1].toLowerCase() : 'p';", "const piece = 'p';"),
  m('pass 1: a rook promotion is considered', "if (promotion !== null && promotion !== 'q' && promotion !== 'n') continue;", ''),
  m('pass 1: a knight promotion is not considered', "promotion !== 'q' && promotion !== 'n') continue;", "promotion !== 'q') continue;"),
  m('pass 1: captures are not rewarded', 'score += VALUE[victim] + BANK_SHARE * VALUE[promoted.has(dest) ? \'p\' : victim];', ''),
  m('pass 1: the victim is the mover', "const victim = pieceAt(dest)?.type ?? 'p';", "const victim = piece;"),
  m('pass 1: an empty destination is not en passant', "pieceAt(dest)?.type ?? 'p'", "pieceAt(dest)?.type ?? 'q'"),
  m('pass 1: a captured promoted piece banks as itself', "promoted.has(dest) ? 'p' : victim", 'victim'),
  m('pass 1: the partner gets nothing from a capture', 'score += VALUE[victim] + BANK_SHARE * VALUE[', 'score += VALUE[victim] + 0 * VALUE['),
  m('pass 1: a promotion is not rewarded', 'if (promotion !== null) score += VALUE[promotion] - 1;', ''),
  m('pass 1: a check is not rewarded', "if (/[+#]/.test(san)) score += 0.5;", ''),
  m('pass 1: a notation mate gets no ticket', 'if (san.includes(\'#\')) score += SAN_MATE_BONUS;', ''),
  m('pass 1: a notation mate is a mate even if the engine disagrees (the ticket is kept)', "const ticket = candidate.san !== null && candidate.san.includes('#') ? SAN_MATE_BONUS : 0;", 'const ticket = 0;'),
  m('pass 1: an attacked square costs nothing', 'if (moved !== \'k\' && chess.isAttacked(dest as never, opponent)) score -= 0.4 * VALUE[moved];', ''),
  m('pass 1: the king is penalised too', "if (moved !== 'k' && chess.isAttacked(", 'if (chess.isAttacked('),
  m('pass 1: the penalty is for the wrong side', 'chess.isAttacked(dest as never, opponent)) score -= 0.4', 'chess.isAttacked(dest as never, me)) score -= 0.4'),
  m('pass 1: a promoted piece is risked as a pawn', 'const moved = promotion ?? piece;', 'const moved = piece;'),

  // --- pass 1: drops --------------------------------------------------------------------------------------------------------------------------
  m('drops: unsafe squares far from the king are considered', '.filter((c) => c.safe || c.near <= 2)', ''),
  m('drops: only safe squares are considered', '.filter((c) => c.safe || c.near <= 2)', '.filter((c) => c.safe)'),
  m('drops: squares near the king count as 3', '.filter((c) => c.safe || c.near <= 2)', '.filter((c) => c.safe || c.near <= 3)'),
  m('drops: not capped', '    .slice(0, maxDrops);', ';'),
  m('drops: the cap is one fewer', '    .slice(0, maxDrops);', '    .slice(0, maxDrops - 1);'),
  m('drops: the cheaper piece is scored first', '- 0.1 * VALUE[drop.piece] + rng() * 0.1', '+ 0.1 * VALUE[drop.piece] + rng() * 0.1'),
  m('drops: the piece value is not in the ranking', '- 0.1 * VALUE[drop.piece] + rng() * 0.1', '+ rng() * 0.1'),
  m('drops: unsafe squares rank before safe ones', 'rank: (safe ? 0 : 2) + near', 'rank: (safe ? 2 : 0) + near'),
  m('drops: far squares rank before near ones', '+ near * 0.5 - 0.1', '- near * 0.5 - 0.1'),
  m('drops: the default cap is not the constant', 'maxDrops: number = BUGHOUSE_BOT_MAX_DROP_CANDIDATES): Scored[] {', 'maxDrops: number = 1000): Scored[] {'),
  m('drops: the farthest are kept', '.sort((a, b) => a.rank - b.rank)', '.sort((a, b) => b.rank - a.rank)'),
  m('drops: a defended attacked square is unsafe', 'const safe = !attacked || defended;', 'const safe = !attacked;'),
  m('drops: an attacked square is safe', 'const safe = !attacked || defended;', 'const safe = true;'),
  m('drops: the defender is the opponent', 'const defended = chess.isAttacked(drop.square as never, me);', 'const defended = chess.isAttacked(drop.square as never, opponent);'),
  m('drops: the attacker is the mover', 'const attacked = chess.isAttacked(drop.square as never, opponent);', 'const attacked = chess.isAttacked(drop.square as never, me);'),
  m('drops: no king means a distance of 0', 'const near = enemyKing ? distance(drop.square, enemyKing) : 8;', 'const near = enemyKing ? distance(drop.square, enemyKing) : 0;'),
  m('drops: a piece in the pocket is not worth using', 'let score = rng() * 0.02 + (safe ? 0.3 * VALUE[drop.piece] : -0.5 * VALUE[drop.piece]);', 'let score = rng() * 0.02;'),
  m('drops: an unsafe drop is rewarded', '(safe ? 0.3 * VALUE[drop.piece] : -0.5 * VALUE[drop.piece])', '(safe ? 0.3 * VALUE[drop.piece] : 0.5 * VALUE[drop.piece])'),
  m('drops: nearness to the king is not rewarded', 'if (near <= 2) score += (3 - near) * 0.15;', ''),
  m('drops: a drop is a candidate whatever it scores (a drop candidate carries a san)', 'candidates.push({ action: { kind: \'drop\', board, piece: drop.piece as ReservePieceType, square: drop.square }, score, san: null });', 'candidates.push({ action: { kind: \'drop\', board, piece: drop.piece as ReservePieceType, square: drop.square }, score: score - 1000, san: null });'),
  m('drops: no drop is a candidate', 'candidates.push({ action: { kind: \'drop\', board, piece: drop.piece as ReservePieceType, square: drop.square }, score, san: null });', ''),
  m('drops: the drop names the wrong piece', 'piece: drop.piece as ReservePieceType, square: drop.square }, score, san: null }', "piece: 'q', square: drop.square }, score, san: null }"),

  // --- pass 2: the look-ahead -------------------------------------------------------------------------------------------------------------------
  m('pass 2: no candidates means no move', '  if (candidates.length === 0) return firstLegalAction(match, seat);\n', ''),
  m('pass 2: the worst candidates are played out first', 'candidates.sort((a, b) => b.score - a.score);', 'candidates.sort((a, b) => a.score - b.score);'),
  m('pass 2: the candidates are not sorted', '  return candidates.sort((a, b) => b.score - a.score);', '  return candidates;'),
  m('pass 2: no rescue batches', 'batch <= BUGHOUSE_BOT_RESCUE_BATCHES &&', 'batch < 1 &&'),
  m('pass 2: one rescue batch too many', 'batch <= BUGHOUSE_BOT_RESCUE_BATCHES &&', 'batch <= BUGHOUSE_BOT_RESCUE_BATCHES + 1 &&'),
  m('pass 2: a rescue batch even if the first was fine', 'if (batch > 0 && Math.max(...scored.map((s) => s.score)) > -WIN / 2) break;', ''),
  m('pass 2: a rescue only when EVERYTHING lost (stops one batch early)', 'Math.max(...scored.map((s) => s.score)) > -WIN / 2) break;', 'Math.max(...scored.map((s) => s.score)) > -WIN * 2) break;'),
  m('pass 2: the rescue threshold is -WIN', 'Math.max(...scored.map((s) => s.score)) > -WIN / 2) break;', 'Math.max(...scored.map((s) => s.score)) > 0) break;'),
  m('pass 2: the batch is not advanced', '    next += finalists.length;\n', ''),
  m('pass 2: the batch is one candidate', 'candidates.slice(next, next + BUGHOUSE_BOT_LOOKAHEAD)', 'candidates.slice(next, next + 1)'),
  m('pass 2: the batch is the whole list', 'candidates.slice(next, next + BUGHOUSE_BOT_LOOKAHEAD)', 'candidates.slice(next)'),
  m('pass 2: a notation that does not resolve is played anyway', '        if (resolved === null) continue;\n', ''),
  m('pass 2: a refused candidate is scored', '      if (!outcome.ok) continue;\n', ''),
  m('pass 2: a mate in one is not taken', "outcome.match.result.reason === 'checkmate') return action;", "outcome.match.result.reason === 'checkmate') void 0;"),
  m('pass 2: any result is a mate', "'winnerTeam' in outcome.match.result && outcome.match.result.reason === 'checkmate') return action;", "'winnerTeam' in outcome.match.result) return action;"),
  m('pass 2: the opponent\'s pocket is not looked at', 'reserveTotal(outcome.match.pockets[opponentOnBoard(seat)]) > 0', 'false'),
  m('pass 2: the opponent\'s pocket is the mover\'s', 'reserveTotal(outcome.match.pockets[opponentOnBoard(seat)]) > 0', 'reserveTotal(outcome.match.pockets[seat]) > 0'),
  m('pass 2: the pocket is read before the move', 'reserveTotal(outcome.match.pockets[opponentOnBoard(seat)]) > 0', 'reserveTotal(match.pockets[opponentOnBoard(seat)]) > 0'),
  m('pass 2: the reply loss is not subtracted', 'score: candidate.score - ticket - danger.loss - (danger.mated ? WIN : 0)', 'score: candidate.score - ticket - (danger.mated ? WIN : 0)'),
  m('pass 2: a mate against us is not subtracted', 'score: candidate.score - ticket - danger.loss - (danger.mated ? WIN : 0)', 'score: candidate.score - ticket - danger.loss'),
  m('pass 2: the reply loss is added', 'score: candidate.score - ticket - danger.loss - (danger.mated ? WIN : 0)', 'score: candidate.score - ticket + danger.loss - (danger.mated ? WIN : 0)'),
  m('pass 2: nothing scored means no move', '  if (scored.length === 0) return firstLegalAction(match, seat);\n  const top', '  const top'),
  m('pass 2: the lowest score wins', 'const top = Math.max(...scored.map((s) => s.score));', 'const top = Math.min(...scored.map((s) => s.score));'),
  m('pass 2: ties are broken by the first', 'return best[Math.floor(rng() * best.length)].action;', 'return best[0].action;'),
  m('pass 2: every score is a tie', 'const best = scored.filter((s) => s.score === top);', 'const best = scored;'),

  // --- the reply ------------------------------------------------------------------------------------------------------------------------------
  m('reply: a mate against us is not seen', "    if (san.includes('#')) return { loss, mated: true };\n", ''),
  m('reply: captures are not counted', 'if (parsed && parsed[2]) loss = Math.max(loss, VALUE[pieceAt(parsed[3])?.type ?? \'p\']);', ''),
  m('reply: the loss is the sum', 'loss = Math.max(loss, VALUE[pieceAt(parsed[3])?.type ?? \'p\']);', 'loss += VALUE[pieceAt(parsed[3])?.type ?? \'p\'];'),
  m('reply: the loss is the least', 'loss = Math.max(loss, VALUE[pieceAt(parsed[3])?.type ?? \'p\']);', 'loss = loss === 0 ? VALUE[pieceAt(parsed[3])?.type ?? \'p\'] : Math.min(loss, VALUE[pieceAt(parsed[3])?.type ?? \'p\']);'),
  m('reply: an en passant capture is worth nothing', "VALUE[pieceAt(parsed[3])?.type ?? 'p']);\n  }\n  if (!probeDrops)", "VALUE[pieceAt(parsed[3])?.type ?? 'k']);\n  }\n  if (!probeDrops)"),
  m('reply: drops are not probed', '  if (!probeDrops) return { loss, mated: false };\n', ''),
  m('reply: drops are always probed', 'if (!probeDrops) return', 'if (false) return'),
  m('reply: the replier is the mover', 'const replier = opponentOnBoard(mover);', 'const replier = mover;'),
  m('reply: the king is the replier\'s', 'const myKing = kingSquare(chess, seatPlace(mover).color);', 'const myKing = kingSquare(chess, seatPlace(opponentOnBoard(mover)).color);'),
  m('reply: no king is no danger (the guard is gone)', '  if (myKing === null) return { loss, mated: false };\n', ''),
  m('probe: every far square is probed', '.filter((c) => c.touches || c.d <= 2)', ''),
  m('probe: only touching squares are probed', '.filter((c) => c.touches || c.d <= 2)', '.filter((c) => c.touches)'),
  m('probe: only near squares are probed', '.filter((c) => c.touches || c.d <= 2)', '.filter((c) => c.d <= 2)'),
  m('probe: only adjacent squares count as near', '.filter((c) => c.touches || c.d <= 2)', '.filter((c) => c.touches || c.d <= 1)'),
  m('probe: three squares count as near', '.filter((c) => c.touches || c.d <= 2)', '.filter((c) => c.touches || c.d <= 3)'),
  m('probe: the farthest are probed first', '|| a.d - b.d)', '|| b.d - a.d)'),
  m('probe: the touching squares are probed last', 'Number(b.touches) - Number(a.touches)', 'Number(a.touches) - Number(b.touches)'),
  m('probe: touching is not looked at', 'Number(b.touches) - Number(a.touches) || a.d - b.d', 'a.d - b.d'),
  m('probe: no distance order', 'Number(b.touches) - Number(a.touches) || a.d - b.d', 'Number(b.touches) - Number(a.touches)'),
  m('probe: nothing is dropped from the list', '    .slice(0, limit)\n    .map((c) => c.drop);', '    .map((c) => c.drop);'),
  m('probe: one square too many', '    .slice(0, limit)\n', '    .slice(0, limit + 1)\n'),
  m('probe: the limit is one', '    .slice(0, limit)\n', '    .slice(0, 1)\n'),
  m('probe: the limit constant', 'nearestDrops(legalDropOptions(chess, crazyhouseOfBoard(afterMatch, board)), myKing, BUGHOUSE_BOT_DROP_PROBES)', 'nearestDrops(legalDropOptions(chess, crazyhouseOfBoard(afterMatch, board)), myKing, 1)'),
  m('probe: no limit at the call', 'myKing, BUGHOUSE_BOT_DROP_PROBES)', 'myKing, 1000)'),
  m('touch: a knight touches along a line', "if (piece === 'n') return df * dr === 2;", "if (piece === 'n') return df * dr === 0;"),
  m('touch: a knight touches by a one-square step', "if (piece === 'n') return df * dr === 2;", "if (piece === 'n') return df * dr === 1;"),
  m('touch: a bishop touches along a line', "if (piece === 'b') return diagonal;", "if (piece === 'b') return straight;"),
  m('touch: a rook touches on a diagonal', "if (piece === 'r') return straight;", "if (piece === 'r') return diagonal;"),
  m('touch: a queen touches only on a line', "if (piece === 'q') return straight || diagonal;", "if (piece === 'q') return straight;"),
  m('touch: a queen touches only on a diagonal', "if (piece === 'q') return straight || diagonal;", "if (piece === 'q') return diagonal;"),
  m('touch: a queen touches everywhere', "if (piece === 'q') return straight || diagonal;", 'if (piece === \'q\') return true;'),
  m('touch: a pawn touches any diagonal', 'return diagonal && df === 1; // a pawn', 'return diagonal; // a pawn'),
  m('touch: a pawn touches straight', 'return diagonal && df === 1; // a pawn', 'return straight && df + dr === 1; // a pawn'),
  m('touch: a square on the king touches', 'const diagonal = df === dr && df > 0;', 'const diagonal = df === dr;'),
  m('touch: straight includes the king\'s own square', 'const straight = (df === 0) !== (dr === 0);', 'const straight = df === 0 || dr === 0;'),
  m('touch: the files are read the wrong way', 'const df = Math.abs(square.charCodeAt(0) - king.charCodeAt(0));', 'const df = Math.abs(square.charCodeAt(0) - king.charCodeAt(0)) % 2;'),
  m('touch: the ranks are read the wrong way', 'const dr = Math.abs(Number(square[1]) - Number(king[1]));', 'const dr = Math.abs(Number(square[1]) - Number(king[1])) % 2;'),
  m('reply: a drop that is no mate counts as one', "reply.ok && reply.match.result !== null && 'winnerTeam' in reply.match.result && reply.match.result.reason === 'checkmate') return { loss, mated: true };", 'reply.ok) return { loss, mated: true };'),
  m('reply: any result is a mate', "'winnerTeam' in reply.match.result && reply.match.result.reason === 'checkmate') return { loss, mated: true };", "'winnerTeam' in reply.match.result) return { loss, mated: true };"),
  m('reply: the probe drops the wrong piece', "{ kind: 'drop', board, piece: drop.piece, square: drop.square }, afterMatch.nowMs)", "{ kind: 'drop', board, piece: 'q', square: drop.square }, afterMatch.nowMs)"),

  // --- the helpers ----------------------------------------------------------------------------------------------------------------------------
  m('resolve: the position is not restored', '  if (!played) return null;\n  chess.undo();', '  if (!played) return null;'),
  m('resolve: a promotion is lost', "return played.promotion\n    ? { kind: 'move', board, from: played.from, to: played.to, promotion: played.promotion as 'q' | 'r' | 'b' | 'n' }\n    : { kind: 'move', board, from: played.from, to: played.to };", "return { kind: 'move', board, from: played.from, to: played.to };"),
  m('resolve: the board is lost', "return played.promotion\n    ? { kind: 'move', board, from: played.from", "return played.promotion\n    ? { kind: 'move', board: 'A', from: played.from"),
  m('resolve: a thrown error escapes', '  } catch {\n    return null;\n  }\n  if (!played) return null;', '  } catch (e) {\n    throw e;\n  }\n  if (!played) return null;'),
  m('king: the first king found', "if (cell && cell.type === 'k' && cell.color === color) return cell.square;", "if (cell && cell.type === 'k') return cell.square;"),
  m('distance: the sum, not the maximum', 'Math.max(Math.abs(a.charCodeAt(0) - b.charCodeAt(0)), Math.abs(Number(a[1]) - Number(b[1])))', 'Math.abs(a.charCodeAt(0) - b.charCodeAt(0)) + Math.abs(Number(a[1]) - Number(b[1]))'),
  m('firstLegal: not the seat\'s turn', "if (match.result !== null || match.verdicts[place.board].turn !== place.color) return null;\n  const chess = openBoard(match.boards[place.board].fen);\n  if (chess === null) return null;\n  for (const san of chess.moves()) {", "if (match.result !== null) return null;\n  const chess = openBoard(match.boards[place.board].fen);\n  if (chess === null) return null;\n  for (const san of chess.moves()) {"),
  m('firstLegal: no drops', '  return drops.length > 0 ? { kind: \'drop\', board: place.board, piece: drops[0].piece, square: drops[0].square } : null;', '  return null;'),
  m('choose: not the seat\'s turn', "if (match.result !== null || match.verdicts[board].turn !== place.color) return null;\n  const chess = openBoard(match.boards[board].fen);\n  if (chess === null) return null;\n  const cz", "if (match.result !== null) return null;\n  const chess = openBoard(match.boards[board].fen);\n  if (chess === null) return null;\n  const cz"),
  m('choose: a finished match is played', "if (match.result !== null || match.verdicts[board].turn !== place.color) return null;\n  const chess = openBoard(match.boards[board].fen);\n  if (chess === null) return null;\n  const cz", "if (match.verdicts[board].turn !== place.color) return null;\n  const chess = openBoard(match.boards[board].fen);\n  if (chess === null) return null;\n  const cz"),
  m('choose: a seat with nothing to do chooses', '  if (sans.length + drops.length === 0) return null;\n', ''),
  m('choose: the promoted marks are lost', 'const promoted = new Set(match.boards[board].promoted);', 'const promoted = new Set<string>();'),
  m('choose: the opponent is the mover', 'const opponent = otherColor(me);', 'const opponent = me;'),
  m('constants: the lookahead is 4', 'export const BUGHOUSE_BOT_LOOKAHEAD = 5;', 'export const BUGHOUSE_BOT_LOOKAHEAD = 4;'),
  m('constants: the lookahead is 6', 'export const BUGHOUSE_BOT_LOOKAHEAD = 5;', 'export const BUGHOUSE_BOT_LOOKAHEAD = 6;'),
  m('constants: 13 drop candidates', 'export const BUGHOUSE_BOT_MAX_DROP_CANDIDATES = 12;', 'export const BUGHOUSE_BOT_MAX_DROP_CANDIDATES = 13;'),
  m('constants: 4 drop probes', 'export const BUGHOUSE_BOT_DROP_PROBES = 3;', 'export const BUGHOUSE_BOT_DROP_PROBES = 4;'),
  m('constants: 3 rescue batches', 'export const BUGHOUSE_BOT_RESCUE_BATCHES = 2;', 'export const BUGHOUSE_BOT_RESCUE_BATCHES = 3;'),
  m('values: a queen is worth 8', "const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };", "const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 8, k: 0 };"),
  m('values: a rook is worth 4', "const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };", "const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 4, q: 9, k: 0 };"),
  m('values: a king is worth something', "const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };", "const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 50 };"),
  m('values: a pawn is worth nothing', "const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };", "const VALUE: Record<string, number> = { p: 0, n: 3, b: 3, r: 5, q: 9, k: 0 };"),
  m('values: the win is small', 'const WIN = 1000;', 'const WIN = 5;'),
  m('values: the ticket is small', 'const SAN_MATE_BONUS = 100;', 'const SAN_MATE_BONUS = 1;'),
  m('values: the partner share is the whole piece', 'const BANK_SHARE = 0.5;', 'const BANK_SHARE = 1.5;'),
];

const slow = process.env.MUT_PASS === 'slow';
let selected = mutants;
if (process.env.MUT_ONLY) {
  const names = new Set(fs.readFileSync(process.env.MUT_ONLY, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean));
  selected = mutants.filter((x) => names.has(x[0]));
}

module.exports = {
  copy: ['src', 'package.json', 'tsconfig.json', 'vitest.config.mts'],
  junction: ['node_modules'],
  cmd: `npx vitest run ${slow ? SLOW : FAST} --reporter=dot --bail=1`,
  mutantTimeoutMs: (slow ? 8 : 4) * 60 * 1000,
  mutants: selected,
};
