import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { initSDK, initONNX, getAccelerationMode } from './runanywhere';
import { ChatTab } from './components/ChatTab';
import { VisionTab } from './components/VisionTab';
import { VoiceTab } from './components/VoiceTab';
import { ToolsTab } from './components/ToolsTab';
import { DevModeTab } from './components/DevModeTab';
import { ResearchModeTab } from './components/ResearchModeTab';
import { PrivacyPulseHUD } from './components/PrivacyPulseHUD';
import { ModelDownloadOverlay } from './components/ModelDownloadOverlay';
import { BackendBadge } from './components/BackendBadge';
import { ShortcutsModal } from './components/ShortcutsModal';
import { ShortcutsHintToast } from './components/ShortcutsHintToast';
import { AirplaneModeButton } from './components/AirplaneModeButton';
import { OfflineBanner } from './components/OfflineBanner';
import { PrivacyShield } from './components/PrivacyShield';
import { OnboardingFlow, shouldShowOnboarding } from './components/OnboardingFlow';
import { PrivacyProofScreen } from './components/PrivacyProofScreen';
import { PrivacyMonitorProvider, usePrivacyMonitor } from './context/PrivacyMonitorContext';
import { ModelProvider, useModel } from './context/ModelContext';
import { DownloadOverlayProvider, useDownloadOverlay } from './context/DownloadOverlayContext';
import { KeyboardShortcutsProvider, useKeyboardShortcuts } from './context/KeyboardShortcutsContext';

// Primary modes (pill toggle)
type PrimaryMode = 'dev' | 'research';
// Secondary tabs (sub-nav)
type SecondaryTab = 'chat' | 'vision' | 'voice' | 'tools';
type ActiveView = PrimaryMode | SecondaryTab;

const SECONDARY_TABS: { id: SecondaryTab; label: string }[] = [
  { id: 'chat',   label: '💬 Chat' },
  { id: 'vision', label: '📷 Vision' },
  { id: 'voice',  label: '🎙️ Voice' },
  { id: 'tools',  label: '🔧 Tools' },
];

const panelVariants = {
  enter: (dir: number) => ({ opacity: 0, x: dir > 0 ? 16 : -16 }),
  center: { opacity: 1, x: 0 },
  exit:  (dir: number) => ({ opacity: 0, x: dir > 0 ? -16 : 16 }),
};

