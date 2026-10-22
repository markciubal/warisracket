// Peace chat (Ploughshares): once swords turn into ploughshares the tribe can talk, but only in
// words of one syllable ("one beat"). Shared, so the server enforces it and the client can show
// what's wrong before anything is sent.

export const CHAT = {
  maxLen: 80,      // characters
  gap: 1.5,        // seconds between one caveman's lines
  bubble: 4.5,     // seconds a line hangs over the speaker's head
  mask: 'GRR',     // what a rude word turns into
};

// Bots say these now and then in peace (one beat a word, like everybody else).
export const BOT_CHAT = [
  'HI.', 'NICE DAY.', 'ME LIKE CORN.', 'GOOD CROP.', 'SUN IS WARM.', 'NO MORE WAR.', 'LOVE YOU ALL.',
  'PEACE, FRIEND.', 'WHO WANTS FOOD?', 'THAT ROCK HURT.', 'I NEED THE DOC.', 'NEAT HAT.', 'GROW, CORN, GROW.',
  'WE DID IT.', 'SO CALM.', 'WHAT A VIEW.', 'BONK? NO. HUG.',
];

// Long words said in short ones: the grey examples under the chat box (the one for a long word
// you've just typed comes first). Every short side passes checkChat.
export const SAY_IT = [
  ['BANANA', 'A LONG, SUN-LIKE FRUIT'],
  ['HELLO', 'HI THERE'],
  ['GOODBYE', 'SEE YOU'],
  ['DOCTOR', 'THE ONE WHO HEALS'],
  ['HUNGRY', 'I NEED FOOD'],
  ['WATER', 'WET STUFF'],
  ['TOMATO', 'RED BALL YOU EAT'],
  ['CABBAGE', 'BIG GREEN HEAD YOU EAT'],
  ['CARROT', 'THIN ROOT YOU EAT'],
  ['BUSINESSMAN', 'FAT CAT IN A SUIT'],
  ['SKELETON', 'BONE MAN'],
  ['MONSTER', 'BEAST'],
  ['TOGETHER', 'AS ONE'],
  ['AMAZING', 'SO GOOD'],
  ['VILLAGE', 'TOWN'],
  ['FARMING', 'GROW FOOD'],
  ['WEAPON', 'THING THAT HURTS'],
  ['PEACEFUL', 'CALM'],
  ['THANK YOU VERY MUCH', 'THANKS A TON'],
  ['FOLLOW ME', 'COME WITH ME'],
  ['TARGET PRACTICE', 'THROW AT THE MARKS'],
  ['EVERYBODY', 'ALL OF YOU'],
  ['DANGER', 'LOOK OUT'],
  ['HAPPY', 'GLAD'],
  ['MUSHROOM', 'TOAD STOOL'],
  ['HOSPITAL', 'SICK HUT'],
];

// The rules below get these wrong, one way or the other.
const ONE = new Set(['aisle', 'isle', 'aisles', 'isles', 'prayer', 'prayers', 'squire', 'choir', 'ache', 'aches']);
const MORE = new Set([
  'create', 'creates', 'react', 'reacts', 'poem', 'poems', 'poet', 'quiet', 'diet', 'client', 'science', 'ruin',
  'fluid', 'druid', 'neon', 'chaos', 'naive', 'maybe', 'naked', 'wicked', 'sacred', 'crooked', 'rugged', 'ragged',
  'beloved', 'duet', 'fluent', 'argue', 'argues', 'cafe', 'acre', 'ogre', 'rhythm', 'rhythms', 'recipe', 'coyote', 'karate',
  'ok', 'omg', 'brb', 'gg', 'afk', 'wtf', 'idk', 'tbh', 'btw', 'imo',   // (said letter by letter: more than one beat)
]);
// spoken numbers of one beat
const NUMBERS = new Set(['1', '2', '3', '4', '5', '6', '8', '9', '10', '12']);

