/** Renders a sequence of already-known SAN moves with move numbers, e.g.
 * "23...Qxf8 24.Rxb8 Qxb8 25.Nd5" — shared by anything that needs to turn a plain SAN
 * list into standard numbered movetext (PGN bodies, engine-line previews). */
export function formatSanMoves(startTurn: 'w' | 'b', startMoveNumber: number, sanMoves: string[]): string {
  let turn = startTurn;
  let moveNumber = startMoveNumber;
  const parts: string[] = [];

  sanMoves.forEach((san, i) => {
    if (turn === 'w') {
      parts.push(`${moveNumber}.${san}`);
    } else {
      parts.push(i === 0 ? `${moveNumber}...${san}` : san);
      moveNumber += 1;
    }
    turn = turn === 'w' ? 'b' : 'w';
  });

  return parts.join(' ');
}
