/**
 * The mock platform database.
 *
 * The spec puts every business rule in the Go core and says the front end may
 * only display. That rule is what makes this file possible: the web app needs
 * *a* server that answers the API contract, not specifically the Go one. So the
 * authenticated surface is built against `/api/v1/...` route handlers backed by
 * this store, and pointing `NEXT_PUBLIC_API_BASE_URL` at the real core later is
 * a base-URL change rather than a rewrite of every page.
 *
 * Two consequences are deliberate:
 *
 *   * Business rules live *here*, not in components. Entitlement checks, the
 *     wallet balance and the kids policy are computed on this side of the wire
 *     for the same reason the spec gives — a rule written in the component gets
 *     written twice more when the Flutter app arrives, and then the three
 *     diverge.
 *   * Nothing is persisted. This is a demonstration of behaviour, not a
 *     database; a restart returns to the seed. Where a real rule would be
 *     enforced by a constraint, the note says so.
 */

import { BOOKS, VOICES } from "@/lib/catalog";
import type { AudioEdition, Book } from "@/lib/catalog";

/* ── Domain types ────────────────────────────────────────────────────────—
   These mirror the spec's data-model table. The two shapes worth reading
   closely are `WalletLedger` and `Entitlement`, because both are modelled the
   way the spec insists and neither is the obvious shortcut.                */

export interface User {
  id: string;
  /** Login identity. The spec's auth is OTP over SMS — no password, no email. */
  phone: string;
  name?: string;
  createdAt: string;
  /** `creator` unlocks the studio tile; `admin` the moderation panel. */
  roles: ("listener" | "creator" | "publisher" | "org_admin" | "admin")[];
}

/** A pending SMS challenge. Real deployments send this; the mock returns it. */
export interface OtpChallenge {
  phone: string;
  code: string;
  expiresAt: number;
  attempts: number;
}

/**
 * A refresh token, stored so it can be revoked.
 *
 * The spec asks for a short-lived access token and an *opaque* refresh token
 * held in the database precisely so that logging out, or losing a device, can
 * invalidate a session server-side. A self-contained JWT refresh token cannot
 * be withdrawn before it expires.
 */
export interface Session {
  refreshToken: string;
  accessToken: string;
  userId: string;
  deviceId: string;
  accessExpiresAt: number;
  createdAt: string;
}

/** Per the spec: the row that makes a concurrent-playback cap possible. */
export interface Device {
  id: string;
  userId: string;
  label: string;
  lastSeenAt: string;
}

/**
 * The right to listen — deliberately *not* the purchase that created it.
 *
 * The spec separates these so that a gift, a coupon, an organisation seat and a
 * subscription can all grant access without any of them having to be modelled
 * as a payment. `source` records which one it was; `expiresAt` is null for a
 * permanent purchase and set for the rest.
 */
export interface Entitlement {
  id: string;
  userId: string;
  editionId: string;
  source: "purchase" | "gift" | "subscription" | "org" | "promo";
  grantedAt: string;
  expiresAt: string | null;
}

/**
 * One line of the append-only wallet ledger.
 *
 * The spec is explicit that a balance is a *derived* number and never a column,
 * because a stored balance and a transaction history can disagree and only one
 * of them can be audited. `balanceOf` below is the only way to read a balance.
 * Amounts are Rial and signed: credit positive, debit negative.
 */
export interface LedgerEntry {
  id: string;
  userId: string;
  amountRial: number;
  kind: "topup" | "purchase" | "refund" | "gift_received" | "promo";
  /** Human-readable, shown in the wallet history. */
  memo: string;
  /** Set when the line was caused by an order, for reconciliation. */
  orderId?: string;
  createdAt: string;
}

export interface Order {
  id: string;
  userId: string;
  editionId: string;
  priceRial: number;
  status: "paid" | "refunded";
  createdAt: string;
}

/**
 * Playback position, keyed on the *edition* rather than the book.
 *
 * The spec calls this out specifically: a listener who switches from the human
 * narration to the AI one is at a different second in a different performance,
 * and a position stored per book would silently overwrite one with the other.
 */
export interface ListeningPosition {
  userId: string;
  editionId: string;
  positionSec: number;
  /** Device clock, used for the spec's last-write-wins conflict rule. */
  updatedAt: string;
}

export interface Bookmark {
  id: string;
  userId: string;
  editionId: string;
  positionSec: number;
  label: string;
  createdAt: string;
}

export interface Note {
  id: string;
  userId: string;
  editionId: string;
  positionSec: number;
  body: string;
  createdAt: string;
}

interface Db {
  users: User[];
  otps: OtpChallenge[];
  sessions: Session[];
  devices: Device[];
  entitlements: Entitlement[];
  ledger: LedgerEntry[];
  orders: Order[];
  positions: ListeningPosition[];
  bookmarks: Bookmark[];
  notes: Note[];
}

/* ── Singleton ───────────────────────────────────────────────────────────—
   Held on `globalThis` rather than in a module-level `const`. The dev server
   re-evaluates modules on every edit, and a plain const would silently reset
   the store — and log the developer out — on each save.                     */

declare global {
  var __ketapodDb: Db | undefined;
}

