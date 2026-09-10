import { formatRate } from "../../domain/numbers";
import { selectResourceViews, selectTotalCashPerSecond } from "../../domain/selectors";
import { useDerived } from "../layout";
import { PixelSprite } from "../shared/PixelSprite";
import { Panel } from "../shared/Panel";

export function ResourceBar() {
  const derived = useDerived();
  const resources = selectResourceViews(derived.state);
  const perSecond = selectTotalCashPerSecond(derived);

  return (
    <Panel
      className="panel--resources"
      anchorId="resources"
      title="Resources"
      actions={
        <span className="resource-rate" title="Combined payout of every unlocked machine">
          {formatRate(perSecond)} cash/s
        </span>
      }
    >
      <ul className="resource-list">
        {resources.map((resource) => (
          <li key={resource.id} className="resource" data-resource={resource.id}>
            <PixelSprite spriteId={resource.spriteId} scale={2} />
            <span className="resource__body">
              <span className="resource__name">{resource.displayName}</span>
              <span
                className="resource__value"
                title={`${resource.exactText} — ${resource.description}`}
              >
                {resource.displayText}
              </span>
            </span>
            <span className="sr-only">
              {resource.displayName}: {resource.exactText}. {resource.description}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
