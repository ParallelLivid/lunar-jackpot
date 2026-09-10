/** The Company store: supplies, both kinds of cache, keys, and the standing order. */

import { formatCompact } from "../../domain/numbers";
import {
  selectConsumableOffers,
  selectStoreView,
  type BulkOfferView,
  type CacheOfferView,
  type ConsumableOfferView,
} from "../../domain/selectors";
import { useDerived, useDispatch } from "../layout";
import { PixelSprite } from "../shared/PixelSprite";
import { ActionButton, DisabledNote, PriceButton, StatRow } from "../shared/Panel";

/**
 * A row of quantity buttons, the last of which buys everything affordable. Every
 * button says what it costs and greys out when it cannot be paid for.
 *
 * The quantities, prices and availabilities all come from the selector rather
 * than being worked out here, so the number on a button, the price beside it and
 * what the command charges cannot disagree.
 */
function BulkRow({
  label,
  offers,
  onBuy,
  unit,
}: {
  label: string;
  offers: BulkOfferView[];
  onBuy: (quantity: number) => void;
  unit: "cash" | "chips";
}) {
  const most = offers[offers.length - 1]?.quantity;

  return (
    <div className="bulk-row" role="group" aria-label={label}>
      {offers.map((offer) => (
        <PriceButton
          key={offer.quantity}
          availability={offer.purchase}
          /*
            A quantity token does not read aloud, so this one says it in words —
            the rule is stated once, on `PriceButton`.
          */
          ariaLabel={`${label}, ${String(offer.quantity)} for ${formatCompact(offer.totalPrice)} ${unit}`}
          onClick={() => {
            onBuy(offer.quantity);
          }}
          what={
            offer.quantity === most && offers.length > 1
              ? `Max ${formatCompact(offer.quantity)}`
              : `x${formatCompact(offer.quantity)}`
          }
          cost={`${formatCompact(offer.totalPrice)} ${unit}`}
        />
      ))}
    </div>
  );
}

/**
 * One kind of cache, as a column. Sharing a column makes the store's right-hand
 * side three times the height of anything beside it, which is what made the
 * window scroll.
 */
function CacheColumn({ offer }: { offer: CacheOfferView }) {
  const dispatch = useDispatch();

  return (
    <section className="store-column">
      <h4 className="subheading">{offer.displayName}</h4>

      <div className="store-row">
        <PixelSprite spriteId={offer.spriteId} scale={3} label={offer.displayName} />
        <div className="store-row__body">
          <StatRow label="Held" value={formatCompact(offer.held)} />
          <p className="description">{offer.description}</p>
        </div>
      </div>

      {/*
        Two prices for one object. The cash price is the Company restocking on a
        schedule and is what paces the collection; the chip price is buying one
        off the floor. Both are on their own buttons now — the paragraph that
        used to explain the chip price ("Or N chips each, off the shelf…") is
        gone with it, and the restock rule it sat beside is in the help window's
        "Caches and keys" topic.
      */}
      {/*
        The price and the restock on one line.

        As a full-width paragraph under a 71px button, the restock leaves 220px
        of column empty beside it and pushes everything below down. It belongs to
        the cash button and nothing else: the chip offers below are always in
        stock, so a line about waiting for a restock between the two would read
        as though it governed both.

        It stays beside the button at every width the store reaches — measured at
        a 560px viewport, where the store is down to two 248px tracks and the
        sentence merely wraps to two lines inside its own box. See
        `.cache-offer__restock` for the rule that keeps it from squeezing the
        button instead.
      */}
      <div className="cache-offer">
        {/* "Buy one, 500 cash" reads aloud as it stands, so no override. */}
        <PriceButton
          availability={offer.buyWithCash}
          onClick={() => {
            dispatch({ type: "BUY_CACHE", cacheTypeId: offer.cacheTypeId });
          }}
          what="Buy one"
          cost={`${formatCompact(offer.cashPrice)} cash`}
        />
        <span className="cache-offer__restock">
          {offer.depthsUntilRestock === 0
            ? "In stock now."
            : `Restocks in ${formatCompact(offer.depthsUntilRestock)} more ${
                offer.depthsUntilRestock === 1 ? "depth" : "depths"
              }.`}
        </span>
      </div>

      <BulkRow
        label={`Buy ${offer.displayName.toLowerCase()}s with chips`}
        offers={offer.chipOffers}
        unit="chips"
        onBuy={(quantity) => {
          dispatch({
            type: "BUY_CACHE_WITH_CHIPS",
            cacheTypeId: offer.cacheTypeId,
            quantity,
          });
        }}
      />

      <div className="button-row">
        <ActionButton
          className="action--primary"
          availability={offer.open}
          onClick={() => {
            dispatch({
              type: "OPEN_CACHES",
              cacheTypeId: offer.cacheTypeId,
              quantity: 1,
            });
          }}
        >
          Open one
        </ActionButton>
        {/*
          Only once there is more than one to open. A button labelled "Open all
          (1)" beside "Open one" is two ways to do the same thing.
        */}
        {offer.openable > 1 ? (
          <ActionButton
            availability={offer.open}
            onClick={() => {
              dispatch({
                type: "OPEN_CACHES",
                cacheTypeId: offer.cacheTypeId,
                quantity: offer.openable,
              });
            }}
          >
            Open all ({offer.openable})
          </ActionButton>
        ) : null}
      </div>
    </section>
  );
}

