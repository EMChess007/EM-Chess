/**
 * Racing Kings - the "how to play" sheet text, English and Greek, kept pure (no React) so a test can read it without rendering. Same shape as the other
 * variants' sheets (`chaturajiRulesSheet`, `bughouseRulesSheet`): a list of titled sections of plain lines. The rules themselves live in `racingKings.ts`;
 * this file only describes them, so when a rule changes (e.g. no insufficient-material draw) both languages change together.
 */

export type RacingKingsRulesLang = 'en' | 'el';

export interface RacingKingsRulesSection {
  title: string;
  lines: string[];
}

export const RACING_KINGS_RULES_TITLE: Record<RacingKingsRulesLang, string> = {
  en: 'How to play Racing Kings',
  el: 'Πώς παίζεται το Racing Kings',
};

export const RACING_KINGS_RULES_CLOSE: Record<RacingKingsRulesLang, string> = {
  en: 'Got it',
  el: 'Κατάλαβα',
};

const SHEET: Record<RacingKingsRulesLang, RacingKingsRulesSection[]> = {
  en: [
    {
      title: 'The goal',
      lines: ['Bring your KING to the 8th rank (the far edge of the board) before your opponent does. There is no checkmate in this game.'],
    },
    {
      title: 'The set-up',
      lines: [
        'Both sides have the same army: a king, a queen, two rooks, two bishops and two knights, all crowded on ranks 1 and 2. There are no pawns and no castling.',
        'White starts on the right half of the board (e-h files), Black on the left half (a-d files). White moves first.',
      ],
    },
    {
      title: 'No checks!',
      lines: [
        'Giving check is ILLEGAL. A move that attacks the enemy king is not allowed, and neither is a move that leaves your own king attacked.',
        'So a king is never in check, and no piece can threaten the king. You may still capture pieces and block your opponent’s path.',
      ],
    },
    {
      title: 'Reaching the 8th rank',
      lines: [
        'If your king reaches the 8th rank first, you win at once — unless it is White’s king and Black’s king can reach the 8th rank on the very next move.',
        'White moves first, so Black gets one reply to even things out: if White’s king reaches rank 8 and Black’s king gets there on the next move, the game is a draw. If it cannot, White wins.',
      ],
    },
    {
      title: 'Other draws',
      lines: [
        'Stalemate (you have no legal move that avoids giving check), the fifty-move rule and threefold repetition are draws.',
        'There is NO draw for insufficient material: even with bare kings the race goes on, because a lone king can still run to the 8th rank.',
      ],
    },
  ],
  el: [
    {
      title: 'Ο στόχος',
      lines: ['Φέρε τον ΒΑΣΙΛΙΑ σου στην 8η σειρά (την άκρη της σκακιέρας) πριν από τον αντίπαλο. Σε αυτό το παιχνίδι δεν υπάρχει ματ.'],
    },
    {
      title: 'Η αρχική θέση',
      lines: [
        'Και οι δύο έχουν τον ίδιο στρατό: βασιλιά, βασίλισσα, δύο πύργους, δύο αξιωματικούς και δύο ίππους, στριμωγμένους στις σειρές 1 και 2. Δεν υπάρχουν πιόνια και ροκέ.',
        'Τα λευκά ξεκινούν στο δεξί μισό της σκακιέρας (στήλες e-h), τα μαύρα στο αριστερό (στήλες a-d). Παίζουν πρώτα τα λευκά.',
      ],
    },
    {
      title: 'Όχι σαχ!',
      lines: [
        'Το σαχ είναι ΠΑΡΑΝΟΜΟ. Δεν επιτρέπεται κίνηση που απειλεί τον βασιλιά του αντιπάλου, ούτε κίνηση που αφήνει τον δικό σου βασιλιά σε απειλή.',
        'Άρα ο βασιλιάς δεν βρίσκεται ποτέ σε σαχ και κανένα κομμάτι δεν τον απειλεί. Μπορείς όμως να αιχμαλωτίζεις κομμάτια και να κλείνεις τον δρόμο του αντιπάλου.',
      ],
    },
    {
      title: 'Η άφιξη στην 8η σειρά',
      lines: [
        'Αν ο βασιλιάς σου φτάσει πρώτος στην 8η σειρά, κερδίζεις αμέσως — εκτός αν είναι ο βασιλιάς των λευκών και ο βασιλιάς των μαύρων μπορεί να φτάσει στην 8η σειρά με την επόμενη κίνηση.',
        'Τα λευκά παίζουν πρώτα, γι’ αυτό τα μαύρα έχουν μία απάντηση για να εξισώσουν: αν ο λευκός βασιλιάς φτάσει στην 8η σειρά και ο μαύρος φτάσει κι αυτός στην επόμενη κίνηση, το παιχνίδι είναι ισοπαλία. Αν δεν μπορεί, κερδίζουν τα λευκά.',
      ],
    },
    {
      title: 'Άλλες ισοπαλίες',
      lines: [
        'Το πατ (δεν έχεις νόμιμη κίνηση που να αποφεύγει το σαχ), ο κανόνας των πενήντα κινήσεων και η τριπλή επανάληψη θέσης δίνουν ισοπαλία.',
        'ΔΕΝ υπάρχει ισοπαλία λόγω ανεπαρκούς υλικού: ακόμη και με γυμνούς βασιλιάδες ο αγώνας συνεχίζεται, γιατί ένας μόνος βασιλιάς μπορεί να τρέξει στην 8η σειρά.',
      ],
    },
  ],
};

/** The sections of the Racing Kings rules sheet in the given language. */
export function racingKingsRulesSheet(lang: RacingKingsRulesLang = 'en'): RacingKingsRulesSection[] {
  return SHEET[lang];
}