// How many beats a word has, roughly the way you'd say it. Counts groups of vowels, then knocks off
// the silent ones (the e in "make", the ed in "jumped", the es in "takes") and adds the ones that
// hide (the i-o in "lion", the "-ing" in "going", the n't in "didn't"). Not perfect, but on the
// short everyday words people type it's right nearly every time. Infinity: not a word it can count.
export function beats(token) {
  const raw = token.toLowerCase().replace(/[’`]/g, "'");
  if (/^\d+$/.test(raw)) return NUMBERS.has(raw) ? 1 : 2;
  const plain = raw.normalize('NFD').replace(/\p{M}/gu, '');
  if (/[^a-z']/.test(plain)) return Infinity;   // letters we can't count
  const w0 = plain.replace(/'/g, '');
  if (!w0) return 0;
  if (ONE.has(w0)) return 1;
  if (MORE.has(w0)) return 2;
  // y is a consonant at the start ("yes") and between vowels ("player"), a vowel otherwise ("my")
  const w = w0.replace(/^y/, 'j').replace(/([aeiou])y(?=[aeiou])/g, '$1j');
  const groups = w.match(/[aeiouy]+/g) || [];
  let n = groups.length;
  if (!n) return 1;   // hmm, shh, brr
  // two vowels that are two beats: li-on, gi-ant, du-o, stadi-um (not -tion, -gion, -cial, qu-, gu-)
  n += (w.match(/(?<![tscx])ia|(?<![tscxg])i[ou]|(?<![qg])u[ao]/g) || []).length;
  if (/[aeiouy]ing$/.test(w)) n++;                        // go-ing, be-ing, fly-ing
  if (/[^aeiouy']n't$/.test(raw)) n++;                    // did-n't, is-n't (not don't, can't)
  if (groups.length > 1) {
    if (/[gq]ues?$/.test(w)) n--;                         // tongue, league, plaque
    else if (/[^aeiouytd]ed$/.test(w) && !/[^aeiouy]red$/.test(w)) n--;   // jumped, loved (not want-ed, need-ed, hun-dred)
    else if (/es$/.test(w) && !/([sxzcg]|ch|sh|[^aeiouy]l)es$/.test(w) && /[^aeiouy]es$/.test(w)) n--;   // takes (not box-es, ta-bles)
    else if (/[^aeiouy]e$/.test(w) && !/[^aeiouy]le$/.test(w)) n--;   // make, there, smile (not ta-ble)
  }
  return Math.max(1, n);
}

// Rude words come out as CHAT.mask. Stems match the start of a word ("shitty"); the rest only
// match whole words (so "class" and "cocktail" are fine).
const RUDE_STEMS = ['fuck', 'shit', 'cunt', 'bitch', 'nigg', 'fagg', 'whore', 'slut', 'retard', 'twat', 'wank', 'bollock'];
const RUDE_WORDS = new Set(['ass', 'asses', 'arse', 'dick', 'dicks', 'cock', 'cocks', 'fag', 'fags', 'piss', 'pissed', 'tits', 'prick', 'damn', 'crap', 'jizz', 'cum', 'porn', 'rape']);
const rude = w => {
  const s = w.toLowerCase().replace(/[^a-z]/g, '');
  return RUDE_WORDS.has(s) || RUDE_STEMS.some(r => s.startsWith(r)) || /^ass(hole|hat|wipe)/.test(s);
};

// Tidy a line up and check it. text: what to show (capitals, rude words masked); long: the
// words with more than one beat (none means it can be said).
export function checkChat(input) {
  const text = String(input ?? '')
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '')   // control, invisible and direction characters
    .replace(/\s+/g, ' ').trim().slice(0, CHAT.maxLen);
  const long = [];
  for (const token of text.split(/[^\p{L}\p{N}'’`]+/u)) {
    const t = token.replace(/^['’`]+|['’`]+$/g, '');
    if (t && beats(t) > 1 && !long.includes(t.toUpperCase())) long.push(t.toUpperCase());
  }
  const shown = text.replace(/[\p{L}\p{N}'’`]+/gu, w => (rude(w) ? CHAT.mask : w)).toUpperCase();
  return { text: shown, long };
}