function AppContent() {
  const [sdkReady, setSdkReady] = useState(false);
  const [sdkError, setSdkError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ActiveView>(() =>
    (localStorage.getItem('privateide_active_tab') as ActiveView) || 'dev'
  );
  const [prevView, setPrevView] = useState<ActiveView>('dev');
  const [isOfflineMode, setIsOfflineMode] = useState(false);
  const [showOfflineBanner, setShowOfflineBanner] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(() => shouldShowOnboarding());
  const [showPrivacyProof, setShowPrivacyProof] = useState(false);

  const { isVisible, progress, modelName, modelSize, hideOverlay } = useDownloadOverlay();
  const { registerHandlers } = useKeyboardShortcuts();
  const { totalTokens, isGenerating } = usePrivacyMonitor();
  const { modelLoaded } = useModel();

  const primaryMode: PrimaryMode =
    activeView === 'dev' || activeView === 'research' ? activeView : 'dev';

  const isSecondaryActive = !['dev', 'research'].includes(activeView);

  // Direction for animation
  const viewOrder: ActiveView[] = ['dev', 'research', 'chat', 'vision', 'voice', 'tools'];
  const direction = viewOrder.indexOf(activeView) - viewOrder.indexOf(prevView);

  const handleViewChange = (v: ActiveView) => {
    setPrevView(activeView);
    setActiveView(v);
    localStorage.setItem('privateide_active_tab', v);
    // Lazy-load ONNX backend only when user actually opens Voice or Tools
    if (v === 'voice' || v === 'tools') {
      initONNX().catch(console.error);
    }
  };

  const handleOfflineChange = (isOffline: boolean) => {
    setIsOfflineMode(isOffline);
    setShowOfflineBanner(isOffline);
    // Update browser tab title to signal offline mode
    document.title = isOffline ? '✈️ Offline — PrivateIDE' : 'PrivateIDE';
  };

  useEffect(() => {
    initSDK()
      .then(() => setSdkReady(true))
      .catch((err) => setSdkError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    registerHandlers({
      onSwitchToDevMode:      () => handleViewChange('dev'),
      onSwitchToResearchMode: () => handleViewChange('research'),
      onSwitchToChat:         () => handleViewChange('chat'),
    });
  }, [registerHandlers]);

  /* ── Loading / Error screens ── */
  if (sdkError) {
    return (
      <div className="app-loading">
        <div className="shimmer-loader" style={{ width: 200 }} />
        <h2 className="error-text">SDK Initialization Error</h2>
        <p style={{
          maxWidth: 420,
          background: 'var(--red-dim)',
          border: '1px solid rgba(248,113,113,0.2)',
          borderRadius: 12,
          padding: '12px 16px',
          color: 'var(--text-3)',
        }}>{sdkError}</p>
      </div>
    );
  }

  if (!sdkReady) {
    return (
      <div className="app-loading">
        <div className="shimmer-loader" style={{ width: 200 }} />
        <h2>Initializing AI Engine</h2>
        <p>Compiling WebAssembly runtime — takes ~3s on first load</p>
      </div>
    );
  }

  return (
    <div className={`app ${isOfflineMode ? 'offline-mode-active' : ''}`}>
      {/* Onboarding — shown once on first visit */}
      {showOnboarding && (
        <OnboardingFlow onComplete={() => setShowOnboarding(false)} />
      )}

      {/* Privacy proof screen */}
      {showPrivacyProof && (
        <PrivacyProofScreen onClose={() => setShowPrivacyProof(false)} />
      )}

      {/* Offline Banner */}
      <OfflineBanner isVisible={showOfflineBanner} onDismiss={() => setShowOfflineBanner(false)} />

      {/* ── Header ── */}
      <header className="app-header">
        <div className="header-brand">
          <span className="header-logo" role="img" aria-label="Lock">🔒</span>
          <h1>PrivateIDE</h1>
        </div>

        {/* Center pill — Dev | Research */}
        <div className="mode-pill-wrapper">
          <div className="mode-pill" role="group" aria-label="Primary mode switcher">
            <button
              className={`mode-pill-btn ${primaryMode === 'dev' && !isSecondaryActive ? 'active' : ''}`}
              onClick={() => handleViewChange('dev')}
              aria-pressed={primaryMode === 'dev' && !isSecondaryActive}
            >
              💻 Dev
            </button>
            <button
              className={`mode-pill-btn ${primaryMode === 'research' && !isSecondaryActive ? 'active' : ''}`}
              onClick={() => handleViewChange('research')}
              aria-pressed={primaryMode === 'research' && !isSecondaryActive}
            >
              🔬 Research
            </button>
          </div>
        </div>

        <div className="header-info">
          <span className="header-subtitle">Zero Cloud</span>
          <button
            className="btn btn-sm prove-it-btn"
            onClick={() => setShowPrivacyProof(true)}
            title="Verify zero network requests"
          >
            🔍 Prove It
          </button>
          <PrivacyShield
            totalTokens={totalTokens}
            isGenerating={isGenerating}
            modelName={modelLoaded ? localStorage.getItem('privateide_model') === 'lfm2-1.2b-tool-q4_k_m' ? 'LFM2 1.2B Tool' : 'LFM2 350M' : undefined}
          />
          <BackendBadge />
          <AirplaneModeButton onOfflineChange={handleOfflineChange} />
        </div>
      </header>

      {/* ── Secondary tab bar ── */}
      <nav className="tab-bar" role="tablist" aria-label="Additional modes">
        {SECONDARY_TABS.map(({ id, label }) => (
          <button
            key={id}
            className={activeView === id ? 'active' : ''}
            onClick={() => handleViewChange(id)}
            role="tab"
            aria-selected={activeView === id}
          >
            <span>{label}</span>
          </button>
        ))}
      </nav>

      {/* ── Animated main content ── */}
      <main className="tab-content" role="main">
        {/* Dev + Research stay ALWAYS mounted so model state is preserved */}
        <div style={{ display: activeView === 'dev' ? 'flex' : 'none', flex: 1, flexDirection: 'column', overflow: 'hidden' }}>
          <DevModeTab />
        </div>
        <div style={{ display: activeView === 'research' ? 'flex' : 'none', flex: 1, flexDirection: 'column', overflow: 'hidden' }}>
          <ResearchModeTab />
        </div>

        {/* Secondary tabs use animated mount/unmount — they don't hold model state */}
        <AnimatePresence initial={false} custom={direction} mode="wait">
          {isSecondaryActive && (
            <motion.div
              key={activeView}
              custom={direction}
              variants={panelVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
              style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
            >
              {activeView === 'chat'   && <ChatTab />}
              {activeView === 'vision' && <VisionTab />}
              {activeView === 'voice'  && <VoiceTab />}
              {activeView === 'tools'  && <ToolsTab />}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* ── Privacy Pulse HUD ── */}
      <PrivacyPulseHUD />

      {/* ── Model Download Overlay ── */}
      <ModelDownloadOverlay
        isVisible={isVisible}
        progress={progress}
        modelName={modelName}
        modelSize={modelSize}
        onComplete={hideOverlay}
      />

      <ShortcutsModal />
      <ShortcutsHintToast />
    </div>
  );
}

export function App() {
  return (
    <KeyboardShortcutsProvider>
      <ModelProvider>
        <DownloadOverlayProvider>
          <PrivacyMonitorProvider>
            <AppContent />
          </PrivacyMonitorProvider>
        </DownloadOverlayProvider>
      </ModelProvider>
    </KeyboardShortcutsProvider>
  );
}
