import { useState, useEffect } from 'react';

const STORAGE_KEY = 'privateide_onboarded';

const STEPS = [
  {
    emoji: '🔒',
    title: 'Your AI stays on your device',
    body: 'PrivateIDE runs a full LLM in your browser via WebAssembly. No API keys. No cloud. Open DevTools → Network and watch: zero requests to any AI endpoint.',
    cta: 'Got it',
  },
  {
    emoji: '💻',
    title: 'Dev Mode — analyze private code',
    body: 'Paste or drag any code file into the editor. Hit Explain, Debug, Docstring, or Refactor. The model runs locally — your proprietary code never leaves this tab.',
    cta: 'Next',
  },
  {
    emoji: '🔬',
    title: 'Research Mode — private document Q&A',
    body: 'Drag in unpublished PDFs — thesis drafts, lab results, confidential papers. Ask questions across all of them. Nothing is uploaded anywhere.',
    cta: 'Next',
  },
  {
    emoji: '⬇️',
    title: 'One-time model download',
    body: 'The first time you use Dev or Research mode, a ~250MB model downloads and caches in your browser. After that, everything works fully offline — even on a plane.',
    cta: "Let's go →",
  },
];

interface OnboardingFlowProps {
  onComplete: () => void;
}

export function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
  const [step, setStep] = useState(0);
  const [exiting, setExiting] = useState(false);

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  const advance = () => {
    if (isLast) {
      setExiting(true);
      setTimeout(() => {
        localStorage.setItem(STORAGE_KEY, 'true');
        onComplete();
      }, 350);
    } else {
      setStep(s => s + 1);
    }
  };

  return (
    <div className={`onboarding-overlay ${exiting ? 'onboarding-exit' : ''}`}>
      <div className="onboarding-card">
        {/* Step dots */}
        <div className="onboarding-dots">
          {STEPS.map((_, i) => (
            <div key={i} className={`onboarding-dot ${i === step ? 'active' : i < step ? 'done' : ''}`} />
          ))}
        </div>

        <div className="onboarding-emoji">{current.emoji}</div>
        <h2 className="onboarding-title">{current.title}</h2>
        <p className="onboarding-body">{current.body}</p>

        <button className="btn btn-accent onboarding-cta" onClick={advance}>
          {current.cta}
        </button>

        {!isLast && (
          <button
            className="onboarding-skip"
            onClick={() => {
              setExiting(true);
              setTimeout(() => {
                localStorage.setItem(STORAGE_KEY, 'true');
                onComplete();
              }, 350);
            }}
          >
            Skip intro
          </button>
        )}
      </div>
    </div>
  );
}

export function shouldShowOnboarding(): boolean {
  return !localStorage.getItem(STORAGE_KEY);
}
