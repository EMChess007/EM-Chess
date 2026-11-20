/**
 * Knightmate - the "how to play" sheet text, English and Greek, kept pure (no React) so a test can read it without rendering. Same shape as the other variants' sheets
 * (`torpedoRulesSheet`, `racingKingsRulesSheet`): a list of titled sections of plain lines, plus a LEGEND that explains how the board and the move list write the two
 * special pieces (the crown badge, the "M" badge, and the notation K / M / =M). The rules themselves live in `knightmate.ts` (and the ChessEngine hooks); this file only
 * describes them, so when a rule changes both languages change together.
 */

export type KnightmateRulesLang = 'en' | 'el';

export interface KnightmateRulesSection {
  title: string;
  lines: string[];
}

/** One legend row. `kind` says what the sheet draws next to the text: the royal knight (crown badge), the Commoner ("M" badge) or nothing (the notation row). */
export interface KnightmateLegendEntry {
  kind: 'royal' | 'commoner' | 'notation';
  title: string;
  text: string;
}

export const KNIGHTMATE_RULES_TITLE: Record<KnightmateRulesLang, string> = {
  en: 'How to play Knightmate',
  el: 'Πώς παίζεται το Knightmate',
};

export const KNIGHTMATE_LEGEND_TITLE: Record<KnightmateRulesLang, string> = {
  en: 'Legend',
  el: 'Υπόμνημα',
};

export const KNIGHTMATE_RULES_CLOSE: Record<KnightmateRulesLang, string> = {
  en: 'Got it',
  el: 'Κατάλαβα',
};

const SHEET: Record<KnightmateRulesLang, KnightmateRulesSection[]> = {
  en: [
    {
      title: 'The one big change',
      lines: [
        'The KNIGHT is the royal piece. Each side has one royal knight (on e1 / e8 at the start) and it takes the place of the king: you check it, you mate it, and you lose if it is mated.',
        'The ordinary king is gone. In its place each side has two Commoners, on b1 / g1 (b8 / g8 for Black). Everything else — queen, rooks, bishops, pawns — is as usual.',
      ],
    },
    {
      title: 'The royal knight',
      lines: [
        'It moves like a knight. It may never move to, or stay on, a square an enemy piece attacks — exactly like a king in standard chess.',
        'It can capture, and it can be defended by your other pieces.',
        'Two royal knights can never stand a knight’s move apart: each would attack the other.',
      ],
    },
    {
      title: 'The Commoner',
      lines: [
        'It steps one square in any direction, like a king, but it is NOT royal: it can be attacked, captured and traded like any other piece, and a check does not involve it.',
        'A pawn that reaches the last rank promotes to a queen, a rook, a bishop or a Commoner — never to a knight, because there are no ordinary knights in this game.',
      ],
    },
    {
      title: 'Castling',
      lines: [
        'The royal knight that has not moved may castle with a rook that has not moved: it jumps two squares toward the rook (onto the c- or g-file) and the rook goes to the other side of it.',
        'The usual conditions apply: every square between them is empty, the royal knight is not in check, and it does not pass through or land on an attacked square.',
        'The Commoners start on b1 / g1, between the royal knight and the rooks, so castling only becomes possible once they have moved away.',
      ],
    },
    {
      title: 'How the game ends',
      lines: [
        'Checkmate of the royal knight wins. Stalemate, the fifty-move rule and threefold repetition are draws.',
        'Insufficient material is a draw only when both sides have nothing left but their royal knight. Any other position is played on.',
        'On the clock: if your time runs out you lose — unless your opponent has only a royal knight left, which can never checkmate; then the game is a draw.',
      ],
    },
  ],
  el: [
    {
      title: 'Η μία μεγάλη αλλαγή',
      lines: [
        'Το ΑΛΟΓΟ είναι το βασιλικό κομμάτι. Κάθε πλευρά έχει ένα βασιλικό άλογο (στο e1 / e8 στην αρχή) και παίρνει τη θέση του βασιλιά: του δίνεις σαχ, του δίνεις ματ, και χάνεις αν ματαριστεί.',
        'Ο συνηθισμένος βασιλιάς λείπει. Στη θέση του κάθε πλευρά έχει δύο Commoner, στα b1 / g1 (b8 / g8 για τα μαύρα). Όλα τα άλλα — βασίλισσα, πύργοι, αξιωματικοί, πιόνια — είναι όπως πάντα.',
      ],
    },
    {
      title: 'Το βασιλικό άλογο',
      lines: [
        'Κινείται σαν άλογο. Δεν επιτρέπεται ποτέ να πάει ή να μείνει σε τετράγωνο που επιτίθεται αντίπαλο κομμάτι — ακριβώς όπως ο βασιλιάς στο κανονικό σκάκι.',
        'Μπορεί να αιχμαλωτίσει και να προστατεύεται από τα άλλα σου κομμάτια.',
        'Δύο βασιλικά άλογα δεν μπορούν ποτέ να βρεθούν σε απόσταση κίνησης αλόγου: το καθένα θα επιτίθετο στο άλλο.',
      ],
    },
    {
      title: 'Ο Commoner',
      lines: [
        'Κινείται ένα τετράγωνο προς κάθε κατεύθυνση, σαν βασιλιάς, αλλά ΔΕΝ είναι βασιλικός: μπορεί να δεχτεί επίθεση, να αιχμαλωτιστεί και να ανταλλαγεί όπως κάθε άλλο κομμάτι, και το σαχ δεν τον αφορά.',
        'Ένα πιόνι που φτάνει στην τελευταία σειρά προάγεται σε βασίλισσα, πύργο, αξιωματικό ή Commoner — ποτέ σε άλογο, γιατί δεν υπάρχουν συνηθισμένα άλογα σε αυτό το παιχνίδι.',
      ],
    },
    {
      title: 'Ροκέ',
      lines: [
        'Το βασιλικό άλογο που δεν έχει κινηθεί μπορεί να κάνει ροκέ με πύργο που δεν έχει κινηθεί: πηδάει δύο τετράγωνα προς τον πύργο (στη στήλη c ή g) και ο πύργος πηγαίνει στην άλλη του πλευρά.',
        'Ισχύουν οι συνήθεις όροι: όλα τα τετράγωνα ανάμεσά τους είναι άδεια, το βασιλικό άλογο δεν είναι σε σαχ και δεν περνά ούτε προσγειώνεται σε τετράγωνο υπό επίθεση.',
        'Οι Commoner ξεκινούν στα b1 / g1, ανάμεσα στο βασιλικό άλογο και τους πύργους, άρα το ροκέ γίνεται δυνατό μόνο αφού έχουν φύγει από εκεί.',
      ],
    },
    {
      title: 'Πώς τελειώνει το παιχνίδι',
      lines: [
        'Το ματ στο βασιλικό άλογο κερδίζει. Το πατ, ο κανόνας των πενήντα κινήσεων και η τριπλή επανάληψη θέσης δίνουν ισοπαλία.',
        'Το ανεπαρκές υλικό είναι ισοπαλία μόνο όταν και οι δύο πλευρές έχουν μόνο το βασιλικό τους άλογο. Κάθε άλλη θέση συνεχίζεται.',
        'Στο ρολόι: αν τελειώσει ο χρόνος σου χάνεις — εκτός αν ο αντίπαλος έχει μόνο βασιλικό άλογο, που δεν μπορεί ποτέ να δώσει ματ· τότε το παιχνίδι είναι ισοπαλία.',
      ],
    },
  ],
};

