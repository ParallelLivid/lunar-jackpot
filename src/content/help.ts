/**
 * The help reference: every system, stated once, in one place.
 *
 * Content rather than JSX, because this is long-lived authored prose that wants
 * proofreading and a length budget, and `validateContent` can enforce both on a
 * data structure in a way it could not on a component tree.
 *
 * The length budget is load-bearing: the window must never scroll, so a topic
 * that outgrows its frame is split rather than scrolled. `validateContent` fails
 * the build at `MAXIMUM_ENTRY_BODY` and `MAXIMUM_TOPIC_BODY`, where the author
 * finds out rather than an end-to-end test on whichever topic somebody opens.
 *
 * Information first, voice second. Every topic opens in The Company's register
 * and then becomes plain; no sentence may cost the reader a fact to make a joke.
 */

import { SPRITES } from "../rendering/sprites";

export const HELP_TOPIC_IDS = [
  "help.company",
  "help.floor",
  "help.machines",
  "help.expeditions",
  "help.oxygen",
  "help.conditions",
  "help.gear",
  "help.trinkets",
  "help.totems",
  "help.caches",
  "help.supplies",
  "help.gambling",
  "help.cats",
  "help.prestige",
  "help.music",
  "help.numbers",
  "help.save",
] as const;

export type HelpTopicId = (typeof HELP_TOPIC_IDS)[number];

export interface HelpEntry {
  /** A term, or the question a player would actually ask. */
  term: string;
  /** One paragraph. Two sentences is the budget; three is the maximum. */
  body: string;
}

export interface HelpTopic {
  id: HelpTopicId;
  title: string;
  /** Reuses an existing sprite rather than adding an icon set, as the rail does. */
  spriteId: string;
  /** The opening line: what the system is, before any of its rules. */
  summary: string;
  entries: HelpEntry[];
}

/** Longest an entry's body may be. See the file docstring. */
export const MAXIMUM_ENTRY_BODY = 320;

/**
 * Longest a topic's prose may be in total, summary included. Derived from the
 * column geometry: the widest window is 58rem less a 14rem nav pane, holding
 * about three 220px columns, and 1,800 characters fills roughly two — the third
 * is the headroom that keeps a small viewport off the scroll floor.
 */
export const MAXIMUM_TOPIC_BODY = 1_800;