/**
 * One consumable, as a row. The effect is stated separately from the flavour,
 * because the effect is what the decision is made on and two of the six carry a
 * clamp worth knowing before buying.
 *
 * The flavour is a tooltip rather than a paragraph: six paragraphs at a column's
 * width made this the largest thing in the window, for the part of the tile a
 * player reads once. Neither clamp went with it — those live in `effectSummary`,
 * which is always on screen — and the prose is still read aloud from a
 * visually-hidden line.
 */
function ConsumableTile({ offer }: { offer: ConsumableOfferView }) {
  const dispatch = useDispatch();

  return (
    <li className="consumable-tile" title={offer.description}>
      <PixelSprite spriteId={offer.spriteId} scale={3} dimmed={offer.held} />
      <div className="consumable-tile__body">
        <span className="consumable-tile__name">{offer.displayName}</span>
        <span className="consumable-tile__effect">{offer.effectSummary}</span>
        <span className="sr-only">{offer.description}</span>
      </div>
      <div className="consumable-tile__buy">
        {offer.held ? (
          <span className="consumable-tile__held">Packed</span>
        ) : (
          <>
            {/*
              "Pack one", because "Packed" is what the tile says once it is
              bought — the verb and the state it produces are the same word.
            */}
            <PriceButton
              availability={offer.purchase}
              onClick={() => {
                dispatch({ type: "BUY_CONSUMABLE", consumableId: offer.id });
              }}
              what="Pack one"
              cost={offer.costLabel}
            />
            {/*
              Kept, where the cache columns' notes were dropped.

              Here for a reason the price alone does not cover: a supply is
              refused during a run as well as when it cannot be paid for, and a
              tooltip should not be the only place that says so. The cache
              buttons carry no note, because affordability is the only reason
              they have left and their own price states it.
            */}
            <DisabledNote availability={offer.purchase} />
          </>
        )}
      </div>
    </li>
  );
}

export function StoreWindow() {
  const derived = useDerived();
  const dispatch = useDispatch();
  const view = selectStoreView(derived);
  const consumables = selectConsumableOffers(derived);
  const autobuy = derived.state.settings.cacheAutobuy;

  return (
    <div className="panel--store window-panel">
      <p className="window-panel__status">Company prices are non-negotiable</p>

      {/*
        Supplies on the left; the two caches and everything that serves them on
        the right.

        A full-width band under all three columns sits under the tallest of them,
        which is the supplies list at 570px against the caches' 263px: measured
        at 1440x900, that leaves 306px of empty canvas under the two cache
        columns in a window only 739px tall.

        So the caches and their two bands are one block, and the block is what
        sits beside supplies. A key opens either kind of cache and the standing
        order buys one of them, so both belong to the pair rather than to either
        — which is what a band spanning the block says.
      */}
      <div className="store-columns">
        <section className="store-column">
          <h4 className="subheading">Expedition supplies</h4>
          {/*
            "Bought with chips and spent on the next launch, whether or not it
            comes home. One of each at most." — in the help window's "Expedition
            supplies" topic. The price is on each button, and "Packed" already
            stands in for the one-of-each rule once a tile is bought.
          */}
          <ul className="consumable-grid">
            {consumables.map((offer) => (
              <ConsumableTile key={offer.id} offer={offer} />
            ))}
          </ul>
        </section>

        <div className="store-cache-block">
          {view.caches.map((offer) => (
            <CacheColumn key={offer.cacheTypeId} offer={offer} />
          ))}

          {/*
            The standing order first, then the keys — the order the note asks
            for, and the reverse of what the band held before.

            It reads as the sequence the player meets them in: the order buys a
            cache on your behalf, and then a key is what opens whatever arrives.
            The keys row is the taller of the two and putting it second keeps the
            block's heaviest thing at its foot.
          */}
          <section className="store-band">
            <h5 className="subheading">Standing order</h5>
            {/*
              Pointed at the cash cache alone. The chip caches have no restock to
              wait for, so an autobuy aimed at those would simply hold the chip
              balance at zero for the rest of the save.

              Nothing below the checkbox. The reserve rule — that the order never
              spends below twice the price — is in the help window's "Caches and
              keys" topic, where a rule nobody needs at the moment of ticking a
              box belongs.
            */}
            <label className="setting setting--toggle">
              <input
                type="checkbox"
                checked={autobuy.enabled}
                onChange={(event) => {
                  dispatch({
                    type: "UPDATE_SETTINGS",
                    patch: { cacheAutobuy: { ...autobuy, enabled: event.target.checked } },
                  });
                }}
              />
              <span className="setting__label">
                Buy a cache automatically when one is in stock, if sufficient funds are
                available
              </span>
            </label>
          </section>

          {/*
            The keys keep their `.store-row`, because they are three things
            across — a sprite, a held count with its rule, and the quantity
            ladder — and that row is what lays them out. The standing order above
            gave its row up: it is a heading and a checkbox, and it was spending
            a sprite slot on nothing.
          */}
          <section className="store-band">
            <div className="store-row">
              <PixelSprite spriteId="sprite.resource.keys" scale={3} label="Keys" />
              <div className="store-row__body">
                <StatRow label="Keys held" value={formatCompact(view.keysHeld)} />
                <p className="description">
                  One key opens one cache of either kind, and The Company keeps the key.
                </p>
                <BulkRow
                  label="Buy keys"
                  offers={view.keyOffers}
                  unit="cash"
                  onBuy={(quantity) => {
                    dispatch({ type: "BUY_KEY", quantity });
                  }}
                />
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