/** The demo account. Any phone works, but this one starts with a history. */
export const DEMO_PHONE = "09120000000";

export const uid = () => Math.random().toString(36).slice(2, 11);

const iso = (offsetDays = 0) =>
  new Date(Date.now() + offsetDays * 86_400_000).toISOString();

/* ── Seed ────────────────────────────────────────────────────────────────— */

/**
 * A catalogue-shaped starting state.
 *
 * The demo user owns three editions, has a part-listened fourth, and carries a
 * wallet balance — enough that the library, the player and the wallet all have
 * something to show on first login rather than three empty states.
 */
function seed(): Db {
  const user: User = {
    id: "usr_demo",
    phone: DEMO_PHONE,
    name: "کاربر نمونه",
    createdAt: iso(-40),
    roles: ["listener", "creator"],
  };

  const owned = BOOKS.slice(0, 3)
    .map((b) => defaultEditionOf(b))
    .filter((e): e is AudioEdition => Boolean(e));

  const entitlements: Entitlement[] = owned.map((e, i) => ({
    id: `ent_${uid()}`,
    userId: user.id,
    editionId: e.id,
    /* One of each origin, so the wallet and library screens show that the
       spec's `source` field is load-bearing rather than decorative. */
    source: (["purchase", "gift", "subscription"] as const)[i] ?? "purchase",
    grantedAt: iso(-30 + i * 7),
    expiresAt: i === 2 ? iso(21) : null,
  }));

  const ledger: LedgerEntry[] = [
    {
      id: `led_${uid()}`,
      userId: user.id,
      amountRial: 5_000_000,
      kind: "topup",
      memo: "شارژ کیف پول",
      createdAt: iso(-30),
    },
    {
      id: `led_${uid()}`,
      userId: user.id,
      amountRial: -(owned[0]?.priceRial ?? 0),
      kind: "purchase",
      memo: `خرید ${BOOKS[0]?.title ?? ""}`,
      createdAt: iso(-29),
    },
    {
      id: `led_${uid()}`,
      userId: user.id,
      amountRial: 500_000,
      kind: "promo",
      memo: "هدیه خوش‌آمدگویی",
      createdAt: iso(-28),
    },
  ];

  const positions: ListeningPosition[] = owned.slice(0, 2).map((e, i) => ({
    userId: user.id,
    editionId: e.id,
    /* Partway in, so "ادامه شنیدن" has something to continue. */
    positionSec: Math.round(e.durationSec * (i === 0 ? 0.34 : 0.08)),
    updatedAt: iso(-1),
  }));

  return {
    users: [user],
    otps: [],
    sessions: [],
    devices: [],
    entitlements,
    ledger,
    orders: [],
    positions,
    bookmarks: [],
    notes: [],
  };
}

/* ── Derived reads ───────────────────────────────────────────────────────— */

/**
 * Human narration first, then the longest.
 *
 * Mirrors `defaultEdition` in the catalogue module. Duplicated rather than
 * imported because this side of the wire is standing in for the Go core, and
 * the core will not be importing the front end's helpers.
 */
function defaultEditionOf(book: Book): AudioEdition | undefined {
  const human = book.editions.filter((e) => e.narratorType === "human");
  const pool = human.length > 0 ? human : book.editions;
  return pool.reduce<AudioEdition | undefined>(
    (best, e) => (!best || e.durationSec > best.durationSec ? e : best),
    undefined,
  );
}

/** The balance, summed. Never read from a column, because there isn't one. */
export const balanceOf = (userId: string) =>
  db.ledger
    .filter((l) => l.userId === userId)
    .reduce((sum, l) => sum + l.amountRial, 0);

/**
 * Whether a user may play an edition right now.
 *
 * Expiry is checked on read rather than swept by a job: a subscription that
 * lapsed a minute ago must stop granting access immediately, and a cron that
 * runs nightly would keep it alive until morning.
 */
export function hasEntitlement(userId: string, editionId: string) {
  const now = Date.now();
  return db.entitlements.some(
    (e) =>
      e.userId === userId &&
      e.editionId === editionId &&
      (e.expiresAt === null || Date.parse(e.expiresAt) > now),
  );
}

/** Every edition in the catalogue, flattened, with its book and voice resolved. */
export function editionIndex() {
  return BOOKS.flatMap((book) =>
    book.editions.map((edition) => ({
      edition,
      book,
      voice: VOICES.find((v) => v.id === edition.voiceId),
    })),
  );
}

export const findEditionById = (editionId: string) =>
  editionIndex().find((e) => e.edition.id === editionId);

/* ── Instantiation ───────────────────────────────────────────────────────—
   Last in the file on purpose.

   `seed()` reads `DEMO_PHONE`, `uid` and `iso`, which are `const`. A `const` is
   hoisted but left uninitialised until its own line runs, so seeding from the
   top of the module threw `Cannot access '…' before initialization` at request
   time — twice, once per helper, and TypeScript could not see either because
   the temporal dead zone is purely a runtime rule.

   Evaluating here means every declaration above is already initialised, and
   adding a helper later cannot reintroduce the fault. The functions that read
   `db` above are called at request time, long after this line has run.        */

export const db: Db = (globalThis.__ketapodDb ??= seed());