export const HELP_TOPICS: Record<HelpTopicId, HelpTopic> = {
  "help.company": {
    id: "help.company",
    title: "The Company",
    spriteId: "sprite.miner.company",
    summary:
      "Your employer. It owns the moon, the casino, the games in it, and the tank on your back.",
    entries: [
      {
        term: "Why you are here",
        body: "You had debts and a gambling problem. The Company consolidated the first and found a use for the second: run a casino on the moon, and take the difference out of everyone who lands here.",
      },
      {
        term: "Why you are paid in chips",
        body: "Ore is cashed out at the end of a run in Company chips rather than in money. Chips buy research, supplies, caches and a seat at the Company's own games. They do not leave.",
      },
      {
        term: "The two economies",
        body: "Cash comes only from casino machines and is spent on machines and keys. Chips come only from banked ore. Neither converts into the other, which is why both loops have to be played.",
      },
      {
        term: "Where to start",
        body: "Buy a machine level, launch an expedition, and return before the oxygen does. Every other system opens off those three.",
      },
    ],
  },

  "help.floor": {
    id: "help.floor",
    title: "The casino floor",
    spriteId: "sprite.machine.alpha",
    summary: "Ten positions, each holding a machine that turns time into cash.",
    entries: [
      {
        term: "How machines pay",
        body: "Each machine runs a cycle and pays out when the cycle completes. Payout and cycle length are shown on the machine panel, and the rate underneath is what the two come to per second.",
      },
      {
        term: "While the game is closed",
        body: "Machines keep producing, up to a cap of ninety minutes. Longer absences are credited at ninety minutes, and the welcome-back note says when the cap has bitten.",
      },
      {
        term: "Locked positions",
        body: "A locked tile names the depth band its recipe pieces come from. Machines further down the ladder pay more, cost more, and are worth reaching for rather than skipping to.",
      },
      {
        term: "Selecting a machine",
        body: "Clicking a tile fills the machine panel beside the floor. Selection changes nothing about production; it only decides which machine the panel is talking about.",
      },
    ],
  },

  "help.machines": {
    id: "help.machines",
    title: "Machines",
    spriteId: "sprite.machine.gamma",
    summary: "Four ways to make one machine better, each on its own currency.",
    entries: [
      {
        term: "Levels",
        body: "A level raises the payout permanently. It costs cash, and every fifth level costs components as well; the panel offers batches of ten and a hundred once you can afford them.",
      },
      {
        term: "Recipe pieces",
        body: "Found on expeditions. Collecting a machine's full set unlocks it; until then the tile stays locked and says how many pieces are still missing.",
      },
      {
        term: "Research",
        body: "Bought with chips. A research node raises one machine's output along a specific line, and repeatable nodes count up rank by rank.",
      },
      {
        term: "Specs",
        body: "A spec trades one property of a machine against another — slower cycles for a larger payout, say. One spec at a time. Switching is free and keeps the cycle progress you have already earned, though a flywheel's ramp starts again from cold.",
      },
    ],
  },

  "help.expeditions": {
    id: "help.expeditions",
    title: "Expeditions",
    spriteId: "sprite.player",
    summary: "A run down into the moon for ore, relics, components and recipe pieces.",
    entries: [
      {
        term: "The four rules",
        body: "Oxygen refills free between runs. Ore becomes chips only when you return. How long an encounter takes is not knowable in advance. If oxygen runs out, every unbanked unit is rolled separately to be lost.",
      },
      {
        term: "Depth",
        body: "Depth rises by one for every encounter completed, and deeper encounters pay more. Bands change every twenty-five depths: the Shelf, Deep Seams, the Dark, the Hollows, and the Selenite Core from 100 down.",
      },
      {
        term: "Reaching an encounter commits you",
        body: "You do not choose whether to take an encounter; arriving at one begins it. The choice is what comes after it resolves — press on into something unseen, or return and bank what you are carrying.",
      },
      {
        term: "Auto-continue",
        body: "Presses on by itself while oxygen is above the threshold you set. It never banks and it never answers an encounter's own choice, so a run can still stop and wait for you.",
      },
    ],
  },

  "help.oxygen": {
    id: "help.oxygen",
    title: "Oxygen and failure",
    spriteId: "sprite.gear.tank",
    summary: "Oxygen is the clock on a run, and running out is the only way to lose one.",
    entries: [
      {
        term: "What spends it",
        body: "Time does. Oxygen drains while you travel and while an encounter resolves, so a long encounter costs more than a short one and neither announces its length up front.",
      },
      {
        term: "The warning",
        body: "The meter marks the last quarter of the tank. It is a reading, not a rule — nothing stops you pressing on past it.",
      },
      {
        term: "What failure costs",
        body: "Each unbanked unit is rolled independently against the loss chance shown on the meters, which starts at half. Some of a haul usually comes home, and none of it is guaranteed to.",
      },
      {
        term: "What failure does not cost",
        body: "Depth reached still counts, and anything already secured during the run stays secured. The tank refills for free either way.",
      },
    ],
  },

  "help.conditions": {
    id: "help.conditions",
    title: "Run conditions",
    spriteId: "sprite.encounter.hazard",
    summary: "Two things can colour a run: a condition rolled at launch, and a contract offered on the way down.",
    entries: [
      {
        term: "Conditions",
        body: "About one run in three rolls one, named in the expedition panel's header. Most give something and take something — richer seams for thinner air — and the trade is stated in full before you launch.",
      },
      {
        term: "Contracts",
        body: "Offered mid-run by an encounter, and always for a depth a little further down. A contract says what it will pay and never what it will take.",
      },
      {
        term: "Ignoring a contract",
        body: "Costs nothing. Banking before the target simply ends it, and the run is otherwise unchanged. One condition is the exception and holds the exit shut until its depth, which it says plainly.",
      },
    ],
  },

  "help.gear": {
    id: "help.gear",
    title: "Gear",
    spriteId: "sprite.gear.pickaxe",
    summary: "Two ladders of twelve levels, both bought with relics, that decide how deep a run can reach.",
    entries: [
      {
        term: "The oxygen tank",
        body: "Sets how much oxygen a run starts with, which is very nearly the depth it can reach — a depth costs roughly seven seconds. The ladder is pitched so each band opens with margin rather than on a lucky run.",
      },
      {
        term: "The pickaxe",
        body: "Sets how fast an ore node breaks. Damage lands per strike rather than smoothly, so a critical hit is an event you can see rather than an average you infer.",
      },
      {
        term: "Relics",
        body: "Found on expeditions and spent only here. Roughly eighteen runs buys a level at the tier that needs it, so the ladder is a goal rather than a purchase.",
      },
      {
        term: "Trinket slots",
        body: "Each gear item holds up to three trinkets, unlocked at levels 1, 3 and 5. Prestige relocks the second and third without taking the trinkets in them.",
      },
    ],
  },

  "help.trinkets": {
    id: "help.trinkets",
    title: "Trinkets",
    spriteId: "sprite.trinket.regulator",
    summary: "Small permanent buffs that attach to the oxygen tank or the pickaxe.",
    entries: [
      {
        term: "Attaching",
        body: "A trinket fits one gear item, not both, and the panel refuses the wrong one. Moving a trinket between slots is free and can be done any time you are on the surface.",
      },
      {
        term: "Grades",
        body: "Every trinket runs from E to SSS on a shared ladder. Only grade E is authored; each step up multiplies the same effect, and SSS is a hundred times the base.",
      },
      {
        term: "Fragments and merging",
        body: "Finding a trinket you already own gives a fragment instead of a duplicate. Fragments raise that trinket a grade, costing 3, 5, 8, 13, 21, 34 and 55 as it climbs.",
      },
      {
        term: "They survive prestige",
        body: "Trinkets, their grades and their fragments are all kept across a reset. They are the part of a cycle that compounds.",
      },
    ],
  },

  "help.totems": {
    id: "help.totems",
    title: "Totems",
    spriteId: "sprite.totem.prospector",
    summary: "Run modifiers you choose, three at a time, mostly dealing in luck.",
    entries: [
      {
        term: "Three slots",
        body: "Three totems are active at once and the rest sit in the collection doing nothing. Swapping is free on the surface and locked during a run.",
      },
      {
        term: "What luck does",
        body: "Luck shifts the odds toward the better outcome: kinder encounters on a run, and a better return at every chip game. Its effect diminishes as it rises, so the first points are worth the most.",
      },
      {
        term: "What totems never touch",
        body: "Tank oxygen and pickaxe damage. That is a rule of the system rather than an accident of the current set — those two belong to gear, and totems are barred from them.",
      },
      {
        term: "Grades",
        body: "The same E to SSS ladder trinkets use, fed by the same fragments from duplicates. Totems are kept across a prestige, active loadout included.",
      },
    ],
  },

  "help.caches": {
    id: "help.caches",
    title: "Caches and keys",
    spriteId: "sprite.resource.caches",
    summary: "Sealed boxes that hold trinkets and totems. The Company sells the keys.",
    entries: [
      {
        term: "Two kinds",
        body: "An ordinary cache usually holds a trinket. A deep cache usually holds a totem, is found below the Dark, and costs proportionately more.",
      },
      {
        term: "Keys",
        body: "250 cash each from the store, and one key opens one cache of either kind. Caches accumulate whether or not you have keys for them.",
      },
      {
        term: "Buying caches",
        body: "The cash price is the Company restocking on a schedule: one ordinary cache per 10 depths descended, one deep cache per 100, counted across every run rather than by how deep you got.",
      },
      {
        term: "The chip price",
        body: "50 chips for an ordinary cache and 500 for a deep one, always in stock and bought in bulk. Chips are the currency you will have least use for once the floor is running.",
      },
      {
        // The reserve rule: without it stated somewhere, a player holding one
        // cache's worth of cash watches an in-stock cache go unbought.
        term: "The standing order",
        body: "The store can buy the cash-priced cache for you whenever one is in stock. It never spends below twice the price, so the order cannot leave you at zero, and it never touches the chip price.",
      },
      {
        term: "Duplicates",
        body: "A cache holding something you already own pays a fragment toward its next grade instead. At the top of the ladder it pays selenite, so no open is ever wasted.",
      },
    ],
  },

  "help.supplies": {
    id: "help.supplies",
    title: "Expedition supplies",
    spriteId: "sprite.consumable.spare-canister",
    summary: "Single-use items that change the next run, and only the next run.",
    entries: [
      {
        term: "How they work",
        body: "Bought with chips and spent on the next launch, whether or not it comes home. One of each at most.",
      },
      {
        term: "Packing them",
        body: "Anything bought shows as packed above the launch button, so the loadout is visible where the decision is made rather than only in the store.",
      },
      {
        term: "Two of them are capped",
        body: "Critical chance and the failure-loss rate both have limits, so those supplies are worth less to already well-equipped gear. Each says so on its own tile.",
      },
      {
        term: "Prestige clears them",
        body: "Supplies are bought with chips and chips reset, so anything packed and unspent goes with them.",
      },
    ],
  },

  "help.gambling": {
    id: "help.gambling",
    title: "Chip gambling",
    spriteId: "sprite.totem.gambler",
    summary: "Four games, all run by The Company, all played with the chips it pays you in.",
    entries: [
      {
        term: "The four",
        body: "Slots, roulette and blackjack settle immediately. The depth wager is the odd one: it stakes chips on how deep your next run gets, and settles when that run ends.",
      },
      {
        term: "The house",
        body: "Every game starts with an expected return below what it takes. That is not a bug to be optimised around; it is what the games are for, and The Company owns all four.",
      },
      {
        term: "Luck applies here too",
        body: "Luck improves the return at every game, up to a ceiling of breaking even. It can undo the house edge and never invert it, and it moves how often an outcome comes up rather than what any outcome pays.",
      },
      {
        term: "Chips have other uses",
        body: "Research, specs, caches, supplies and looks all take chips. Gambling is the only one that can give them back, and the only one that usually does not.",
      },
    ],
  },

  "help.cats": {
    id: "help.cats",
    title: "Cats and looks",
    spriteId: "sprite.cat.rest",
    summary: "The moon has cats. Meeting one is rare, permanent, and worth something.",
    entries: [
      {
        term: "What a cat is for",
        body: "Each cat adds permanent luck — 25 points, kept through every prestige. They are the only luck in the game that cannot be bought, traded or lost.",
      },
      {
        term: "Meeting one",
        body: "About one encounter in a thousand is a cat. There is no way to make it likelier, and the run pauses for a moment when it happens.",
      },
      {
        term: "The litterbox",
        body: "Every cat you have met sits beside the casino floor with a count on the heading. Clicking one cycles it through the looks you own.",
      },
      {
        term: "Looks",
        body: "Cat and miner skins are bought with chips in the Skins window. They change nothing but the sprite, and they survive a prestige.",
      },
    ],
  },

  "help.prestige": {
    id: "help.prestige",
    title: "Prestige",
    spriteId: "sprite.prestige",
    summary: "Trade the whole cycle for selenite, and buy something permanent with it.",
    entries: [
      {
        term: "When you may",
        body: "Once this cycle's earned cash passes the threshold shown in the prestige window. The threshold rises with each prestige, so every cycle asks for more than the last.",
      },
      {
        term: "What it clears",
        body: "Every currency; machine unlocks, levels, research, specs and recipe pieces; both gear ladders, relocking the second and third trinket slots; and any supplies packed but unspent.",
      },
      {
        term: "What it keeps",
        body: "Every trinket and totem you own, the active totem loadout, every cat and every look, and selenite, perks, settings and statistics.",
      },
      {
        term: "The perk tree",
        body: "Three branches from a shared root, bought with selenite. Perks are repeatable up to their own rank cap, and costs rise geometrically, so a branch's last rank is a multi-cycle goal.",
      },
      {
        term: "It cannot interrupt",
        body: "A prestige is refused while a run is in flight or a bet is unsettled, and the window names whichever it is waiting for.",
      },
    ],
  },

  "help.music": {
    id: "help.music",
    title: "Music",
    spriteId: "sprite.jukebox",
    summary: "Six tracks: one for the casino, and one for each depth band.",
    entries: [
      {
        term: "Following the scene",
        body: "By default the track follows where you are — the casino on the surface, and each band as you reach it. Tempo and pitch both fall as the bands get deeper.",
      },
      {
        term: "The jukebox",
        body: "Unlocks on the rail once a run has reached depth 250, and lets you pick a track and keep it. While one is chosen, nothing the game does changes it — not launching, not descending, not failing.",
      },
      {
        term: "Volume",
        body: "Music has its own slider in Settings, under the master volume. Setting it to zero stops the sequencer rather than playing silence, and the jukebox cannot override it.",
      },
    ],
  },

  "help.numbers": {
    id: "help.numbers",
    title: "Reading the numbers",
    spriteId: "sprite.totem.ledger",
    summary: "Where to find what a bonus is doing, and what this save has done.",
    entries: [
      {
        term: "Buffs",
        body: "One sheet listing every gear, trinket, totem, cat and perk bonus currently applying, grouped by what it affects. It reports; it never waits for anything.",
      },
      {
        term: "Statistics",
        body: "What this save has done since the beginning — runs, depth, ore, wagers and spending. Statistics survive a prestige, so lifetime figures really are lifetime.",
      },
      {
        term: "Compact and exact",
        body: "Large numbers are abbreviated by default. Settings has a switch for exact figures everywhere, and a tooltip carries the full number either way.",
      },
      {
        term: "Disabled controls",
        body: "Anything you cannot do says why, on hover or beside the control. If a button is refusing you, the reason is already on screen.",
      },
    ],
  },

  "help.save": {
    id: "help.save",
    title: "Your save and settings",
    spriteId: "sprite.resource.cash",
    summary: "One save, in this browser, written for you as you play.",
    entries: [
      {
        term: "Saving",
        body: "The game saves itself after anything that matters and on a timer besides. The Save window shows the current state and can write one immediately.",
      },
      {
        term: "Export and import",
        body: "Export writes the save to a file; import reads one back, after saving the current game first as a backup. A file that fails its checksum is refused rather than half-loaded.",
      },
      {
        term: "One tab at a time",
        body: "Only one tab may write. A second becomes read-only and says so, which stops two copies of the game from overwriting each other.",
      },
      {
        term: "Full reset",
        body: "Clears everything, including selenite, perks and collections, and starts the tutorial again. It is the one action here that cannot be undone.",
      },
      {
        term: "Settings",
        body: "Volumes, reduced motion, screen shake, number format, and whether rail windows open one at a time. All of it survives a prestige.",
      },
      {
        term: "No real money",
        body: "All currency here is fictional. There is no real-money play of any kind, and nothing in this game can be bought with or exchanged for anything outside it.",
      },
    ],
  },
};

/** Total authored prose in a topic, which the budget is measured against. */
export function topicBodyLength(topic: HelpTopic): number {
  return (
    topic.summary.length +
    topic.entries.reduce((total, entry) => total + entry.term.length + entry.body.length, 0)
  );
}

export function isHelpTopicId(value: unknown): value is HelpTopicId {
  return typeof value === "string" && (HELP_TOPIC_IDS as readonly string[]).includes(value);
}

/** Every sprite a topic names, for the validator. Exported for the test to walk. */
export function helpSpriteIds(): string[] {
  return HELP_TOPIC_IDS.map((id) => HELP_TOPICS[id].spriteId);
}

/** True when every sprite a topic names actually exists. */
export function helpSpritesExist(): boolean {
  return helpSpriteIds().every((spriteId) => SPRITES[spriteId] !== undefined);
}
