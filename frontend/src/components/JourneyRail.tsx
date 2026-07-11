import type { SessionState } from '../api/types';
import { computeJourney } from '../wizard/sections';

interface JourneyRailProps {
  session: SessionState;
}

/**
 * The progress rail: four stages (About you → Your property → Coverage → Review) derived from
 * the session, so it reflects the actual own/rent branch and marks stages done/current/todo as
 * the customer moves through. Purely presentational — structure that encodes the real flow.
 */
export function JourneyRail({ session }: JourneyRailProps) {
  const steps = computeJourney(session);

  return (
    <nav aria-label="Onboarding progress">
      <ol className="rail">
        {steps.map((step) => (
          <li
            key={step.id}
            className={`rail__step rail__step--${step.status}`}
            aria-current={step.status === 'current' ? 'step' : undefined}
          >
            <span className="rail__rune" aria-hidden="true">
              <span className="rail__dot" />
              {step.status === 'done' && <span className="rail__check">✓</span>}
            </span>
            <span className="rail__body">
              <span className="rail__label">{step.label}</span>
              {step.id !== 'review' && step.total > 0 && (
                <span className="rail__count">
                  {step.answered} of {step.total}
                </span>
              )}
            </span>
          </li>
        ))}
      </ol>
    </nav>
  );
}
