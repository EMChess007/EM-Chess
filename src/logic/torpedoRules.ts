/**
 * Torpedo - the "how to play" sheet text, English and Greek, kept pure (no React) so a test can read it without rendering. Same shape as the other
 * variants' sheets (`racingKingsRulesSheet`, `chaturajiRulesSheet`): a list of titled sections of plain lines. The rules themselves live in `torpedo.ts`
 * (and the ChessEngine hooks); this file only describes them, so when a rule changes both languages change together.
 */

export type TorpedoRulesLang = 'en' | 'el';

export interface TorpedoRulesSection {
  title: string;
  lines: string[];
}

export const TORPEDO_RULES_TITLE: Record<TorpedoRulesLang, string> = {
  en: 'How to play Torpedo',
  el: 'Πώς παίζεται το Torpedo',
};

export const TORPEDO_RULES_CLOSE: Record<TorpedoRulesLang, string> = {
  en: 'Got it',
  el: 'Κατάλαβα',
};

const SHEET: Record<TorpedoRulesLang, TorpedoRulesSection[]> = {
  en: [
    {
      title: 'The one new rule',
      lines: [
        'A pawn may ALWAYS move one or two squares straight ahead — from any rank, not only from its starting square.',
        'Everything else is ordinary chess, from the ordinary starting position, castling included.',
      ],
    },
    {
      title: 'The double step',
      lines: [
        'Both squares in front of the pawn must be empty: a pawn never jumps over a piece, and it cannot capture straight ahead.',
        'Like every move, it may not leave your own king in check — but it can be the move that blocks a check.',
        'A pawn on the 6th rank (the 3rd for Black) that steps two squares reaches the last rank and promotes.',
      ],
    },
    {
      title: 'En passant',
      lines: [
        'Every double step can be captured en passant, on any rank: if a pawn steps two squares and lands beside an enemy pawn, that pawn may capture it as if it had moved only one square — on the very next move only.',
        'So the en passant square can be on the 4th or 5th rank as well as the 3rd or 6th.',
      ],
    },
    {
      title: 'How the game ends',
      lines: [
        'Checkmate wins. Stalemate, the fifty-move rule, threefold repetition and insufficient material are draws, exactly as in standard chess.',
        'A pawn that can still step two squares can often block a check or give you a move when you seem to have none — a position is only mate or stalemate if no double step helps either.',
      ],
    },
  ],
  el: [
    {
      title: 'Ο ένας νέος κανόνας',
      lines: [
        'Ένα πιόνι μπορεί ΠΑΝΤΑ να προχωρήσει ένα ή δύο τετράγωνα ευθεία μπροστά — από οποιαδήποτε σειρά, όχι μόνο από την αρχική του θέση.',
        'Όλα τα υπόλοιπα είναι κανονικό σκάκι, από την κανονική αρχική θέση, με ροκέ.',
      ],
    },
    {
      title: 'Η διπλή κίνηση',
      lines: [
        'Και τα δύο τετράγωνα μπροστά από το πιόνι πρέπει να είναι άδεια: το πιόνι δεν πηδάει ποτέ πάνω από κομμάτι και δεν αιχμαλωτίζει ευθεία μπροστά.',
        'Όπως κάθε κίνηση, δεν επιτρέπεται να αφήνει τον δικό σου βασιλιά σε σαχ — μπορεί όμως να είναι η κίνηση που κλείνει ένα σαχ.',
        'Ένα πιόνι στην 6η σειρά (στην 3η για τα μαύρα) που προχωρά δύο τετράγωνα φτάνει στην τελευταία σειρά και προάγεται.',
      ],
    },
    {
      title: 'Αν πασάν',
      lines: [
        'Κάθε διπλή κίνηση μπορεί να αιχμαλωτιστεί αν πασάν, σε οποιαδήποτε σειρά: αν ένα πιόνι προχωρήσει δύο τετράγωνα και προσγειωθεί δίπλα σε αντίπαλο πιόνι, εκείνο μπορεί να το πάρει σαν να είχε κινηθεί μόνο ένα τετράγωνο — μόνο στην αμέσως επόμενη κίνηση.',
        'Άρα το τετράγωνο του αν πασάν μπορεί να είναι στην 4η ή στην 5η σειρά, όχι μόνο στην 3η ή στην 6η.',
      ],
    },
    {
      title: 'Πώς τελειώνει το παιχνίδι',
      lines: [
        'Το ματ κερδίζει. Το πατ, ο κανόνας των πενήντα κινήσεων, η τριπλή επανάληψη θέσης και το ανεπαρκές υλικό δίνουν ισοπαλία, ακριβώς όπως στο κανονικό σκάκι.',
        'Ένα πιόνι που μπορεί ακόμη να προχωρήσει δύο τετράγωνα συχνά κλείνει ένα σαχ ή σου δίνει κίνηση όταν φαίνεται ότι δεν έχεις — μια θέση είναι ματ ή πατ μόνο αν δεν βοηθά καμία διπλή κίνηση.',
      ],
    },
  ],
};

/** The sections of the Torpedo rules sheet in the given language. */
export function torpedoRulesSheet(lang: TorpedoRulesLang = 'en'): TorpedoRulesSection[] {
  return SHEET[lang];
}