const LEGEND: Record<KnightmateRulesLang, KnightmateLegendEntry[]> = {
  en: [
    { kind: 'royal', title: 'Crown = royal knight', text: 'The knight with a gold crown badge is the royal knight. It is the piece you must protect. Notation: K (for example Kf3).' },
    { kind: 'commoner', title: '“M” = Commoner', text: 'The king-shaped piece with an “M” badge is a Commoner. It steps one square in any direction and is not royal. Notation: M (for example Mb2).' },
    { kind: 'notation', title: 'Notation: K / M / =M', text: 'The move list writes K for the royal knight, M for a Commoner and =M when a pawn promotes to a Commoner (for example axb8=M). Q, R and B are as usual; N never appears.' },
  ],
  el: [
    { kind: 'royal', title: 'Στέμμα = βασιλικό άλογο', text: 'Το άλογο με χρυσό στέμμα είναι το βασιλικό άλογο. Είναι το κομμάτι που πρέπει να προστατεύσεις. Σημειογραφία: K (π.χ. Kf3).' },
    { kind: 'commoner', title: '«M» = Commoner', text: 'Το κομμάτι με σχήμα βασιλιά και σήμα «M» είναι Commoner. Κινείται ένα τετράγωνο προς κάθε κατεύθυνση και δεν είναι βασιλικός. Σημειογραφία: M (π.χ. Mb2).' },
    { kind: 'notation', title: 'Σημειογραφία: K / M / =M', text: 'Η λίστα κινήσεων γράφει K για το βασιλικό άλογο, M για Commoner και =M όταν ένα πιόνι προάγεται σε Commoner (π.χ. axb8=M). Τα Q, R και B είναι όπως πάντα· το N δεν εμφανίζεται ποτέ.' },
  ],
};

/** The sections of the Knightmate rules sheet in the given language. */
export function knightmateRulesSheet(lang: KnightmateRulesLang = 'en'): KnightmateRulesSection[] {
  return SHEET[lang];
}

/** The legend rows (crown, "M", notation) of the Knightmate rules sheet in the given language. */
export function knightmateLegend(lang: KnightmateRulesLang = 'en'): KnightmateLegendEntry[] {
  return LEGEND[lang];
}
