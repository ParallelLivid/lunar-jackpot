/**
 * The wardrobe: cat skins and miner skins, side by side. Both buy with chips and
 * change nothing but appearance, which makes them one window rather than two and
 * keeps them out of The Company Store, whose prices are in cash.
 *
 * The two halves behave differently on purpose, and the tiles say so. A cat skin
 * is unlocked: buying it widens the pool a newly met cat draws from and the set
 * a click cycles through, and never redresses a cat already met. A miner skin is
 * worn: there is one miner, so owning and wearing are two steps.
 */

import { selectSkinsView } from "../../domain/selectors";
import type { CatSkinOfferView, MinerSkinOfferView } from "../../domain/selectors";
import { useDerived, useDispatch } from "../layout";
import { PixelSprite } from "../shared/PixelSprite";
import { ActionButton, DisabledNote, PriceButton } from "../shared/Panel";

function CatSkinTile({ offer }: { offer: CatSkinOfferView }) {
  const dispatch = useDispatch();

  return (
    <li className="skin-tile">
      <PixelSprite scale={3} spriteId={offer.restSpriteId} dimmed={!offer.owned} />
      <span className="skin-tile__name">{offer.displayName}</span>
      {offer.owned ? (
        <span className="skin-tile__state">Unlocked</span>
      ) : (
        <>
          {/*
            The tile's own name is right above the button, so "Buy" is all the
            first line has to add. A bare `25K chips` states a price with no verb
            attached to it.
          */}
          <PriceButton
            availability={offer.purchase}
            onClick={() => {
              dispatch({ type: "BUY_CAT_SKIN", skinId: offer.skinId });
            }}
            ariaLabel={`Buy ${offer.displayName}, ${offer.costLabel}`}
            what="Buy"
            cost={offer.costLabel}
          />
          <DisabledNote availability={offer.purchase} />
        </>
      )}
    </li>
  );
}

function MinerSkinTile({ offer }: { offer: MinerSkinOfferView }) {
  const dispatch = useDispatch();

  return (
    <li className={`skin-tile${offer.worn ? " skin-tile--worn" : ""}`}>
      <PixelSprite scale={3} spriteId={offer.spriteId} dimmed={!offer.owned} />
      <span className="skin-tile__name">{offer.displayName}</span>
      {/*
        Three states rather than the cats' two, because a miner skin is selected
        as well as owned: buy it, wear it, or it is already on.
      */}
      {!offer.owned ? (
        <>
          <PriceButton
            availability={offer.purchase}
            onClick={() => {
              dispatch({ type: "BUY_MINER_SKIN", skinId: offer.skinId });
            }}
            ariaLabel={`Buy ${offer.displayName}, ${offer.costLabel}`}
            what="Buy"
            cost={offer.costLabel}
          />
          <DisabledNote availability={offer.purchase} />
        </>
      ) : offer.worn ? (
        <span className="skin-tile__state">Worn</span>
      ) : (
        <ActionButton
          onClick={() => {
            dispatch({ type: "SET_MINER_SKIN", skinId: offer.skinId });
          }}
        >
          Wear
        </ActionButton>
      )}
    </li>
  );
}

export function SkinsWindow() {
  const view = selectSkinsView(useDerived());

  return (
    <div className="panel--skins window-panel">
      <p className="window-panel__status">Bought with chips, and worth nothing but looking at</p>

      <div className="skin-columns">
        <section className="skin-column">
          <h4 className="subheading">Miner</h4>
          <p className="description">One at a time. Changing it is free.</p>
          <ul className="skin-grid">
            {view.miners.map((offer) => (
              <MinerSkinTile key={offer.skinId} offer={offer} />
            ))}
          </ul>
        </section>

        <section className="skin-column">
          <h4 className="subheading">Cats</h4>
          <p className="description">
            {view.ownedCatSkinCount > 1
              ? "Unlocked skins join the pool new cats are drawn from. Click a cat in the litterbox to cycle it."
              : "Unlocked skins join the pool new cats are drawn from."}
          </p>
          <ul className="skin-grid">
            {view.cats.map((offer) => (
              <CatSkinTile key={offer.skinId} offer={offer} />
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
